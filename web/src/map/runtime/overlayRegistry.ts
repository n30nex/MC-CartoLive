import type maplibregl from 'maplibre-gl';

export type OverlayGroup = 'traffic' | 'analysis' | 'terrain' | 'weather' | 'coverage' | 'private';

export interface OverlayUpdateOptions {
  now: number;
  reason: 'init' | 'state' | 'visibility' | 'style';
}

export interface MapOverlay<TState = unknown> {
  id: string;
  label: string;
  group: OverlayGroup;
  publicSafe: boolean;
  defaultEnabled: boolean;
  requires?: string[];
  add?: (map: maplibregl.Map) => void;
  update?: (map: maplibregl.Map, state: TState, options: OverlayUpdateOptions) => void;
  setVisible?: (map: maplibregl.Map, visible: boolean) => void;
  remove?: (map: maplibregl.Map) => void;
}

export const CORE_OVERLAY_IDS = [
  'nodes',
  'routes',
  'liveComets',
  'observerBursts',
  'messageBubbles',
  'heatmap',
  'propagation',
  'terrain',
  'coverage',
  'los'
] as const;

export type CoreOverlayID = typeof CORE_OVERLAY_IDS[number];

export function createOverlayRegistry<TState>(overlays: readonly MapOverlay<TState>[]): Map<string, MapOverlay<TState>> {
  const registry = new Map<string, MapOverlay<TState>>();
  for (const overlay of overlays) {
    if (!overlay.id || registry.has(overlay.id)) {
      throw new Error(`duplicate map overlay id: ${overlay.id}`);
    }
    registry.set(overlay.id, overlay);
  }
  return registry;
}

export function publicDefaultOverlayIDs(overlays: readonly MapOverlay[]): string[] {
  return overlays.filter((overlay) => overlay.publicSafe && overlay.defaultEnabled).map((overlay) => overlay.id);
}
