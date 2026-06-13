import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMapLayerPreset,
  applyMapStyleProfile,
  DEFAULT_MAP_SETTINGS,
  DEFAULT_MAP_STYLE_SETTINGS,
  MAP_LAYER_PRESETS,
  MAP_SETTINGS_SCHEMA_VERSION,
  MAP_SETTINGS_STORAGE_KEY,
  mapLayerPresetIDForSettings,
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
      packets: { speed: 99, brightness: 0.1, trail: 8, animationStyle: 'pulse', showLiveCometsAtAllZooms: true, renderQuality: 'smooth' }
    });
    expect(settings.style).toEqual(DEFAULT_MAP_STYLE_SETTINGS);
    expect(settings.layers.clusters).toBe(false);
    expect(settings.layers.activityHeatmap).toBe(true);
    expect(settings.layers.nodes).toBe(false);
    expect(settings.layers.routes).toBe(false);
    expect(settings.layers.liveComets).toBe(false);
    expect(settings.layers.nodeModels3D).toBe(true);
    expect(settings.layers.routeArcs3D).toBe(true);
    expect(settings.layers.packetComets3D).toBe(true);
    expect(settings.layers.buildingExtrusions).toBe(true);
    expect(settings.layers.terrainHeightmap).toBe(true);
    expect(settings.layers.weatherClouds).toBe(false);
    expect(settings.layers.propagationInsights).toBe(false);
    expect(settings.packets.speed).toBe(3);
    expect(settings.packets.brightness).toBe(0.4);
    expect(settings.packets.trail).toBe(2);
    expect(settings.packets.animationStyle).toBe('pulse');
    expect(settings.packets.showLiveCometsAtAllZooms).toBe(true);
    expect(settings.packets.renderQuality).toBe('smooth');
  });

  it('normalizes style profile and 3D tuning controls', () => {
    const settings = normalizeMapSettings({
      style: {
        profileID: 'openfreemap-3d',
        basemapDim: 2,
        labelDensity: -1,
        terrainClarity: 200,
        buildingOpacity: -4,
        nodeModelStyle: 'signal-beacons',
        nodeModelScale: '1.35',
        nodeAltitudeMeters: 200,
        routeArcAltitudeScale: 0.1
      }
    });

    expect(settings.style.profileID).toBe('openfreemap-3d');
    expect(settings.style.basemapDim).toBe(0.78);
    expect(settings.style.labelDensity).toBe(0);
    expect(settings.style.terrainClarity).toBe(100);
    expect(settings.style.buildingOpacity).toBe(0);
    expect(settings.style.nodeModelStyle).toBe('signal-beacons');
    expect(settings.style.nodeModelScale).toBe(1.35);
    expect(settings.style.nodeAltitudeMeters).toBe(120);
    expect(settings.style.routeArcAltitudeScale).toBe(0.35);
  });

  it('migrates legacy terrain lift into terrain clarity', () => {
    const settings = normalizeMapSettings({
      style: { terrainExaggeration: 1.25 }
    });

    expect(settings.style.terrainClarity).toBeCloseTo(DEFAULT_MAP_STYLE_SETTINGS.terrainClarity, 0);
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

  it('preserves an explicit stored Known Pathways preference', () => {
    expect(normalizeMapSettings({ layers: { routes: true } }).layers.routes).toBe(true);
    expect(normalizeMapSettings({ layers: { routes: false } }).layers.routes).toBe(false);
  });

  it('turns off legacy 2.8.1 terrain and propagation defaults once', () => {
    window.localStorage.setItem(MAP_SETTINGS_STORAGE_KEY, JSON.stringify({
      layers: {
        routes: true,
        terrainHeightmap: true,
        propagationInsights: true,
        nodeLabels: false
      },
      packets: { speed: 2 }
    }));

    const migrated = readStoredMapSettings();
    expect(migrated.layers.routes).toBe(true);
    expect(migrated.layers.nodeLabels).toBe(false);
    expect(migrated.layers.terrainHeightmap).toBe(false);
    expect(migrated.layers.propagationInsights).toBe(false);
    expect(migrated.packets.speed).toBe(2);
  });

  it('preserves 2.8.2 explicit terrain and propagation choices during the 2.9.0 schema bump', () => {
    window.localStorage.setItem(MAP_SETTINGS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 2,
      layers: {
        terrainHeightmap: true,
        propagationInsights: true
      }
    }));

    const stored = readStoredMapSettings();
    expect(stored.layers.terrainHeightmap).toBe(true);
    expect(stored.layers.propagationInsights).toBe(true);
  });

  it('applies frontend-only layer presets without changing packet preferences', () => {
    const base = normalizeMapSettings({
      layers: { routes: false, terrainHeightmap: false },
      packets: { speed: 2, animationStyle: 'pulse' }
    });

    const analysis = applyMapLayerPreset(base, 'analysis');
    expect(analysis.layers.routes).toBe(true);
    expect(analysis.layers.propagationInsights).toBe(true);
    expect(analysis.layers.terrainLOS).toBe(true);
    expect(analysis.layers.terrainHeightmap).toBe(true);
    expect(analysis.packets.speed).toBe(2);
    expect(analysis.packets.animationStyle).toBe('pulse');

    const threeD = applyMapLayerPreset(base, '3d');
    expect(threeD.layers.terrainHeightmap).toBe(true);
    expect(threeD.layers.routeArcs3D).toBe(true);
  });

  it('applies map style profiles with workflow-safe defaults', () => {
    const base = normalizeMapSettings({
      style: { profileID: 'classic-dark' },
      layers: { routes: false, terrainHeightmap: false },
      packets: { renderQuality: 'high', animationStyle: 'comet' }
    });

    const threeD = applyMapStyleProfile(base, 'openfreemap-3d');
    expect(threeD.style.profileID).toBe('openfreemap-3d');
    expect(threeD.layers.routes).toBe(true);
    expect(threeD.layers.terrainHeightmap).toBe(true);
    expect(threeD.layers.nodeModels3D).toBe(true);

    const low = applyMapStyleProfile(base, 'low-bandwidth');
    expect(low.style.profileID).toBe('low-bandwidth');
    expect(low.layers.activityHeatmap).toBe(false);
    expect(low.layers.nodeModels3D).toBe(false);
    expect(low.layers.terrainHeightmap).toBe(false);
    expect(low.packets.renderQuality).toBe('smooth');

    const classicLight = applyMapStyleProfile(base, 'classic-light');
    expect(classicLight.layers.terrainHeightmap).toBe(true);

    const noc = applyMapStyleProfile(base, 'noc');
    expect(noc.layers.terrainHeightmap).toBe(true);
  });

  it('identifies exact layer preset matches', () => {
    expect(MAP_LAYER_PRESETS.map((preset) => preset.id)).toEqual(['live', 'clean', 'analysis', '3d']);
    expect(mapLayerPresetIDForSettings(MAP_LAYER_PRESETS[0].layers)).toBe('live');
    expect(mapLayerPresetIDForSettings({ ...MAP_LAYER_PRESETS[0].layers, routes: true })).toBeNull();
  });

  it('falls back to safe defaults for invalid stored settings', () => {
    const settings = normalizeMapSettings({
      layers: { clusters: 'nope' },
      packets: { speed: 'slow', brightness: null, trail: undefined, animationStyle: 'wild', renderQuality: 'cinematic' }
    });
    expect(settings).toEqual(DEFAULT_MAP_SETTINGS);
  });

  it('persists normalized settings in localStorage', () => {
    writeStoredMapSettings({
      ...DEFAULT_MAP_SETTINGS,
      layers: { ...DEFAULT_MAP_SETTINGS.layers, routes: false },
      packets: { ...DEFAULT_MAP_SETTINGS.packets, speed: 2 }
    });
    expect(window.localStorage.getItem(MAP_SETTINGS_STORAGE_KEY)).toContain(`"schemaVersion":${MAP_SETTINGS_SCHEMA_VERSION}`);
    expect(window.localStorage.getItem(MAP_SETTINGS_STORAGE_KEY)).toContain('"routes":false');
    expect(readStoredMapSettings().layers.routes).toBe(false);
    expect(readStoredMapSettings().packets.speed).toBe(2);
  });
});
