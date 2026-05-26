import { describe, expect, it } from 'vitest';
import { DEFAULT_PACKET_FILTERS, filterPackets, packetEndpointSummary, packetNodeIDs, packetRouteIDs, packetToPulse, packetWindowForScope } from './packets';
import type { PublicPacketPath } from './types';

const packet = (overrides: Partial<PublicPacketPath> = {}): PublicPacketPath => ({
  id: 'pulse-1',
  at: 1_000,
  iata: 'YYZ',
  payloadTypeName: 'PLAIN_TEXT',
  hopCount: 2,
  segmentCount: 2,
  distanceKm: 42.5,
  routeIds: ['r-a', 'r-b'],
  endpointLabels: ['Alpha', 'Bravo', 'Charlie'],
  segments: [
    {
      routeId: 'r-a',
      from: { nodeId: 'a', label: 'Alpha', lat: 43.6, lng: -79.4, pathHash3: 'ABC123' },
      to: { nodeId: 'b', label: 'Bravo', lat: 44, lng: -79.8, pathHash3: 'DEF456' },
      distanceKm: 20
    },
    {
      routeId: 'r-b',
      from: { nodeId: 'b', label: 'Bravo', lat: 44, lng: -79.8, pathHash3: 'DEF456' },
      to: { nodeId: 'c', label: 'Charlie', lat: 44.2, lng: -80, pathHash3: 'F00D12' },
      distanceKm: 22.5
    }
  ],
  ...overrides
});

describe('packet page helpers', () => {
  it('filters true path packets by search, region, payload, hop count, and message presence', () => {
    const items = [
      packet({ messageText: 'hello mesh' }),
      packet({ id: 'pulse-2', iata: 'YOW', region: 'r2', payloadTypeName: 'TRACE', hopCount: 1, endpointLabels: ['Delta'], messageText: '' })
    ];
    expect(filterPackets(items, { ...DEFAULT_PACKET_FILTERS, query: 'hello' }).map((item) => item.id)).toEqual(['pulse-1']);
    expect(filterPackets(items, { ...DEFAULT_PACKET_FILTERS, iata: 'r2' }).map((item) => item.id)).toEqual(['pulse-2']);
    expect(filterPackets(items, { ...DEFAULT_PACKET_FILTERS, payload: 'TRACE' }).map((item) => item.id)).toEqual(['pulse-2']);
    expect(filterPackets(items, { ...DEFAULT_PACKET_FILTERS, minHops: 2 }).map((item) => item.id)).toEqual(['pulse-1']);
    expect(filterPackets(items, { ...DEFAULT_PACKET_FILTERS, messageOnly: true }).map((item) => item.id)).toEqual(['pulse-1']);
  });

  it('converts packet records into replayable public route pulses without changing the original event time', () => {
    const pulse = packetToPulse(packet({ messageSender: 'Alice', messageText: 'test' }), 5_000);
    expect(pulse).toMatchObject({
      id: 'pulse-1-replay-5000',
      heardAt: 1_000,
      receivedAt: 5_000,
      displayAt: 5_000,
      payloadTypeName: 'PLAIN_TEXT',
      messageSender: 'Alice',
      messageText: 'test'
    });
    expect(pulse.segments).toHaveLength(2);
  });

  it('extracts route and node highlights for map focus', () => {
    expect([...packetRouteIDs(packet())]).toEqual(['r-a', 'r-b']);
    expect([...packetNodeIDs(packet())]).toEqual(['a', 'b', 'c']);
    expect(packetEndpointSummary(packet())).toBe('Alpha -> Charlie');
  });

  it('builds bounded fetch windows from timeline scopes', () => {
    expect(packetWindowForScope(100_000, 60_000)).toEqual({ from: 40_000, to: 100_000 });
    expect(packetWindowForScope(10_000, 60_000)).toEqual({ from: 0, to: 10_000 });
  });
});
