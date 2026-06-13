import { describe, expect, it } from 'vitest';
import { MAP_STYLE_PROFILES, mapStyleProfileByID, publicStyleProfileIDs } from './styleRegistry';

describe('styleRegistry', () => {
  it('contains the 2.9.5 public style profiles', () => {
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
});
