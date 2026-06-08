import maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import type { MapLayerSettings, PacketAnimationStyle, PacketVisualSettings, RenderQuality } from '../mapSettings';
import { DEFAULT_MAP_LAYER_SETTINGS, DEFAULT_PACKET_VISUAL_SETTINGS, normalizeLayerSettings, normalizePacketVisualSettings } from '../mapSettings';
import { payloadVisual } from '../payloadVisuals';
import type { PublicNode, PublicObserverBurst, PublicRoute, PublicRoutePulse } from '../types';
import { isMappableEndpoint, isMappableNode } from './geo';
import type { NodeFocus } from './nodeFocus';
import { arcTrailSamples, sampleRouteArc, type ArcSample } from './routeArcs';
import { routeColors } from './routeSource';
import { DETAIL_MIN_ZOOM } from './zoomMode';
import { packetTravelDuration, sequentialSegmentProgress, type PacketAnimationOptions } from './packetAnimator';
import { computeLineOfSight, routeLOSColor, type LOSResult } from './terrainProfile';

export const OPENFREEMAP_3D_LAYER_ID = 'meshcore-openfreemap-3d-live';

export const MAX_NODE_MODELS = 720;
export const MAX_ROUTE_ARCS = 900;
export const MAX_3D_ACTIVE_COMETS = 180;
export const MAX_3D_OBSERVER_GLOWS = 80;
export const OPENFREEMAP_3D_FRAME_INTERVAL_SMOOTH_MS = 34;
export const OPENFREEMAP_3D_FRAME_INTERVAL_BALANCED_MS = 23;
export const OPENFREEMAP_3D_FRAME_INTERVAL_HIGH_MS = 16;
const ROUTE_FRESH_MS = 5 * 60_000;
const OBSERVER_GLOW_MS = 5200;
const PACKET_AFTERGLOW_MS = 900;

type Map3DViewport = Pick<maplibregl.Map, 'getBounds' | 'getZoom'>;

export interface OpenFreeMap3DUpdate {
  nodes: PublicNode[];
  routes: PublicRoute[];
  focus: NodeFocus;
  selectedRouteID: string | null;
  analysisSegments: PublicRoutePulse['segments'];
  layerSettings: MapLayerSettings;
  packetVisualSettings: PacketVisualSettings;
  themeMode: 'dark' | 'light';
}

export interface OpenFreeMap3DController {
  readonly layer: maplibregl.CustomLayerInterface;
  update(input: OpenFreeMap3DUpdate): void;
  addPulse(pulse: PublicRoutePulse, options?: PacketAnimationOptions): boolean;
  addObserverBurst(burst: PublicObserverBurst): boolean;
  setPaused(paused: boolean): void;
  destroy(): void;
}

type ActiveComet = {
  pulse: PublicRoutePulse;
  segments: PublicRoutePulse['segments'];
  started: number;
  travelDuration: number;
  afterglowDuration: number;
  color: string;
  brightness: number;
  trailScale: number;
  animationStyle: PacketAnimationStyle;
  force: boolean;
  paths: CometSegmentPath[];
  root: THREE.Group;
  head: THREE.Mesh;
  halo: THREE.Mesh;
  cone: THREE.Mesh;
  trail: THREE.Line;
  trailGeometry: THREE.BufferGeometry;
  trailPositions: Float32Array;
  maxTrailPoints: number;
  tailTarget: THREE.Vector3;
};

export type CometSegmentPath = {
  samples: ArcSample[];
  vectors: THREE.Vector3[];
};

type ObserverGlow = {
  key: string;
  started: number;
  color: string;
  lng: number;
  lat: number;
  baseScale: number;
  root: THREE.Group;
  ring: THREE.Mesh;
};

type NodeModelLOD = 'marker' | 'full';

const geomPool = new Map<string, THREE.BufferGeometry>();
const pooledSet = new WeakSet<THREE.BufferGeometry>();

function poolK(p: string, ...a: (number|string)[]): string { return p+':'+a.map(v=>typeof v==='number'?v.toFixed(1):v).join(','); }
function poolG(k: string, f: ()=>THREE.BufferGeometry): THREE.BufferGeometry { const e=geomPool.get(k); if(e)return e; const g=f(); geomPool.set(k,g); pooledSet.add(g); return g; }
function isPooled(g: THREE.BufferGeometry|undefined): boolean { return g!==undefined && pooledSet.has(g); }
function disposeGK(o: THREE.Object3D) { o.traverse(c=>{if(!(c instanceof THREE.Mesh))return;if(c.geometry&&isPooled(c.geometry))c.geometry=undefined as unknown as THREE.BufferGeometry;const m=c.material as THREE.Material|THREE.Material[]|undefined;if(Array.isArray(m))m.forEach(x=>x.dispose());else m?.dispose?.();}); }

export function createOpenFreeMap3DController(): OpenFreeMap3DController {
  return new OpenFreeMap3DLayer();
}

export function nodeModelKind(node: Pick<PublicNode, 'role' | 'isObserver'>): 'observer' | 'repeater' | 'companion' | 'room' | 'other' {
  if (node.isObserver) return 'observer';
  if (node.role === 'repeater') return 'repeater';
  if (node.role === 'companion') return 'companion';
  if (node.role === 'room_server') return 'room';
  return 'other';
}

class OpenFreeMap3DLayer implements OpenFreeMap3DController {
  readonly layer: maplibregl.CustomLayerInterface;
  private map: maplibregl.Map | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.Camera | null = null;
  private scene: THREE.Scene | null = null;
  private nodeRoot = new THREE.Group();
  private routeRoot = new THREE.Group();
  private cometRoot = new THREE.Group();
  private observerRoot = new THREE.Group();
  private latest: OpenFreeMap3DUpdate | null = null;
  private layerSettings = DEFAULT_MAP_LAYER_SETTINGS;
  private packetVisualSettings = DEFAULT_PACKET_VISUAL_SETTINGS;
  private nodeSignature = '';
  private routeSignature = '';
  private activeComets: ActiveComet[] = [];
  private observerGlows: ObserverGlow[] = [];
  private repaintTimer = 0;
  private lastAnimationFrameAt = 0;
  private paused = false;
  private disposed = false;
  private losCache = new Map<string, LOSResult>();
  private readonly handleMoveEnd = () => {
    if (this.rebuildIfNeeded(false)) {
      this.map?.triggerRepaint();
    }
  };

  constructor() {
    this.layer = {
      id: OPENFREEMAP_3D_LAYER_ID,
      type: 'custom',
      renderingMode: '3d',
      onAdd: (map: maplibregl.Map, gl: WebGLRenderingContext) => this.onAdd(map, gl),
      render: (_gl: WebGLRenderingContext, args: { defaultProjectionData?: { mainMatrix?: number[] | Float32Array } }) => this.render(args)
    } as maplibregl.CustomLayerInterface;
  }

  update(input: OpenFreeMap3DUpdate) {
    this.latest = input;
    const prev = this.layerSettings;
    this.layerSettings = normalizeLayerSettings(input.layerSettings);
    this.packetVisualSettings = normalizePacketVisualSettings(input.packetVisualSettings);
    if (!this.layerSettings.terrainLOS && prev.terrainLOS) this.losCache.clear();
    if (this.rebuildIfNeeded(false) || this.hasActiveAnimations()) {
      this.map?.triggerRepaint();
    }
  }

  addPulse(pulse: PublicRoutePulse, options: PacketAnimationOptions = {}): boolean {
    if (!this.scene || !this.layerSettings.liveComets || !this.layerSettings.packetComets3D) return false;
    const pulseOptions = { ...pulse.replayOptions, ...options };
    if ((this.paused && !pulseOptions.force) || pulse.segments.length === 0) return false;
    const segments = pulse.segments.filter((segment) => isMappableEndpoint(segment.from) && isMappableEndpoint(segment.to));
    if (segments.length === 0) return false;
    const color = payloadVisual(pulse.payloadTypeName).color;
    const active = createComet({
      pulse,
      segments,
      color,
      started: performance.now(),
      travelDuration: clampDuration(pulseOptions.travelDurationMs ?? packetTravelDuration(segments.length, this.packetVisualSettings.speed)),
      afterglowDuration: PACKET_AFTERGLOW_MS * Math.max(0.2, pulseOptions.trailScale ?? this.packetVisualSettings.trail),
      brightness: clamp(pulseOptions.brightness ?? this.packetVisualSettings.brightness, 0.25, 2),
      trailScale: clamp(pulseOptions.trailScale ?? this.packetVisualSettings.trail, 0, 2.5),
      animationStyle: pulseOptions.animationStyle ?? this.packetVisualSettings.animationStyle,
      force: pulseOptions.force === true
    });
    this.activeComets.push(active);
    this.cometRoot.add(active.root);
    trimActiveComets(this.cometRoot, this.activeComets, openFreeMap3DCometBudget(this.packetVisualSettings.renderQuality));
    this.map?.triggerRepaint();
    return true;
  }

  addObserverBurst(burst: PublicObserverBurst): boolean {
    if (!this.scene || this.paused || !this.layerSettings.observerBursts || !Number.isFinite(burst.location.lat) || !Number.isFinite(burst.location.lng)) return false;
    const glow = createObserverGlow(burst);
    this.observerGlows.push(glow);
    this.observerRoot.add(glow.root);
    trimObserverGlows(this.observerRoot, this.observerGlows, openFreeMap3DObserverGlowBudget(this.packetVisualSettings.renderQuality));
    this.map?.triggerRepaint();
    return true;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  destroy() {
    this.disposed = true;
    if (this.map) {
      this.map.off('moveend', this.handleMoveEnd);
      this.map.off('zoomend', this.handleMoveEnd);
      if (this.map.getLayer(OPENFREEMAP_3D_LAYER_ID)) {
        try {
          this.map.removeLayer(OPENFREEMAP_3D_LAYER_ID);
        } catch {
          // MapLibre may already be tearing down the style.
        }
      }
    }
    disposeObject(this.nodeRoot);
    disposeObject(this.routeRoot);
    disposeObject(this.cometRoot);
    disposeObject(this.observerRoot);
    this.renderer?.dispose();
    if (this.repaintTimer !== 0) {
      window.clearTimeout(this.repaintTimer);
      this.repaintTimer = 0;
    }
    this.map = null;
    this.renderer = null;
    this.camera = null;
    this.scene = null;
    this.activeComets = [];
    this.observerGlows = [];
  }

  private onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
    if (this.disposed) return;
    this.map = map;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.nodeRoot.name = 'meshcore-3d-nodes';
    this.routeRoot.name = 'meshcore-3d-route-arcs';
    this.cometRoot.name = 'meshcore-3d-packet-comets';
    this.observerRoot.name = 'meshcore-3d-observer-glows';
    this.scene.add(this.routeRoot, this.nodeRoot, this.cometRoot, this.observerRoot);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.05));
    const key = new THREE.DirectionalLight(0xe0f2fe, 1.8);
    key.position.set(0.08, -0.1, 0.18).normalize();
    const fill = new THREE.DirectionalLight(0x7dd3fc, 0.65);
    fill.position.set(-0.12, 0.1, 0.1).normalize();
    this.scene.add(key, fill);
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    map.on('moveend', this.handleMoveEnd);
    map.on('zoomend', this.handleMoveEnd);
    if (this.rebuildIfNeeded(true)) {
      map.triggerRepaint();
    }
  }

  private render(args: { defaultProjectionData?: { mainMatrix?: number[] | Float32Array } }) {
    if (!this.renderer || !this.scene || !this.camera || !args.defaultProjectionData?.mainMatrix) return;
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(Array.from(args.defaultProjectionData.mainMatrix));
    const now = performance.now();
    const frameInterval = openFreeMap3DFrameInterval(this.packetVisualSettings.renderQuality);
    const elapsed = now - this.lastAnimationFrameAt;
    let active = this.hasActiveAnimations();
    if (active && (this.lastAnimationFrameAt === 0 || elapsed >= frameInterval)) {
      active = this.updateAnimations(now);
      this.lastAnimationFrameAt = now;
    }
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (active) this.requestAnimationRepaint(Math.max(1, frameInterval - (performance.now() - this.lastAnimationFrameAt)));
  }

  private requestAnimationRepaint(delayMs: number) {
    if (!this.map || this.disposed) return;
    if (delayMs <= 1) {
      this.map.triggerRepaint();
      return;
    }
    if (this.repaintTimer !== 0) return;
    this.repaintTimer = window.setTimeout(() => {
      this.repaintTimer = 0;
      this.map?.triggerRepaint();
    }, delayMs);
  }

  private updateAnimations(now: number): boolean {
    let hasActive = false;
    for (const comet of this.activeComets) {
      const elapsed = now - comet.started;
      if (elapsed > comet.travelDuration + comet.afterglowDuration) {
        this.cometRoot.remove(comet.root);
        disposeObject(comet.root);
        continue;
      }
      updateComet(comet, elapsed);
      hasActive = true;
    }
    this.activeComets = this.activeComets.filter((comet) => now - comet.started <= comet.travelDuration + comet.afterglowDuration);
    for (const glow of this.observerGlows) {
      const elapsed = now - glow.started;
      if (elapsed > OBSERVER_GLOW_MS) {
        this.observerRoot.remove(glow.root);
        disposeObject(glow.root);
        continue;
      }
      updateObserverGlow(glow, elapsed);
      hasActive = true;
    }
    this.observerGlows = this.observerGlows.filter((glow) => now - glow.started <= OBSERVER_GLOW_MS);
    return hasActive;
  }

  private rebuildIfNeeded(force: boolean): boolean {
    if (!this.map || !this.scene || !this.latest || this.disposed) return false;
    let changed = false;
    const now = Date.now();
    const selectedNodes = selectOpenFreeMap3DNodes(this.map, this.latest);
    const nextNodeSignature = nodeSceneSignature(this.map, this.latest, selectedNodes);
    if (force || nextNodeSignature !== this.nodeSignature) {
      this.nodeSignature = nextNodeSignature;
      rebuildNodeModels(this.map, this.nodeRoot, this.latest, selectedNodes);
      changed = true;
    }
    const selectedRoutes = selectOpenFreeMap3DRoutes(this.map, this.latest, now);
    const nextRouteSignature = routeSceneSignature(this.map, this.latest, now, selectedRoutes);
    if (force || nextRouteSignature !== this.routeSignature) {
      this.routeSignature = nextRouteSignature;
      rebuildRouteArcs(this.map, this.routeRoot, this.latest, this.losCache, selectedRoutes, now);
      changed = true;
    }
    return changed;
  }

  private hasActiveAnimations(): boolean {
    return this.activeComets.length > 0 || this.observerGlows.length > 0;
  }
}

function rebuildNodeModels(map: maplibregl.Map, root: THREE.Group, input: OpenFreeMap3DUpdate, selectedNodes: PublicNode[]) {
  clearGroup(root);
  const zoom = map.getZoom();
  for (const node of selectedNodes) {
    const model = createNodeModel(node, input.themeMode, nodeModelLOD(node, input.focus, zoom));
    positionAtLngLat(model, node.longitude, node.latitude, 8);
    root.add(model);
  }
}

function rebuildRouteArcs(
  map: maplibregl.Map,
  root: THREE.Group,
  input: OpenFreeMap3DUpdate,
  losCache: Map<string, LOSResult>,
  selectedRoutes: PublicRoute[],
  now: number
) {
  clearGroup(root);
  for (const route of selectedRoutes) {
    let los: LOSResult | undefined;
    if (input.layerSettings.terrainLOS) {
      los = losCache.get(route.id);
      if (!los) {
        los = computeLineOfSight({ from: route.from, to: route.to, distanceKm: route.distanceKm }, map);
        if (los.fresnelRadiusMeters > 0) losCache.set(route.id, los);
      }
    }
    root.add(createRouteArcMesh(route, input, now, los));
  }
  if (input.layerSettings.analysisPaths) {
    for (const [index, segment] of input.analysisSegments.entries()) {
      if (!isMappableEndpoint(segment.from) || !isMappableEndpoint(segment.to)) continue;
      root.add(createSegmentArcMesh(`analysis-${segment.routeId}-${index}`, segment, '#facc15', 0.88, 1.6));
    }
  }
}

export function selectOpenFreeMap3DNodes(map: Map3DViewport, input: OpenFreeMap3DUpdate, maxNodes = MAX_NODE_MODELS): PublicNode[] {
  if (!input.layerSettings.nodes || !input.layerSettings.nodeModels3D || map.getZoom() < DETAIL_MIN_ZOOM) return [];
  const bounds = paddedBounds(map, 0.2);
  const budget = Math.min(maxNodes, openFreeMap3DNodeBudget(map.getZoom(), input.packetVisualSettings.renderQuality));
  return input.nodes
    .filter(isMappableNode)
    .filter((node) => boundsContains(bounds, node.longitude, node.latitude))
    .sort((a, b) => nodePriority(b, input.focus) - nodePriority(a, input.focus))
    .slice(0, budget);
}

export function selectOpenFreeMap3DRoutes(map: Map3DViewport, input: OpenFreeMap3DUpdate, now = Date.now(), maxRoutes = MAX_ROUTE_ARCS): PublicRoute[] {
  if (!input.layerSettings.routes || !input.layerSettings.routeArcs3D) return [];
  const bounds = paddedBounds(map, 0.28);
  const zoom = map.getZoom();
  const detail = zoom >= DETAIL_MIN_ZOOM;
  const budget = Math.min(maxRoutes, openFreeMap3DRouteBudget(zoom, input.packetVisualSettings.renderQuality));
  return input.routes
    .filter((route) => isMappableEndpoint(route.from) && isMappableEndpoint(route.to))
    .filter((route) => {
      const focused = route.id === input.selectedRouteID || input.focus.pathRouteIDs.has(route.id) || input.focus.connectedRouteIDs.has(route.id);
      const fresh = now - route.lastHeard <= ROUTE_FRESH_MS;
      const visible = boundsContains(bounds, route.from.lng, route.from.lat) || boundsContains(bounds, route.to.lng, route.to.lat);
      return focused || fresh || (detail && visible);
    })
    .sort((a, b) => routePriority(b, input, now) - routePriority(a, input, now))
    .slice(0, budget);
}

export function openFreeMap3DNodeBudget(zoom: number, quality: RenderQuality = 'balanced'): number {
  if (zoom < DETAIL_MIN_ZOOM) return 0;
  const scale = renderQualityScale(quality);
  if (zoom < 8.4) return Math.round(90 * scale);
  if (zoom < 10) return Math.round(200 * scale);
  if (zoom < 12) return Math.round(360 * scale);
  return Math.min(MAX_NODE_MODELS, Math.round(520 * scale));
}

export function openFreeMap3DRouteBudget(zoom: number, quality: RenderQuality = 'balanced'): number {
  const scale = renderQualityScale(quality);
  if (zoom < 5.8) return Math.round(42 * scale);
  if (zoom < 8.2) return Math.round(110 * scale);
  if (zoom < 10) return Math.round(260 * scale);
  if (zoom < 12) return Math.round(460 * scale);
  return Math.min(MAX_ROUTE_ARCS, Math.round(640 * scale));
}

export function openFreeMap3DFrameInterval(quality: RenderQuality = 'balanced'): number {
  if (quality === 'smooth') return OPENFREEMAP_3D_FRAME_INTERVAL_SMOOTH_MS;
  if (quality === 'high') return OPENFREEMAP_3D_FRAME_INTERVAL_HIGH_MS;
  return OPENFREEMAP_3D_FRAME_INTERVAL_BALANCED_MS;
}

export function nodeModelLOD(node: PublicNode, focus: NodeFocus, zoom: number): NodeModelLOD {
  if (node.id === focus.selectedNodeID || focus.pathNodeIDs.has(node.id) || focus.neighbourNodeIDs.has(node.id)) return 'full';
  return zoom >= 9.6 ? 'full' : 'marker';
}

function createNodeModel(node: PublicNode, themeMode: 'dark' | 'light', lod: NodeModelLOD): THREE.Group {
  const group = new THREE.Group();
  const kind = nodeModelKind(node);
  const color = nodeColor(node);
  const colorNumber = hexNumber(color);
  const dark = themeMode === 'dark';
  if (lod === 'marker') {
    addCylinder(group, 170, 170, kind === 'observer' ? 260 : 420, colorNumber, 0.88, kind === 'observer' ? 140 : 230);
    addSphere(group, kind === 'observer' ? 300 : 250, colorNumber, kind === 'observer' ? 0.28 : 0.22, kind === 'observer' ? 240 : 430);
    return group;
  }
  if (kind === 'repeater') {
    addCylinder(group, 130, 130, 980, colorNumber, 0.94, 490);
    addBox(group, 620, 420, 180, dark ? 0x0f172a : 0xe2e8f0, 0.92, 90);
    addCylinder(group, 34, 34, 1550, 0xe2e8f0, 0.82, 880, -220, 0);
    addCylinder(group, 34, 34, 1550, 0xe2e8f0, 0.82, 880, 220, 0);
    addCone(group, 270, 380, colorNumber, 0.8, 1780);
  } else if (kind === 'companion') {
    addBox(group, 780, 520, 170, 0x2563eb, 0.92, 150);
    addBox(group, 520, 320, 190, 0x67e8f9, 0.82, 250);
    addCylinder(group, 24, 24, 900, 0xe2e8f0, 0.78, 720, 330, -120);
    addCone(group, 150, 220, 0x7dd3fc, 0.66, 1260, 330, -120);
  } else if (kind === 'room') {
    addBox(group, 760, 620, 420, 0x8b5cf6, 0.9, 230);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(560, 320, 4), material(0xf59e0b, 0.9));
    roof.rotation.z = Math.PI / 4;
    roof.position.z = 600;
    group.add(roof);
  } else if (kind === 'observer') {
    addCylinder(group, 190, 190, 220, 0xf59e0b, 0.92, 130);
    addSphere(group, 360, 0xfbbf24, 0.18, 170);
    addTorus(group, 520, 18, 0xfef3c7, 0.52, 180);
  } else {
    addSphere(group, 300, 0x94a3b8, 0.82, 260);
  }
  const glow = new THREE.PointLight(hexNumber(color), kind === 'observer' ? 1.8 : 1.1, 5200);
  glow.position.z = kind === 'repeater' ? 1600 : 650;
  group.add(glow);
  return group;
}

function createRouteArcMesh(route: PublicRoute, input: OpenFreeMap3DUpdate, now: number, los?: LOSResult): THREE.Object3D {
  const selected = route.id === input.selectedRouteID;
  const path = input.focus.pathRouteIDs.has(route.id);
  const connected = input.focus.connectedRouteIDs.has(route.id);
  let color: string; let opacity: number;
  if (los && input.layerSettings.terrainLOS) {
    const s = routeLOSColor(los);
    color = s.color; opacity = s.opacity;
    if (selected || path) opacity = Math.min(1, opacity + 0.22);
  } else {
    color = selected ? '#f8fafc' : path ? '#facc15' : connected ? '#67e8f9' : routeColors[Math.max(0, Math.min(4, route.frequencyBucket))];
    opacity = selected ? 0.82 : path ? 0.72 : connected ? 0.58 : now - route.lastHeard <= ROUTE_FRESH_MS ? 0.5 : 0.28;
  }
  const emphasis = selected || path ? 1.85 : connected ? 1.35 : 1;
  return createSegmentArcMesh(route.id, { from: route.from, to: route.to, distanceKm: route.distanceKm, routeId: route.id }, color, opacity, emphasis, input.packetVisualSettings.renderQuality);
}

function createSegmentArcMesh(
  name: string,
  segment: Pick<PublicRoutePulse['segments'][number], 'from' | 'to' | 'distanceKm' | 'routeId'>,
  color: string,
  opacity: number,
  emphasis: number,
  quality: RenderQuality = 'balanced'
): THREE.Object3D {
  const samples = sampleRouteArc(segment.from, segment.to, { distanceKm: segment.distanceKm, heightScale: emphasis });
  const points = samples.map((sample) => mercatorVector(sample));
  const curve = new THREE.CatmullRomCurve3(points);
  const midpoint = samples[Math.floor(samples.length / 2)] ?? samples[0];
  const scale = meterScale(midpoint.lng, midpoint.lat);
  const radius = scale * clamp(90 + Math.sqrt(Math.max(1, segment.distanceKm)) * 18 * emphasis, 80, 2200);
  const geometry = new THREE.TubeGeometry(curve, routeArcTubularSegments(samples.length, emphasis, quality), radius, routeArcRadialSegments(emphasis, quality), false);
  const mesh = new THREE.Mesh(geometry, material(hexNumber(color), opacity, true));
  mesh.name = `route-arc:${name}`;
  return mesh;
}

export function routeArcTubularSegments(sampleCount: number, emphasis: number, quality: RenderQuality = 'balanced'): number {
  const base = Math.max(6, sampleCount - 1);
  const qualityScale = quality === 'high' ? 1 : quality === 'smooth' ? 0.56 : 0.76;
  if (emphasis >= 1.6) return Math.max(6, Math.round(base * qualityScale));
  if (emphasis >= 1.25) return Math.max(5, Math.round(base * qualityScale * 0.84));
  return Math.max(4, Math.round(base * qualityScale * 0.66));
}

export function routeArcRadialSegments(emphasis: number, quality: RenderQuality = 'balanced'): number {
  if (quality === 'smooth') return emphasis >= 1.6 ? 3 : 2;
  if (quality === 'high') {
    if (emphasis >= 1.6) return 5;
    if (emphasis >= 1.25) return 4;
    return 3;
  }
  return emphasis >= 1.6 ? 4 : 3;
}

function createComet(input: Omit<ActiveComet, 'root' | 'head' | 'halo' | 'cone' | 'trail' | 'trailGeometry' | 'trailPositions' | 'maxTrailPoints' | 'paths' | 'tailTarget'>): ActiveComet {
  const root = new THREE.Group();
  const color = hexNumber(input.color || '#67e8f9');
  const head = new THREE.Mesh(new THREE.SphereGeometry(700, 16, 10), material(0xffffff, 0.96, true));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1320, 16, 10), material(color, 0.28, true));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(420, 1100, 16), material(color, 0.82, true));
  cone.geometry.rotateX(Math.PI / 2);
  const paths = buildCometSegmentPaths(input.segments, input.force ? 1.5 : 1.15);
  const maxTrailPoints = Math.max(2, Math.max(...paths.map((path) => path.samples.length + 2), 2));
  const trailPositions = new Float32Array(maxTrailPoints * 3);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.74, blending: THREE.AdditiveBlending, depthWrite: false }));
  root.add(trail, halo, head, cone);
  return { ...input, paths, root, head, halo, cone, trail, trailGeometry, trailPositions, maxTrailPoints, tailTarget: new THREE.Vector3() };
}

function updateComet(comet: ActiveComet, elapsed: number) {
  const travelProgress = Math.min(1, elapsed / comet.travelDuration);
  const afterglow = elapsed > comet.travelDuration ? 1 - clamp((elapsed - comet.travelDuration) / comet.afterglowDuration, 0, 1) : 1;
  const state = sequentialSegmentProgress(travelProgress, comet.segments.length);
  const path = comet.paths[state.segmentIndex] ?? comet.paths[0];
  if (!path) return;
  writeArcVectorAt(path, state.localProgress, comet.head.position);
  const trailProgress = (comet.animationStyle === 'minimal' ? 0.05 : comet.animationStyle === 'pulse' ? 0.1 : 0.16) * Math.max(0.2, comet.trailScale);
  comet.halo.position.copy(comet.head.position);
  comet.cone.position.copy(comet.head.position);
  const trailPointCount = updateCometTrailGeometry(comet, path, state.localProgress, trailProgress);
  if (trailPointCount >= 2) {
    const tailIndex = Math.max(0, trailPointCount - 2);
    comet.tailTarget.set(
      comet.trailPositions[tailIndex * 3],
      comet.trailPositions[tailIndex * 3 + 1],
      comet.trailPositions[tailIndex * 3 + 2]
    );
    comet.cone.lookAt(comet.tailTarget);
  }
  const pulse = 0.76 + Math.sin(performance.now() / 90) * 0.18;
  comet.root.visible = afterglow > 0.01;
  comet.root.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    const mat = mesh.material as THREE.Material & { opacity?: number };
    if (mat && 'opacity' in mat) mat.opacity = Math.min(1, (object === comet.halo ? 0.24 : 0.9) * afterglow * comet.brightness * pulse);
  });
}

export function buildCometSegmentPaths(segments: PublicRoutePulse['segments'], heightScale: number): CometSegmentPath[] {
  return segments.map((segment) => {
    const samples = sampleRouteArc(segment.from, segment.to, { distanceKm: segment.distanceKm, heightScale });
    return { samples, vectors: samples.map((sample) => mercatorVector(sample)) };
  });
}

function writeArcVectorAt(path: CometSegmentPath, progress: number, target: THREE.Vector3): THREE.Vector3 {
  if (path.vectors.length === 0) return target.set(0, 0, 0);
  if (path.vectors.length === 1) return target.copy(path.vectors[0]);
  const clamped = clamp(progress, 0, 1);
  const scaled = clamped * (path.vectors.length - 1);
  const index = Math.min(path.vectors.length - 2, Math.floor(scaled));
  const local = scaled - index;
  return target.copy(path.vectors[index]).lerp(path.vectors[index + 1], local);
}

function updateCometTrailGeometry(comet: ActiveComet, path: CometSegmentPath, headProgress: number, trailProgress: number): number {
  const samples = arcTrailSamples(path.samples, headProgress, trailProgress);
  const count = Math.min(comet.maxTrailPoints, samples.length);
  for (let index = 0; index < count; index++) {
    const vector = writeArcVectorAt(path, samples[index].progress, comet.tailTarget);
    comet.trailPositions[index * 3] = vector.x;
    comet.trailPositions[index * 3 + 1] = vector.y;
    comet.trailPositions[index * 3 + 2] = vector.z;
  }
  comet.trailGeometry.setDrawRange(0, count);
  const position = comet.trailGeometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (position) position.needsUpdate = true;
  return count;
}

function createObserverGlow(burst: PublicObserverBurst): ObserverGlow {
  const color = payloadVisual(burst.payloadTypeName).color;
  const root = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(800, 32, 8, 32), material(hexNumber(color), 0.54, true));
  ring.rotation.x = Math.PI / 2;
  root.add(ring);
  const baseScale = positionAtLngLat(root, burst.location.lng, burst.location.lat, 80);
  return { key: `${burst.location.label}|${burst.heardAt}`, started: performance.now(), color, lng: burst.location.lng, lat: burst.location.lat, baseScale, root, ring };
}

function updateObserverGlow(glow: ObserverGlow, elapsed: number) {
  const progress = clamp(elapsed / OBSERVER_GLOW_MS, 0, 1);
  const scale = 1 + progress * 3.4;
  glow.root.scale.setScalar(glow.baseScale * scale);
  const mat = glow.ring.material as THREE.Material & { opacity?: number };
  if ('opacity' in mat) mat.opacity = (1 - progress) * 0.5;
}

function trimActiveComets(root: THREE.Group, comets: ActiveComet[], budget: number) {
  while (comets.length > budget) {
    const dropped = comets.shift();
    if (!dropped) continue;
    root.remove(dropped.root);
    disposeObject(dropped.root);
  }
}

function trimObserverGlows(root: THREE.Group, glows: ObserverGlow[], budget: number) {
  while (glows.length > budget) {
    const dropped = glows.shift();
    if (!dropped) continue;
    root.remove(dropped.root);
    disposeObject(dropped.root);
  }
}

function nodeSceneSignature(map: maplibregl.Map, input: OpenFreeMap3DUpdate, selectedNodes: PublicNode[] = selectOpenFreeMap3DNodes(map, input)): string {
  const zoom = map.getZoom();
  return [
    input.layerSettings.nodes,
    input.layerSettings.nodeModels3D,
    input.packetVisualSettings.renderQuality,
    input.themeMode,
    viewSignature(map),
    input.focus.selectedNodeID ?? '',
    stableSetSignature(input.focus.pathNodeIDs),
    stableSetSignature(input.focus.neighbourNodeIDs),
    selectedNodes.map((node) => `${node.id}:${nodeModelLOD(node, input.focus, zoom)}:${node.role}:${node.isObserver ? 1 : 0}:${node.latitude.toFixed(4)}:${node.longitude.toFixed(4)}`).join('|')
  ].join('~');
}

function routeSceneSignature(
  map: maplibregl.Map,
  input: OpenFreeMap3DUpdate,
  now = Date.now(),
  selectedRoutes: PublicRoute[] = selectOpenFreeMap3DRoutes(map, input, now)
): string {
  return [
    input.layerSettings.routes,
    input.layerSettings.routeArcs3D,
    input.layerSettings.analysisPaths,
    input.layerSettings.terrainLOS,
    input.packetVisualSettings.renderQuality,
    input.selectedRouteID ?? '',
    viewSignature(map),
    stableSetSignature(input.focus.connectedRouteIDs),
    stableSetSignature(input.focus.pathRouteIDs),
    input.analysisSegments.map((segment) => `${segment.routeId}:${segment.from.lat.toFixed(4)}:${segment.from.lng.toFixed(4)}:${segment.to.lat.toFixed(4)}:${segment.to.lng.toFixed(4)}`).join('|'),
    selectedRoutes.map((route) => `${route.id}:${route.frequencyBucket}:${Math.floor(route.lastHeard / ROUTE_FRESH_MS)}:${route.from.lat.toFixed(4)}:${route.from.lng.toFixed(4)}:${route.to.lat.toFixed(4)}:${route.to.lng.toFixed(4)}`).join('|')
  ].join('~');
}

function viewSignature(map: Map3DViewport): string {
  const bounds = map.getBounds();
  return [
    Math.floor(map.getZoom() * 2) / 2,
    bounds.getWest().toFixed(1),
    bounds.getSouth().toFixed(1),
    bounds.getEast().toFixed(1),
    bounds.getNorth().toFixed(1)
  ].join(':');
}

function routePriority(route: PublicRoute, input: OpenFreeMap3DUpdate, now: number): number {
  let score = route.packetCount * 0.02 + Math.max(0, 5 - route.frequencyBucket) * 12;
  if (route.id === input.selectedRouteID) score += 10_000;
  if (input.focus.pathRouteIDs.has(route.id)) score += 8000;
  if (input.focus.connectedRouteIDs.has(route.id)) score += 3000;
  if (now - route.lastHeard <= ROUTE_FRESH_MS) score += 1400;
  score += Math.min(1000, Math.max(0, route.distanceKm));
  return score;
}

function nodePriority(node: PublicNode, focus: NodeFocus): number {
  let score = node.activityCount;
  if (node.id === focus.selectedNodeID) score += 10_000;
  if (focus.pathNodeIDs.has(node.id)) score += 7000;
  if (focus.neighbourNodeIDs.has(node.id)) score += 2500;
  if (node.isObserver) score += 900;
  return score;
}

export function openFreeMap3DCometBudget(quality: RenderQuality = 'balanced'): number {
  if (quality === 'smooth') return 72;
  if (quality === 'high') return MAX_3D_ACTIVE_COMETS;
  return 120;
}

export function openFreeMap3DObserverGlowBudget(quality: RenderQuality = 'balanced'): number {
  if (quality === 'smooth') return 32;
  if (quality === 'high') return MAX_3D_OBSERVER_GLOWS;
  return 54;
}

function renderQualityScale(quality: RenderQuality): number {
  if (quality === 'smooth') return 0.58;
  if (quality === 'high') return 1.22;
  return 1;
}

function paddedBounds(map: Map3DViewport, factor: number) {
  const bounds = map.getBounds();
  const lngPad = Math.max(0.05, (bounds.getEast() - bounds.getWest()) * factor);
  const latPad = Math.max(0.05, (bounds.getNorth() - bounds.getSouth()) * factor);
  return {
    west: bounds.getWest() - lngPad,
    east: bounds.getEast() + lngPad,
    south: bounds.getSouth() - latPad,
    north: bounds.getNorth() + latPad
  };
}

function boundsContains(bounds: { west: number; east: number; south: number; north: number }, lng: number, lat: number): boolean {
  return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function mercatorVector(sample: ArcSample): THREE.Vector3 {
  const coordinate = maplibregl.MercatorCoordinate.fromLngLat({ lng: sample.lng, lat: sample.lat }, sample.altitudeMeters);
  return new THREE.Vector3(coordinate.x, coordinate.y, coordinate.z);
}

function positionAtLngLat(object: THREE.Object3D, lng: number, lat: number, altitudeMeters: number): number {
  const coordinate = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, altitudeMeters);
  object.position.set(coordinate.x, coordinate.y, coordinate.z);
  const scale = coordinate.meterInMercatorCoordinateUnits();
  object.scale.set(scale, scale, scale);
  return scale;
}

function meterScale(lng: number, lat: number): number {
  return maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0).meterInMercatorCoordinateUnits();
}

function addBox(group: THREE.Group, width: number, depth: number, height: number, color: number, opacity: number, z: number) {
  const g = poolG(poolK('box', width, depth, height), () => new THREE.BoxGeometry(width, depth, height));
  const m = new THREE.Mesh(g, material(color, opacity)); m.position.z = z; group.add(m);
}
function addCylinder(group: THREE.Group, radiusTop: number, radiusBottom: number, height: number, color: number, opacity: number, z: number, x = 0, y = 0) {
  const g = poolG(poolK('cyl', radiusTop, radiusBottom, height), () => { const c = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 12); c.rotateX(Math.PI / 2); return c; });
  const m = new THREE.Mesh(g, material(color, opacity)); m.position.set(x, y, z); group.add(m);
}
function addCone(group: THREE.Group, radius: number, height: number, color: number, opacity: number, z: number, x = 0, y = 0) {
  const g = poolG(poolK('cone', radius, height), () => { const c = new THREE.ConeGeometry(radius, height, 16); c.rotateX(Math.PI / 2); return c; });
  const m = new THREE.Mesh(g, material(color, opacity, true)); m.position.set(x, y, z); group.add(m);
}
function addSphere(group: THREE.Group, radius: number, color: number, opacity: number, z: number) {
  const g = poolG(poolK('sphere', radius), () => new THREE.SphereGeometry(radius, 16, 10));
  const m = new THREE.Mesh(g, material(color, opacity, true)); m.position.z = z; group.add(m);
}
function addTorus(group: THREE.Group, radius: number, tube: number, color: number, opacity: number, z: number) {
  const g = poolG(poolK('torus', radius, tube), () => new THREE.TorusGeometry(radius, tube, 8, 32));
  const m = new THREE.Mesh(g, material(color, opacity, true)); m.rotation.x = Math.PI / 2; m.position.z = z; group.add(m);
}

function material(color: number, opacity: number, additive = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1 || additive, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !additive, toneMapped: false });
}
function nodeColor(node: PublicNode): string { if(node.isObserver)return'#f59e0b';if(node.role==='repeater')return'#22c55e';if(node.role==='companion')return'#3b82f6';if(node.role==='room_server')return'#a855f7';if(node.role==='sensor')return'#65a30d';return'#94a3b8'; }
function hexNumber(color: string): number { return /^#[0-9a-fA-F]{6}$/.test(color) ? parseInt(color.slice(1), 16) : 0x67e8f9; }

function clearGroup(group: THREE.Group) {
  for (const c of [...group.children]) { group.remove(c); disposeGK(c); }
}
function disposeObject(object: THREE.Object3D) {
  object.traverse((c) => { if (!(c instanceof THREE.Mesh)) return; if (!isPooled(c.geometry)) c.geometry?.dispose?.(); const m = c.material as THREE.Material|THREE.Material[]|undefined; if (Array.isArray(m)) m.forEach(x => x.dispose()); else m?.dispose?.(); });
}

function stableSetSignature(values: Set<string>): string {
  return [...values].sort().join(',');
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return 2100;
  return Math.max(500, Math.min(12_000, Math.round(value)));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
