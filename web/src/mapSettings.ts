import { mapStyleProfileByID, type MapStyleProfileID } from './map/styles/styleRegistry';

export type PacketAnimationStyle = 'comet' | 'pulse' | 'minimal';
export type RenderQuality = 'smooth' | 'balanced' | 'high';
export type NodeModelStyle = 'role-towers' | 'signal-beacons' | 'minimal-pins';
export type MapModeID = 'watch' | 'explore' | 'terrain' | 'studio';

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
  weatherClouds: boolean;
  propagationInsights: boolean;
}

export interface PacketVisualSettings {
  speed: number;
  brightness: number;
  trail: number;
  animationStyle: PacketAnimationStyle;
  showLiveCometsAtAllZooms: boolean;
  renderQuality: RenderQuality;
}

export interface MapStyleSettings {
  profileID: MapStyleProfileID;
  basemapDim: number;
  labelDensity: number;
  terrainClarity: number;
  buildingOpacity: number;
  nodeModelStyle: NodeModelStyle;
  nodeModelScale: number;
  nodeAltitudeMeters: number;
  routeArcAltitudeScale: number;
}

export interface MapSettings {
  modeID: MapModeID;
  customized: boolean;
  style: MapStyleSettings;
  layers: MapLayerSettings;
  packets: PacketVisualSettings;
}

export type MapLayerPresetID = 'live' | 'clean' | 'analysis' | '3d';

export interface MapLayerPreset {
  id: MapLayerPresetID;
  label: string;
  hint: string;
  layers: MapLayerSettings;
}

export interface MapModeDefinition {
  id: MapModeID;
  label: string;
  shortLabel: string;
  hint: string;
  profileID: MapStyleProfileID;
  layers: MapLayerSettings;
  packetVisuals?: Partial<PacketVisualSettings>;
}

export const MAP_SETTINGS_STORAGE_KEY = 'mc-cartolive-map-settings';
export const MAP_SETTINGS_SCHEMA_VERSION = 8;

export const DEFAULT_MAP_LAYER_SETTINGS: MapLayerSettings = {
  clusters: true,
  activityHeatmap: true,
  nodes: true,
  nodeLabels: true,
  routes: false,
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
  terrainHeightmap: false,
  weatherClouds: true,
  propagationInsights: false
};

export const DEFAULT_PACKET_VISUAL_SETTINGS: PacketVisualSettings = {
  speed: 1,
  brightness: 1,
  trail: 1,
  animationStyle: 'comet',
  showLiveCometsAtAllZooms: true,
  renderQuality: 'balanced'
};

export const DEFAULT_MAP_STYLE_SETTINGS: MapStyleSettings = {
  profileID: 'classic-dark',
  basemapDim: 0,
  labelDensity: 0.72,
  terrainClarity: 62,
  buildingOpacity: 0.62,
  nodeModelStyle: 'role-towers',
  nodeModelScale: 1,
  nodeAltitudeMeters: 14,
  routeArcAltitudeScale: 1
};

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  modeID: 'watch',
  customized: false,
  style: DEFAULT_MAP_STYLE_SETTINGS,
  layers: DEFAULT_MAP_LAYER_SETTINGS,
  packets: DEFAULT_PACKET_VISUAL_SETTINGS
};

export const MAP_LAYER_PRESETS: readonly MapLayerPreset[] = [
  {
    id: 'live',
    label: 'Default',
    hint: 'First-view traffic at every zoom: comets, clustered activity, trails, nodes, and quiet route lines.',
    layers: { ...DEFAULT_MAP_LAYER_SETTINGS }
  },
  {
    id: 'clean',
    label: 'Clean',
    hint: 'Minimal map for watching current packet movement.',
    layers: {
      ...DEFAULT_MAP_LAYER_SETTINGS,
      activityHeatmap: false,
      analysisPaths: false,
      packetResidue: false,
      observerBursts: false,
      messageBubbles: false,
      nodeModels3D: false,
      routeArcs3D: false,
      packetComets3D: false,
      buildingExtrusions: false,
      terrainHeightmap: false
    }
  },
  {
    id: 'analysis',
    label: 'Analysis',
    hint: 'Routes, selected paths, and propagation context for RF review.',
    layers: {
      ...DEFAULT_MAP_LAYER_SETTINGS,
      routes: true,
      analysisPaths: true,
      propagationInsights: true,
      terrainLOS: true
    }
  },
  {
    id: '3d',
    label: '3D',
    hint: 'Relief, buildings, route arcs, and 3D packet motion.',
    layers: {
      ...DEFAULT_MAP_LAYER_SETTINGS,
      routes: true,
      nodeModels3D: true,
      routeArcs3D: true,
      packetComets3D: true,
      buildingExtrusions: true,
      terrainLOS: true,
      terrainHeightmap: true
    }
  }
];

export const MAP_MODES: readonly MapModeDefinition[] = [
  {
    id: 'watch',
    label: 'Watch',
    shortLabel: 'Watch',
    hint: 'Recent traffic at every zoom: comets, clustered activity glow, nodes, and quiet routes.',
    profileID: 'classic-dark',
    layers: { ...DEFAULT_MAP_LAYER_SETTINGS },
    packetVisuals: { showLiveCometsAtAllZooms: true }
  },
  {
    id: 'explore',
    label: 'Explore',
    shortLabel: 'Explore',
    hint: 'Routes, labels, selected paths, and plotting tools for network review.',
    profileID: 'classic-dark',
    layers: {
      ...DEFAULT_MAP_LAYER_SETTINGS,
      routes: true,
      analysisPaths: true,
      propagationInsights: false,
      terrainLOS: false,
      terrainHeightmap: false
    }
  },
  {
    id: 'terrain',
    label: 'Terrain',
    shortLabel: 'Terrain',
    hint: 'Topo relief, terrain line-of-sight, and propagation context.',
    profileID: 'topo-rf',
    layers: {
      ...DEFAULT_MAP_LAYER_SETTINGS,
      routes: true,
      activityHeatmap: true,
      analysisPaths: true,
      terrainLOS: true,
      terrainHeightmap: true,
      propagationInsights: true,
      nodeModels3D: false,
      routeArcs3D: false,
      packetComets3D: false,
      buildingExtrusions: false
    }
  },
  {
    id: 'studio',
    label: 'Studio',
    shortLabel: 'Studio',
    hint: 'Pitched 3D map with buildings, node models, route arcs, and packet motion.',
    profileID: 'openfreemap-3d',
    layers: {
      ...DEFAULT_MAP_LAYER_SETTINGS,
      routes: true,
      nodeModels3D: true,
      routeArcs3D: true,
      packetComets3D: true,
      buildingExtrusions: true,
      terrainLOS: true,
      terrainHeightmap: true
    },
    packetVisuals: { renderQuality: 'balanced', animationStyle: 'comet' }
  }
] as const;

export function normalizeMapSettings(input: unknown): MapSettings {
  const raw = isRecord(input) ? input : {};
  const modeID = isMapModeID(raw.modeID) ? raw.modeID : DEFAULT_MAP_SETTINGS.modeID;
  return {
    modeID,
    customized: raw.customized === true,
    style: normalizeStyleSettings(raw.style),
    layers: normalizeLayerSettings(raw.layers),
    packets: normalizePacketVisualSettings(raw.packets)
  };
}

export function normalizeStyleSettings(input: unknown): MapStyleSettings {
  const raw = isRecord(input) ? input : {};
  return {
    profileID: mapStyleProfileByID(typeof raw.profileID === 'string' ? raw.profileID : undefined, DEFAULT_MAP_STYLE_SETTINGS.profileID).id,
    basemapDim: clampNumber(raw.basemapDim, 0, 0.78, DEFAULT_MAP_STYLE_SETTINGS.basemapDim),
    labelDensity: clampNumber(raw.labelDensity, 0, 1.4, DEFAULT_MAP_STYLE_SETTINGS.labelDensity),
    terrainClarity: normalizeTerrainClarity(raw),
    buildingOpacity: clampNumber(raw.buildingOpacity, 0, 1, DEFAULT_MAP_STYLE_SETTINGS.buildingOpacity),
    nodeModelStyle: isNodeModelStyle(raw.nodeModelStyle) ? raw.nodeModelStyle : DEFAULT_MAP_STYLE_SETTINGS.nodeModelStyle,
    nodeModelScale: clampNumber(raw.nodeModelScale, 0.55, 1.8, DEFAULT_MAP_STYLE_SETTINGS.nodeModelScale),
    nodeAltitudeMeters: clampNumber(raw.nodeAltitudeMeters, 0, 120, DEFAULT_MAP_STYLE_SETTINGS.nodeAltitudeMeters),
    routeArcAltitudeScale: clampNumber(raw.routeArcAltitudeScale, 0.35, 2.4, DEFAULT_MAP_STYLE_SETTINGS.routeArcAltitudeScale)
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
    terrainHeightmap: boolOrDefault(raw.terrainHeightmap, DEFAULT_MAP_LAYER_SETTINGS.terrainHeightmap),
    weatherClouds: boolOrDefault(raw.weatherClouds, DEFAULT_MAP_LAYER_SETTINGS.weatherClouds),
    propagationInsights: boolOrDefault(raw.propagationInsights, DEFAULT_MAP_LAYER_SETTINGS.propagationInsights)
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
    return normalizeStoredMapSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_MAP_SETTINGS;
  }
}

export function writeStoredMapSettings(settings: MapSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MAP_SETTINGS_STORAGE_KEY, JSON.stringify({
    schemaVersion: MAP_SETTINGS_SCHEMA_VERSION,
    ...normalizeMapSettings(settings)
  }));
}

export function applyMapLayerPreset(settings: MapSettings, presetID: MapLayerPresetID): MapSettings {
  const preset = MAP_LAYER_PRESETS.find((item) => item.id === presetID);
  return normalizeMapSettings({
    ...settings,
    customized: true,
    layers: preset ? preset.layers : settings.layers
  });
}

export function applyMapStyleProfile(settings: MapSettings, profileID: MapStyleProfileID): MapSettings {
  const profile = mapStyleProfileByID(profileID);
  const next: MapSettings = normalizeMapSettings({
    ...settings,
    customized: true,
    style: { ...settings.style, profileID: profile.id }
  });
  next.layers = {
    ...next.layers,
    terrainHeightmap: profile.terrainDefault
  };
  if (profile.id === 'openfreemap-3d') {
    next.layers = {
      ...next.layers,
      routes: true,
      nodeModels3D: true,
      routeArcs3D: true,
      packetComets3D: true,
      buildingExtrusions: true
    };
  } else if (profile.id === 'topo-rf') {
    next.layers = {
      ...next.layers,
      routes: true,
      terrainLOS: true,
      propagationInsights: true
    };
  } else if (profile.lowBandwidth) {
    next.layers = {
      ...next.layers,
      activityHeatmap: false,
      packetResidue: false,
      messageBubbles: false,
      buildingExtrusions: false,
      nodeModels3D: false,
      routeArcs3D: false,
      packetComets3D: false,
      weatherClouds: false
    };
    next.packets = { ...next.packets, renderQuality: 'smooth', animationStyle: next.packets.animationStyle === 'minimal' ? 'minimal' : 'pulse' };
  } else if (profile.id === 'accessibility') {
    next.style = { ...next.style, basemapDim: 0.18, labelDensity: 1.05 };
    next.packets = { ...next.packets, animationStyle: 'minimal', renderQuality: 'smooth' };
  }
  return normalizeMapSettings(next);
}

export function applyMapMode(settings: MapSettings, modeID: MapModeID): MapSettings {
  const mode = mapModeByID(modeID);
  return normalizeMapSettings({
    ...settings,
    modeID: mode.id,
    customized: false,
    style: { ...settings.style, profileID: mode.profileID },
    layers: mode.layers,
    packets: { ...settings.packets, ...(mode.packetVisuals ?? {}) }
  });
}

export function mapModeByID(modeID: string | undefined, fallback: MapModeID = 'watch'): MapModeDefinition {
  return MAP_MODES.find((mode) => mode.id === modeID) ?? MAP_MODES.find((mode) => mode.id === fallback)!;
}

export function mapModeForSettings(settings: MapSettings): MapModeDefinition {
  if (!settings.customized) return mapModeByID(settings.modeID);
  return inferMapMode(settings);
}

export function mapModeExactIDForSettings(settings: MapSettings): MapModeID | null {
  const styleID = settings.style.profileID;
  const layerSignature = layerSettingsSignature(settings.layers);
  return MAP_MODES.find((mode) => mode.profileID === styleID && layerSettingsSignature(mode.layers) === layerSignature)?.id ?? null;
}

export function mapLayerPresetIDForSettings(settings: MapLayerSettings): MapLayerPresetID | null {
  const signature = layerSettingsSignature(settings);
  return MAP_LAYER_PRESETS.find((preset) => layerSettingsSignature(preset.layers) === signature)?.id ?? null;
}

export function isPacketAnimationStyle(value: unknown): value is PacketAnimationStyle {
  return value === 'comet' || value === 'pulse' || value === 'minimal';
}

export function isRenderQuality(value: unknown): value is RenderQuality {
  return value === 'smooth' || value === 'balanced' || value === 'high';
}

export function isNodeModelStyle(value: unknown): value is NodeModelStyle {
  return value === 'role-towers' || value === 'signal-beacons' || value === 'minimal-pins';
}

export function isMapModeID(value: unknown): value is MapModeID {
  return value === 'watch' || value === 'explore' || value === 'terrain' || value === 'studio';
}

export function mapStyleSettingsSignature(settings: MapStyleSettings): string {
  return [
    settings.profileID,
    settings.basemapDim.toFixed(2),
    settings.labelDensity.toFixed(2),
    Math.round(settings.terrainClarity),
    settings.buildingOpacity.toFixed(2),
    settings.nodeModelStyle,
    settings.nodeModelScale.toFixed(2),
    Math.round(settings.nodeAltitudeMeters),
    settings.routeArcAltitudeScale.toFixed(2)
  ].join(':');
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
    settings.buildingExtrusions,
    settings.terrainLOS,
    settings.terrainHeightmap,
    settings.weatherClouds,
    settings.propagationInsights
  ].map((value) => (value ? '1' : '0')).join('');
}

export function packetVisualSignature(settings: PacketVisualSettings): string {
  return `${settings.speed.toFixed(2)}:${settings.brightness.toFixed(2)}:${settings.trail.toFixed(2)}:${settings.animationStyle}:${settings.showLiveCometsAtAllZooms ? '1' : '0'}:${settings.renderQuality}`;
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeTerrainClarity(raw: Record<string, unknown>): number {
  if ('terrainClarity' in raw) {
    return clampNumber(raw.terrainClarity, 0, 100, DEFAULT_MAP_STYLE_SETTINGS.terrainClarity);
  }
  const legacyExaggeration = clampNumber(raw.terrainExaggeration, 0.2, 3, Number.NaN);
  if (!Number.isFinite(legacyExaggeration)) return DEFAULT_MAP_STYLE_SETTINGS.terrainClarity;
  return clampNumber(((legacyExaggeration - 0.35) / 1.45) * 100, 0, 100, DEFAULT_MAP_STYLE_SETTINGS.terrainClarity);
}

function normalizeStoredMapSettings(input: unknown): MapSettings {
  const settings = normalizeMapSettings(input);
  const raw = isRecord(input) ? input : {};
  const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  if (schemaVersion < 2) {
    const layers = isRecord(raw.layers) ? raw.layers : {};
    if (layers.terrainHeightmap !== false) settings.layers.terrainHeightmap = false;
    if (layers.propagationInsights !== false) settings.layers.propagationInsights = false;
  }
  if (schemaVersion < 6) {
    const profile = mapStyleProfileByID(settings.style.profileID);
    if (!profile.terrainDefault) settings.layers.terrainHeightmap = false;
  }
  if (schemaVersion < 7 || !isMapModeID(raw.modeID)) {
    const inferred = inferMapMode(settings);
    settings.modeID = inferred.id;
    settings.customized = mapModeExactIDForSettings(settings) !== inferred.id;
  }
  if (schemaVersion < 8 && settings.modeID === 'watch' && !settings.customized) {
    const watch = mapModeByID('watch');
    settings.layers = { ...watch.layers };
    settings.packets = { ...settings.packets, ...(watch.packetVisuals ?? {}) };
    settings.customized = false;
  }
  return settings;
}

function inferMapMode(settings: MapSettings): MapModeDefinition {
  const profileID = settings.style.profileID;
  if (profileID === 'openfreemap-3d') return mapModeByID('studio');
  if (profileID === 'topo-rf' || settings.layers.terrainLOS || settings.layers.propagationInsights) return mapModeByID('terrain');
  if (settings.layers.routes) return mapModeByID('explore');
  return mapModeByID('watch');
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
