import type maplibregl from 'maplibre-gl';

export type MapStyleProfileID =
  | 'classic-dark'
  | 'classic-light'
  | 'openfreemap-dark'
  | 'openfreemap-light'
  | 'openfreemap-positron'
  | 'openfreemap-liberty'
  | 'openfreemap-fiord'
  | 'openfreemap-3d'
  | 'topo-rf'
  | 'noc'
  | 'offline-pmtiles'
  | 'field-offline'
  | 'accessibility'
  | 'low-bandwidth';

export type TerrainPresentation = 'flat' | 'hillshade' | 'topographic';

export interface MapStyleProfile {
  id: MapStyleProfileID;
  label: string;
  description: string;
  baseMode: 'raster' | 'vector' | 'pmtiles';
  theme: 'dark' | 'light' | 'noc' | 'topo';
  defaultPitch: number;
  defaultBearing: number;
  supportsTerrain: boolean;
  terrainDefault: boolean;
  terrainPresentation: TerrainPresentation;
  supports3D: boolean;
  supportsOffline: boolean;
  lowBandwidth: boolean;
  sourceLabel: string;
  style?: maplibregl.StyleSpecification | string;
}

export const MAP_STYLE_PROFILES: readonly MapStyleProfile[] = [
  { id: 'classic-dark', label: 'Classic Dark', description: 'Black traffic-first canvas for high route contrast.', baseMode: 'raster', theme: 'dark', defaultPitch: 0, defaultBearing: 0, supportsTerrain: true, terrainDefault: false, terrainPresentation: 'hillshade', supports3D: false, supportsOffline: false, lowBandwidth: false, sourceLabel: 'local black canvas' },
  { id: 'classic-light', label: 'Classic Light', description: 'Bright daytime raster map with darker overlay contrast.', baseMode: 'raster', theme: 'light', defaultPitch: 0, defaultBearing: 0, supportsTerrain: true, terrainDefault: false, terrainPresentation: 'hillshade', supports3D: false, supportsOffline: false, lowBandwidth: false, sourceLabel: 'CARTO raster' },
  { id: 'openfreemap-dark', label: 'OpenFreeMap Dark', description: 'Internal vector style tuned for live RF overlays.', baseMode: 'vector', theme: 'dark', defaultPitch: 50, defaultBearing: -18, supportsTerrain: true, terrainDefault: false, terrainPresentation: 'hillshade', supports3D: true, supportsOffline: false, lowBandwidth: false, sourceLabel: 'OpenFreeMap vector' },
  { id: 'openfreemap-light', label: 'OpenFreeMap Light', description: 'Internal light vector style for public readability.', baseMode: 'vector', theme: 'light', defaultPitch: 50, defaultBearing: -18, supportsTerrain: true, terrainDefault: false, terrainPresentation: 'hillshade', supports3D: true, supportsOffline: false, lowBandwidth: false, sourceLabel: 'OpenFreeMap vector' },
  { id: 'openfreemap-positron', label: 'Positron', description: 'Clean light OpenFreeMap style for data-heavy overlays.', baseMode: 'vector', theme: 'light', defaultPitch: 42, defaultBearing: -12, supportsTerrain: true, terrainDefault: false, terrainPresentation: 'hillshade', supports3D: true, supportsOffline: false, lowBandwidth: false, sourceLabel: 'OpenFreeMap Positron', style: 'https://tiles.openfreemap.org/styles/positron' },
  { id: 'openfreemap-liberty', label: 'Liberty', description: 'General-purpose OpenFreeMap vector basemap.', baseMode: 'vector', theme: 'light', defaultPitch: 46, defaultBearing: -14, supportsTerrain: true, terrainDefault: false, terrainPresentation: 'hillshade', supports3D: true, supportsOffline: false, lowBandwidth: false, sourceLabel: 'OpenFreeMap Liberty', style: 'https://tiles.openfreemap.org/styles/liberty' },
  { id: 'openfreemap-fiord', label: 'Fiord', description: 'Muted cool vector map for route review.', baseMode: 'vector', theme: 'dark', defaultPitch: 46, defaultBearing: -14, supportsTerrain: true, terrainDefault: false, terrainPresentation: 'hillshade', supports3D: true, supportsOffline: false, lowBandwidth: false, sourceLabel: 'OpenFreeMap Fiord', style: 'https://tiles.openfreemap.org/styles/fiord' },
  { id: 'openfreemap-3d', label: 'OpenFreeMap 3D', description: 'Pitched terrain, buildings, route arcs, and node models.', baseMode: 'vector', theme: 'dark', defaultPitch: 62, defaultBearing: -24, supportsTerrain: true, terrainDefault: true, terrainPresentation: 'hillshade', supports3D: true, supportsOffline: false, lowBandwidth: false, sourceLabel: 'OpenFreeMap vector' },
  { id: 'topo-rf', label: 'Topo RF', description: 'Terrain-first RF planning profile with LOS-ready defaults.', baseMode: 'vector', theme: 'topo', defaultPitch: 38, defaultBearing: 0, supportsTerrain: true, terrainDefault: true, terrainPresentation: 'topographic', supports3D: true, supportsOffline: true, lowBandwidth: false, sourceLabel: 'OpenFreeMap + DEM' },
  { id: 'noc', label: 'NOC Wallboard', description: 'Low-clutter high-contrast operations wallboard.', baseMode: 'raster', theme: 'noc', defaultPitch: 0, defaultBearing: 0, supportsTerrain: true, terrainDefault: false, terrainPresentation: 'hillshade', supports3D: false, supportsOffline: false, lowBandwidth: true, sourceLabel: 'local low-detail' },
  { id: 'offline-pmtiles', label: 'Offline PMTiles', description: 'Operator-supplied PMTiles basemap with graceful fallback.', baseMode: 'pmtiles', theme: 'topo', defaultPitch: 0, defaultBearing: 0, supportsTerrain: true, terrainDefault: false, terrainPresentation: 'hillshade', supports3D: false, supportsOffline: true, lowBandwidth: true, sourceLabel: 'PMTiles' },
  { id: 'field-offline', label: 'Field Offline', description: 'Touch-friendly low-bandwidth profile for field use.', baseMode: 'pmtiles', theme: 'topo', defaultPitch: 0, defaultBearing: 0, supportsTerrain: true, terrainDefault: false, terrainPresentation: 'hillshade', supports3D: false, supportsOffline: true, lowBandwidth: true, sourceLabel: 'PMTiles/fallback' },
  { id: 'accessibility', label: 'Accessibility', description: 'High-contrast labels and calmer motion defaults.', baseMode: 'raster', theme: 'light', defaultPitch: 0, defaultBearing: 0, supportsTerrain: true, terrainDefault: false, terrainPresentation: 'hillshade', supports3D: false, supportsOffline: false, lowBandwidth: false, sourceLabel: 'CARTO raster' },
  { id: 'low-bandwidth', label: 'Low Bandwidth', description: 'No-frills local canvas basemap for weak clients.', baseMode: 'raster', theme: 'dark', defaultPitch: 0, defaultBearing: 0, supportsTerrain: false, terrainDefault: false, terrainPresentation: 'flat', supports3D: false, supportsOffline: true, lowBandwidth: true, sourceLabel: 'local low-detail' }
] as const;

export function mapStyleProfileByID(id: string | undefined, fallback: MapStyleProfileID = 'classic-dark'): MapStyleProfile {
  return MAP_STYLE_PROFILES.find((profile) => profile.id === id) ?? MAP_STYLE_PROFILES.find((profile) => profile.id === fallback)!;
}

export function publicStyleProfileIDs(): MapStyleProfileID[] {
  return MAP_STYLE_PROFILES.map((profile) => profile.id);
}

export function nextStyleProfileID(id: string | undefined): MapStyleProfileID {
  const ids = publicStyleProfileIDs();
  const index = ids.indexOf(mapStyleProfileByID(id).id);
  return ids[(index + 1) % ids.length];
}

export function styleProfileSupports3D(id: string | undefined): boolean {
  return mapStyleProfileByID(id).supports3D;
}
