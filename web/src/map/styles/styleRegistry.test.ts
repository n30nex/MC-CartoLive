import { describe, expect, it } from 'vitest';
import { MAP_STYLE_PROFILES, mapStyleProfileByID, publicStyleProfileIDs } from './styleRegistry';

describe('styleRegistry', () => {
  it('contains the 2.9.6 public style profiles', () => {
    expect(publicStyleProfileIDs()).toEqual([
      'classic-dark',
      'classic-light',
      'openfreemap-dark',
      'openfreemap-light',
      'openfreemap-positron',
      'openfreemap-liberty',
      'openfreemap-fiord',
      'openfreemap-3d',
      'topo-rf',
      'noc',
      'offline-pmtiles',
      'field-offline',
      'accessibility',
      'low-bandwidth'
    ]);
    expect(new Set(MAP_STYLE_PROFILES.map((profile) => profile.id)).size).toBe(MAP_STYLE_PROFILES.length);
  });

  it('falls back to classic dark for unknown styles', () => {
    expect(mapStyleProfileByID('missing').id).toBe('classic-dark');
  });

  it('keeps flat styles clean by default while preserving deliberate topo and 3D terrain modes', () => {
    for (const id of ['classic-dark', 'classic-light', 'openfreemap-dark', 'openfreemap-light', 'openfreemap-positron', 'openfreemap-liberty', 'openfreemap-fiord', 'noc', 'accessibility']) {
      const profile = mapStyleProfileByID(id);
      expect(profile.supportsTerrain).toBe(true);
      expect(profile.terrainDefault).toBe(false);
      expect(profile.terrainPresentation).toBe('hillshade');
    }
    expect(mapStyleProfileByID('openfreemap-3d').terrainDefault).toBe(true);
    expect(mapStyleProfileByID('openfreemap-3d').terrainPresentation).toBe('hillshade');
    expect(mapStyleProfileByID('topo-rf').terrainDefault).toBe(true);
    expect(mapStyleProfileByID('topo-rf').terrainPresentation).toBe('topographic');
    expect(mapStyleProfileByID('low-bandwidth').terrainDefault).toBe(false);
    expect(mapStyleProfileByID('low-bandwidth').terrainPresentation).toBe('flat');
    expect(mapStyleProfileByID('offline-pmtiles').terrainDefault).toBe(false);
    expect(mapStyleProfileByID('field-offline').terrainDefault).toBe(false);
  });
});
