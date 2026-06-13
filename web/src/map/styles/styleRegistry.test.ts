import { describe, expect, it } from 'vitest';
import { MAP_STYLE_PROFILES, mapStyleProfileByID, publicStyleProfileIDs } from './styleRegistry';

describe('styleRegistry', () => {
  it('contains the 2.9.2 public style profiles', () => {
    expect(publicStyleProfileIDs()).toEqual([
      'classic-dark',
      'classic-light',
      'openfreemap-dark',
      'openfreemap-light',
      'topo-rf',
      'noc',
      'offline-pmtiles',
      'low-bandwidth'
    ]);
    expect(new Set(MAP_STYLE_PROFILES.map((profile) => profile.id)).size).toBe(MAP_STYLE_PROFILES.length);
  });

  it('falls back to classic dark for unknown styles', () => {
    expect(mapStyleProfileByID('missing').id).toBe('classic-dark');
  });
});
