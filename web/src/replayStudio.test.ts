import { describe, expect, it } from 'vitest';
import { addReplayStudioParams, pulseToReplayPacket, replaySegmentAt, replayTimeline, resolveReplayDeepLink, routeToReplayPacket, safeReplayIdentifier } from './replayStudio';
import type { PublicPacketPath, PublicRoute, PublicRoutePulse } from './types';

const route: PublicRoute = {
  id: 'route:abc',
  from: { nodeId: 'a', label: 'Alpha', lat: 43, lng: -79, pathHash3: 'a1b2c3' },
  to: { nodeId: 'b', label: 'Bravo', lat: 44, lng: -78, pathHash3: 'd4e5f6' },
  distanceKm: 120,
  packetCount: 4,
  lastHeard: 1000,
  frequencyBucket: 1,
  payloadTypeNames: ['PLAIN_TEXT']
};

describe('RF Replay Studio model', () => {
  it('creates a privacy-safe replay packet from a public route', () => {
    expect(routeToReplayPacket(route)).toMatchObject({
      id: 'route-route:abc',
      routeIds: ['route:abc'],
      endpointLabels: ['Alpha', 'Bravo'],
      segmentCount: 1,
      distanceKm: 120
    });
  });

  it('allocates timeline progress by public segment distance', () => {
    const packet: PublicPacketPath = {
      ...routeToReplayPacket(route),
      segments: [
        { ...routeToReplayPacket(route).segments[0], distanceKm: 25 },
        { ...routeToReplayPacket(route).segments[0], routeId: 'second', distanceKm: 75 }
      ],
      segmentCount: 2
    };
    expect(replayTimeline(packet).map((item) => [item.start, item.end])).toEqual([[0, 0.25], [0.25, 1]]);
    expect(replaySegmentAt(packet, 0.8)?.segment.routeId).toBe('second');
  });

  it('only adds sanitized public identifiers to share links', () => {
    expect(safeReplayIdentifier('route:abc-123')).toBe('route:abc-123');
    expect(safeReplayIdentifier('raw packet / secret')).toBeUndefined();
    const url = new URL(addReplayStudioParams('https://example.test/?lat=43&lng=-79&z=5', routeToReplayPacket(route)));
    expect(url.searchParams.get('studio')).toBe('1');
    expect(url.searchParams.get('replayRoute')).toBe('route:abc');
    expect(url.searchParams.get('replayPacket')).toBe('route-route:abc');
  });

  it('resolves retained packet links and falls back to their sanitized route', () => {
    const pulse: PublicRoutePulse = { id: 'packet-1', payloadTypeName: 'TRACE', heardAt: 1000, segments: routeToReplayPacket(route).segments };
    expect(pulseToReplayPacket(pulse)).toMatchObject({ id: 'packet-1', routeIds: ['route:abc'], segmentCount: 1 });
    expect(resolveReplayDeepLink({ replayPacket: 'packet-1', replayRoute: route.id }, [pulse], [route])).toMatchObject({ status: 'resolved', packet: { id: 'packet-1' } });
    expect(resolveReplayDeepLink({ replayPacket: 'expired', replayRoute: route.id }, [], [route])).toMatchObject({ status: 'fallback', route: { id: route.id } });
    expect(resolveReplayDeepLink({ replayPacket: 'expired', replayRoute: 'missing' }, [], [route])).toEqual({ status: 'unavailable', packet: null, route: null });
  });
});
