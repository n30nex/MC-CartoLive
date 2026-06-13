import type maplibregl from 'maplibre-gl';

export type MapStyleProfileID =
  | 'classic-dark'
  | 'classic-light'
  | 'openfreemap-dark'
  | 'openfreemap-light'
  | 'topo-rf'
  | 'noc'
  | 'offline-pmtiles'
  | 'low-bandwidth';

export interface MapStyleProfile {
  id: MapStyleProfileID;
  label: string;
  baseMode: 'raster' | 'vector' | 'pmtiles';
  theme: 'dark' | 'light' | 'noc' | 'topo';
  defaultPitch: number;
  defaultBearing: number;
  supportsTerrain: boolean;
  supports3D: boolean;
  supportsOffline: boolean;
  lowBandwidth: boolean;
  style?: maplibregl.StyleSpecification | string;
}

export const MAP_STYLE_PROFILES: readonly MapStyleProfile[] = [
  { id: 'classic-dark', label: 'Classic Dark', baseMode: 'raster', theme: 'dark', defaultPitch: 0, defaultBearing: 0, supportsTerrain: false, supports3D: false, supportsOffline: false, lowBandwidth: false },
  { id: 'classic-light', label: 'Classic Light', baseMode: 'raster', theme: 'light', defaultPitch: 0, defaultBearing: 0, supportsTerrain: false, supports3D: false, supportsOffline: false, lowBandwidth: false },
  { id: 'openfreemap-dark', label: 'OpenFreeMap Dark', baseMode: 'vector', theme: 'dark', defaultPitch: 50, defaultBearing: -18, supportsTerrain: true, supports3D: true, supportsOffline: false, lowBandwidth: false },
  { id: 'openfreemap-light', label: 'OpenFreeMap Light', baseMode: 'vector', theme: 'light', defaultPitch: 50, defaultBearing: -18, supportsTerrain: true, supports3D: true, supportsOffline: false, lowBandwidth: false },
  { id: 'topo-rf', label: 'Topo RF', baseMode: 'vector', theme: 'topo', defaultPitch: 35, defaultBearing: 0, supportsTerrain: true, supports3D: false, supportsOffline: true, lowBandwidth: false },
  { id: 'noc', label: 'NOC', baseMode: 'raster', theme: 'noc', defaultPitch: 0, defaultBearing: 0, supportsTerrain: false, supports3D: false, supportsOffline: false, lowBandwidth: true },
  { id: 'offline-pmtiles', label: 'Offline PMTiles', baseMode: 'pmtiles', theme: 'topo', defaultPitch: 0, defaultBearing: 0, supportsTerrain: true, supports3D: false, supportsOffline: true, lowBandwidth: true },
  { id: 'low-bandwidth', label: 'Low Bandwidth', baseMode: 'raster', theme: 'dark', defaultPitch: 0, defaultBearing: 0, supportsTerrain: false, supports3D: false, supportsOffline: true, lowBandwidth: true }
] as const;

export function mapStyleProfileByID(id: string | undefined, fallback: MapStyleProfileID = 'classic-dark'): MapStyleProfile {
  return MAP_STYLE_PROFILES.find((profile) => profile.id === id) ?? MAP_STYLE_PROFILES.find((profile) => profile.id === fallback)!;
}

export function publicStyleProfileIDs(): MapStyleProfileID[] {
  return MAP_STYLE_PROFILES.map((profile) => profile.id);
}
