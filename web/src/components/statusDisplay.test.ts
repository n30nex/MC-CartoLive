import { describe, expect, it } from 'vitest';
import { STALE_PACKET_MS, formatPacketsTotal, serverStatus } from './statusDisplay';
import type { LiveCoverageStats } from '../state';
import type { PublicStats } from '../types';

const stats = { packets: 86_779, activeNodes: 1, activeRoutes: 1, mqttConnected: true, mqttMessages: 1, wsClients: 1, serverTime: 1 } satisfies PublicStats;
const coverage = (lastPacketAgeMs: number | null): LiveCoverageStats => ({
  receivedPerMinute: 1,
  routeAnimatedPerMinute: 1,
  observerBurstPerMinute: 0,
  unmappedPerMinute: 0,
  lastPacketAgeMs
});

describe('status display helpers', () => {
  it('formats total packet copy', () => {
    expect(formatPacketsTotal(86_779)).toBe('86,779 packets');
    expect(formatPacketsTotal(912_001)).toBe('912k packets');
    expect(formatPacketsTotal(null)).toBe('0 packets');
  });

  it('reports Live only when packets are fresh and transports are healthy', () => {
    expect(serverStatus(stats, 'live', coverage(STALE_PACKET_MS - 1))).toEqual({ label: 'Live', live: true });
    expect(serverStatus(stats, 'polling', coverage(STALE_PACKET_MS - 1))).toEqual({ label: 'Live', live: true });
    expect(serverStatus(stats, 'live', coverage(STALE_PACKET_MS))).toEqual({ label: 'Stale', live: false });
    expect(serverStatus({ ...stats, mqttConnected: false }, 'live', coverage(1))).toEqual({ label: 'Stale', live: false });
    expect(serverStatus(stats, 'recovering', coverage(1))).toEqual({ label: 'Live', live: true });
    expect(serverStatus(stats, 'state-error', coverage(1))).toEqual({ label: 'Stale', live: false });
    expect(serverStatus(stats, 'live', coverage(null))).toEqual({ label: 'Stale', live: false });
  });
});
