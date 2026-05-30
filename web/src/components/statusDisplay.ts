import type { LiveCoverageStats } from '../state';
import type { PublicStats } from '../types';

export const STALE_PACKET_MS = 60_000;

export function serverStatus(stats: PublicStats | null, socketStatus: string, coverage: LiveCoverageStats): { label: 'Live' | 'Stale'; live: boolean } {
  const transportFailed = socketStatus === 'closed' || socketStatus === 'state-error' || socketStatus === 'bad-message';
  const live = Boolean(stats?.mqttConnected) && !transportFailed && coverage.lastPacketAgeMs !== null && coverage.lastPacketAgeMs < STALE_PACKET_MS;
  return { label: live ? 'Live' : 'Stale', live };
}

export function formatPacketsTotal(count: number | undefined | null): string {
  const total = Math.max(0, Math.floor(count ?? 0));
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(total >= 10_000_000 ? 0 : 1)}M packets`;
  if (total >= 100_000) return `${Math.round(total / 1000).toLocaleString()}k packets`;
  return `${total.toLocaleString()} packets`;
}
