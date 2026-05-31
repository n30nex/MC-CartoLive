import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_SETTINGS,
  MAP_SETTINGS_STORAGE_KEY,
  normalizeMapSettings,
  readStoredMapSettings,
  writeStoredMapSettings
} from './mapSettings';

describe('map settings', () => {
  beforeEach(() => {
    window.localStorage.removeItem(MAP_SETTINGS_STORAGE_KEY);
  });

  it('clamps packet visuals and preserves layer booleans', () => {
    const settings = normalizeMapSettings({
      layers: { clusters: false, nodes: false, liveComets: false },
      packets: { speed: 99, brightness: 0.1, trail: 8, animationStyle: 'pulse', showLiveCometsAtAllZooms: true }
    });
    expect(settings.layers.clusters).toBe(false);
    expect(settings.layers.activityHeatmap).toBe(true);
    expect(settings.layers.nodes).toBe(false);
    expect(settings.layers.routes).toBe(true);
    expect(settings.layers.liveComets).toBe(false);
    expect(settings.layers.nodeModels3D).toBe(true);
    expect(settings.layers.routeArcs3D).toBe(true);
    expect(settings.layers.packetComets3D).toBe(true);
    expect(settings.layers.buildingExtrusions).toBe(true);
    expect(settings.packets.speed).toBe(3);
    expect(settings.packets.brightness).toBe(0.4);
    expect(settings.packets.trail).toBe(2);
    expect(settings.packets.animationStyle).toBe('pulse');
    expect(settings.packets.showLiveCometsAtAllZooms).toBe(true);
  });

  it('normalizes persisted OpenFreeMap 3D layer toggles', () => {
    const settings = normalizeMapSettings({
      layers: {
        nodeModels3D: false,
        routeArcs3D: false,
        packetComets3D: false,
        buildingExtrusions: false
      }
    });

    expect(settings.layers.nodeModels3D).toBe(false);
    expect(settings.layers.routeArcs3D).toBe(false);
    expect(settings.layers.packetComets3D).toBe(false);
    expect(settings.layers.buildingExtrusions).toBe(false);
    expect(settings.layers.liveComets).toBe(true);
  });

  it('falls back to safe defaults for invalid stored settings', () => {
    const settings = normalizeMapSettings({
      layers: { clusters: 'nope' },
      packets: { speed: 'slow', brightness: null, trail: undefined, animationStyle: 'wild' }
    });
    expect(settings).toEqual(DEFAULT_MAP_SETTINGS);
  });

  it('persists normalized settings in localStorage', () => {
    writeStoredMapSettings({
      ...DEFAULT_MAP_SETTINGS,
      layers: { ...DEFAULT_MAP_SETTINGS.layers, routes: false },
      packets: { ...DEFAULT_MAP_SETTINGS.packets, speed: 2 }
    });
    expect(window.localStorage.getItem(MAP_SETTINGS_STORAGE_KEY)).toContain('"routes":false');
    expect(readStoredMapSettings().layers.routes).toBe(false);
    expect(readStoredMapSettings().packets.speed).toBe(2);
  });
});
