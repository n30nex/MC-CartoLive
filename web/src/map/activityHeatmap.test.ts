import { describe, expect, it } from 'vitest';
import type { PublicNode } from '../types';
import { activeHeatmapNodes, activityHeatIntensity, activityHeatmapToGeoJSON } from './activityHeatmap';

const node = (id: string, overrides: Partial<PublicNode> = {}): PublicNode => ({
  id,
  label: id,
  role: 'repeater',
  latitude: 45,
  longitude: -75,
  lastSeen: 1_000_000,
  firstSeen: 1,
  activityCount: 10,
  iatasHeardIn: ['YOW'],
  isObserver: false,
  ...overrides
});

describe('activity heatmap helpers', () => {
  it('weights recent mesh activity higher than stale nodes', () => {
    const fresh = activityHeatIntensity(node('fresh', { activityCount: 400 }), undefined, 1_000_000, 1_010_000, 0);
    const stale = activityHeatIntensity(node('stale', { activityCount: 400, lastSeen: 1 }), undefined, undefined, 1_010_000, 0);
    expect(fresh.intensity).toBeGreaterThan(stale.intensity);
    expect(fresh.intensity).toBeGreaterThan(0.1);
  });

  it('adds sparkle for active packet hits', () => {
    const heat = activityHeatIntensity(node('burst'), { hits: [900, 950, 980], lastAt: 980 }, undefined, 1_010_000, 1_000);
    expect(heat.intensity).toBeGreaterThan(0.1);
    expect(heat.spark).toBeGreaterThan(0.7);
  });

  it('returns capped mappable heat features ordered by intensity', () => {
    const features = activityHeatmapToGeoJSON(
      [
        node('stale', { latitude: 0, longitude: 0, lastSeen: 1 }),
        node('hot', { latitude: 46, longitude: -76, activityCount: 900, lastSeen: 1_000_000 }),
        node('warm', { latitude: 47, longitude: -77, activityCount: 40, lastSeen: 900_000 })
      ],
      new Map([['warm', { hits: [990], lastAt: 990 }]]),
      new Map(),
      1_000_000,
      1_000,
      2
    );

    expect(features.features).toHaveLength(2);
    expect((features.features[0] as any).properties.id).toBe('hot');
    expect(features.features.every((feature) => Number((feature as any).properties.intensity) > 0)).toBe(true);
  });

  it('prefers active heatmap candidates over stale idle nodes', () => {
    const candidates = activeHeatmapNodes(
      [
        node('idle', { lastSeen: 1 }),
        node('recent', { lastSeen: 1_000_000 }),
        node('mesh', { lastSeen: 1 }),
        node('burst', { lastSeen: 1 })
      ],
      new Map([['burst', { hits: [100], lastAt: 100 }]]),
      new Map([['mesh', 999_000]]),
      1_000_000
    );

    expect(candidates.map((item) => item.id).sort()).toEqual(['burst', 'mesh', 'recent']);
  });
});
