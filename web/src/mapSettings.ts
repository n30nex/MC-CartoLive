export type PacketAnimationStyle = 'comet' | 'pulse' | 'minimal';
export type RenderQuality = 'smooth' | 'balanced' | 'high';

export interface MapLayerSettings {
  clusters: boolean;
  activityHeatmap: boolean;
  nodes: boolean;
  nodeLabels: boolean;
  routes: boolean;
  analysisPaths: boolean;
  liveComets: boolean;
  packetResidue: boolean;
  observerBursts: boolean;
  messageBubbles: boolean;
  nodeModels3D: boolean;
  routeArcs3D: boolean;
  packetComets3D: boolean;
  buildingExtrusions: boolean;
  terrainLOS: boolean;
  terrainHeightmap: boolean;
}

export interface PacketVisualSettings {
  speed: number;
  brightness: number;
  trail: number;
  animationStyle: PacketAnimationStyle;
  showLiveCometsAtAllZooms: boolean;
  renderQuality: RenderQuality;
}

export interface MapSettings {
  layers: MapLayerSettings;
  packets: PacketVisualSettings;
}

export const MAP_SETTINGS_STORAGE_KEY = 'mc-cartolive-map-settings';

export const DEFAULT_MAP_LAYER_SETTINGS: MapLayerSettings = {
  clusters: true,
  activityHeatmap: true,
  nodes: true,
  nodeLabels: true,
  routes: true,
  analysisPaths: true,
  liveComets: true,
  packetResidue: true,
  observerBursts: true,
  messageBubbles: true,
  nodeModels3D: true,
  routeArcs3D: true,
  packetComets3D: true,
  buildingExtrusions: true,
  terrainLOS: false,
  terrainHeightmap: true
};

export const DEFAULT_PACKET_VISUAL_SETTINGS: PacketVisualSettings = {
  speed: 1,
  brightness: 1,
  trail: 1,
  animationStyle: 'comet',
  showLiveCometsAtAllZooms: false,
  renderQuality: 'balanced'
};

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  layers: DEFAULT_MAP_LAYER_SETTINGS,
  packets: DEFAULT_PACKET_VISUAL_SETTINGS
};

export function normalizeMapSettings(input: unknown): MapSettings {
  const raw = isRecord(input) ? input : {};
  return {
    layers: normalizeLayerSettings(raw.layers),
    packets: normalizePacketVisualSettings(raw.packets)
  };
}

export function normalizeLayerSettings(input: unknown): MapLayerSettings {
  const raw = isRecord(input) ? input : {};
  return {
    clusters: boolOrDefault(raw.clusters, DEFAULT_MAP_LAYER_SETTINGS.clusters),
    activityHeatmap: boolOrDefault(raw.activityHeatmap, DEFAULT_MAP_LAYER_SETTINGS.activityHeatmap),
    nodes: boolOrDefault(raw.nodes, DEFAULT_MAP_LAYER_SETTINGS.nodes),
    nodeLabels: boolOrDefault(raw.nodeLabels, DEFAULT_MAP_LAYER_SETTINGS.nodeLabels),
    routes: boolOrDefault(raw.routes, DEFAULT_MAP_LAYER_SETTINGS.routes),
    analysisPaths: boolOrDefault(raw.analysisPaths, DEFAULT_MAP_LAYER_SETTINGS.analysisPaths),
    liveComets: boolOrDefault(raw.liveComets, DEFAULT_MAP_LAYER_SETTINGS.liveComets),
    packetResidue: boolOrDefault(raw.packetResidue, DEFAULT_MAP_LAYER_SETTINGS.packetResidue),
    observerBursts: boolOrDefault(raw.observerBursts, DEFAULT_MAP_LAYER_SETTINGS.observerBursts),
    messageBubbles: boolOrDefault(raw.messageBubbles, DEFAULT_MAP_LAYER_SETTINGS.messageBubbles),
    nodeModels3D: boolOrDefault(raw.nodeModels3D, DEFAULT_MAP_LAYER_SETTINGS.nodeModels3D),
    routeArcs3D: boolOrDefault(raw.routeArcs3D, DEFAULT_MAP_LAYER_SETTINGS.routeArcs3D),
    packetComets3D: boolOrDefault(raw.packetComets3D, DEFAULT_MAP_LAYER_SETTINGS.packetComets3D),
    buildingExtrusions: boolOrDefault(raw.buildingExtrusions, DEFAULT_MAP_LAYER_SETTINGS.buildingExtrusions),
    terrainLOS: boolOrDefault(raw.terrainLOS, DEFAULT_MAP_LAYER_SETTINGS.terrainLOS),
    terrainHeightmap: boolOrDefault(raw.terrainHeightmap, DEFAULT_MAP_LAYER_SETTINGS.terrainHeightmap)
  };
}

export function normalizePacketVisualSettings(input: unknown): PacketVisualSettings {
  const raw = isRecord(input) ? input : {};
  return {
    speed: clampNumber(raw.speed, 0.5, 3, DEFAULT_PACKET_VISUAL_SETTINGS.speed),
    brightness: clampNumber(raw.brightness, 0.4, 1.6, DEFAULT_PACKET_VISUAL_SETTINGS.brightness),
    trail: clampNumber(raw.trail, 0, 2, DEFAULT_PACKET_VISUAL_SETTINGS.trail),
    animationStyle: isPacketAnimationStyle(raw.animationStyle) ? raw.animationStyle : DEFAULT_PACKET_VISUAL_SETTINGS.animationStyle,
    showLiveCometsAtAllZooms: boolOrDefault(raw.showLiveCometsAtAllZooms, DEFAULT_PACKET_VISUAL_SETTINGS.showLiveCometsAtAllZooms),
    renderQuality: isRenderQuality(raw.renderQuality) ? raw.renderQuality : DEFAULT_PACKET_VISUAL_SETTINGS.renderQuality
  };
}

export function readStoredMapSettings(): MapSettings {
  if (typeof window === 'undefined') return DEFAULT_MAP_SETTINGS;
  try {
    const raw = window.localStorage.getItem(MAP_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_MAP_SETTINGS;
    return normalizeMapSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_MAP_SETTINGS;
  }
}

export function writeStoredMapSettings(settings: MapSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MAP_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeMapSettings(settings)));
}

export function isPacketAnimationStyle(value: unknown): value is PacketAnimationStyle {
  return value === 'comet' || value === 'pulse' || value === 'minimal';
}

export function isRenderQuality(value: unknown): value is RenderQuality {
  return value === 'smooth' || value === 'balanced' || value === 'high';
}

export function layerSettingsSignature(settings: MapLayerSettings): string {
  return [
    settings.clusters,
    settings.activityHeatmap,
    settings.nodes,
    settings.nodeLabels,
    settings.routes,
    settings.analysisPaths,
    settings.liveComets,
    settings.packetResidue,
    settings.observerBursts,
    settings.messageBubbles,
    settings.nodeModels3D,
    settings.routeArcs3D,
    settings.packetComets3D,
    settings.buildingExtrusions
  ].map((value) => (value ? '1' : '0')).join('');
}

export function packetVisualSignature(settings: PacketVisualSettings): string {
  return `${settings.speed.toFixed(2)}:${settings.brightness.toFixed(2)}:${settings.trail.toFixed(2)}:${settings.animationStyle}:${settings.showLiveCometsAtAllZooms ? '1' : '0'}:${settings.renderQuality}`;
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
