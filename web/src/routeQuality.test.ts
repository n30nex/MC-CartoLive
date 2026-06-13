import { describe, expect, it } from 'vitest';
import { publicRouteQuality, routePathPrefixBucket } from './routeQuality';
import type { PublicRoute } from './types';

const route: PublicRoute = {
  id: 'r-a',
  from: { nodeId: 'a', label: 'A', lat: 43, lng: -80, pathHash3: 'AABBCC' },
  to: { nodeId: 'b', label: 'B', lat: 44, lng: -79, pathHash3: 'DDEEFF' },
  distanceKm: 120,
  packetCount: 12,
  lastHeard: 1_000,
  frequencyBucket: 2,
  payloadTypeNames: ['ADVERT']
};

describe('routeQuality', () => {
  it('summarizes public-safe quality buckets', () => {
    expect(publicRouteQuality(route, 1_000 + 60_000)).toEqual({
      confidence: 'high',
      ageBucket: 'fresh',
      distanceBucket: 'regional',
      trafficBucket: 'active'
    });
  });

  it('classifies public path-prefix availability', () => {
    expect(routePathPrefixBucket(route)).toBe('3-byte');
    expect(routePathPrefixBucket({ ...route, to: { ...route.to, pathHash3: undefined } })).toBe('partial');
    expect(routePathPrefixBucket({ ...route, from: { ...route.from, pathHash3: undefined }, to: { ...route.to, pathHash3: undefined } })).toBe('unknown');
  });
});
