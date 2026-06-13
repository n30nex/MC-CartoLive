import type { PublicRoute } from './types';

export interface PublicRouteQuality {
  confidence: 'high';
  ageBucket: 'fresh' | 'recent' | 'stale';
  distanceBucket: 'local' | 'regional' | 'long';
  trafficBucket: 'quiet' | 'active' | 'busy';
}

export function publicRouteQuality(route: PublicRoute, now = Date.now()): PublicRouteQuality {
  const ageMs = Math.max(0, now - route.lastHeard);
  return {
    confidence: 'high',
    ageBucket: ageMs <= 10 * 60_000 ? 'fresh' : ageMs <= 2 * 60 * 60_000 ? 'recent' : 'stale',
    distanceBucket: route.distanceKm < 50 ? 'local' : route.distanceKm < 250 ? 'regional' : 'long',
    trafficBucket: route.packetCount >= 50 ? 'busy' : route.packetCount >= 10 ? 'active' : 'quiet'
  };
}

export function routePathPrefixBucket(route: PublicRoute): '3-byte' | 'partial' | 'unknown' {
  const values = [route.from.pathHash3, route.to.pathHash3].filter(Boolean);
  if (values.length === 2 && values.every((value) => /^[A-F0-9]{6}$/.test(value ?? ''))) return '3-byte';
  if (values.length > 0) return 'partial';
  return 'unknown';
}
