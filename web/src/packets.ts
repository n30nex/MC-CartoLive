import type { PublicActivity, PublicPacketPath, PublicRoutePulse } from './types';

export const PACKETS_SCOPE_OPTIONS = [
  { label: '1h', value: 60 * 60_000 },
  { label: '6h', value: 6 * 60 * 60_000 },
  { label: '24h', value: 24 * 60 * 60_000 }
] as const;

export interface PacketFilters {
  query: string;
  iata: string;
  payload: string;
  minHops: number;
  messageOnly: boolean;
}

export const DEFAULT_PACKET_FILTERS: PacketFilters = {
  query: '',
  iata: '',
  payload: '',
  minHops: 0,
  messageOnly: false
};

export function packetSearchFields(packet: PublicPacketPath): string[] {
  const endpointLabels = Array.isArray(packet.endpointLabels) ? packet.endpointLabels : [];
  const routeIds = Array.isArray(packet.routeIds) ? packet.routeIds : [];
  const segments = Array.isArray(packet.segments) ? packet.segments : [];

  return [
    packet.id ?? '',
    packet.region ?? '',
    packet.iata ?? '',
    packet.payloadTypeName ?? '',
    packet.messageSender ?? '',
    packet.messageText ?? '',
    ...endpointLabels,
    ...routeIds,
    ...segments.flatMap((segment) => {
      const from = segment?.from;
      const to = segment?.to;
      return [from?.label ?? '', to?.label ?? '', from?.pathHash3 ?? '', to?.pathHash3 ?? ''];
    })
  ].filter(Boolean);
}

export function packetMatchesFilters(packet: PublicPacketPath, filters: PacketFilters): boolean {
  const query = filters.query.trim().toLowerCase();
  if (filters.iata && packetRegion(packet).toUpperCase() !== filters.iata.toUpperCase()) return false;
  if (filters.payload && packet.payloadTypeName.toUpperCase() !== filters.payload.toUpperCase()) return false;
  if (filters.minHops > 0 && packet.hopCount < filters.minHops) return false;
  if (filters.messageOnly && !packet.messageText?.trim()) return false;
  if (!query) return true;
  return packetSearchFields(packet).some((field) => field.toLowerCase().includes(query));
}

export function filterPackets(packets: PublicPacketPath[], filters: PacketFilters): PublicPacketPath[] {
  return packets.filter((packet) => packetMatchesFilters(packet, filters));
}

export function packetToPulse(packet: PublicPacketPath, now = Date.now(), replayOptions?: PublicRoutePulse['replayOptions']): PublicRoutePulse {
  return {
    id: `${packet.id}-replay-${now}`,
    iata: packet.iata,
    region: packet.region ?? packet.iata,
    payloadTypeName: packet.payloadTypeName,
    messageSender: packet.messageSender,
    messageText: packet.messageText,
    heardAt: packet.at,
    receivedAt: now,
    displayAt: now,
    segments: packet.segments,
    replayOptions
  };
}

export function livePacketsFromActivity(activity: PublicActivity[], pulses: PublicRoutePulse[]): PublicPacketPath[] {
  const output: PublicPacketPath[] = [];
  const pulseKeys = new Set<string>();
  for (const pulse of pulses) {
    if (pulse.segments.length === 0) continue;
    const routeIds = pulse.segments.map((segment) => segment.routeId);
    const endpointLabels = pulse.segments.length > 0
      ? [pulse.segments[0]?.from.label ?? '', ...pulse.segments.map((segment) => segment.to.label)].filter(Boolean)
      : [];
    pulseKeys.add(livePacketKey(pulse.heardAt, pulse.payloadTypeName, routeIds));
    output.push({
      id: `live-pulse:${pulse.seq ?? pulse.id}`,
      at: pulse.heardAt,
      iata: pulse.iata,
      region: pulse.region,
      payloadTypeName: pulse.payloadTypeName,
      messageSender: pulse.messageSender,
      messageText: pulse.messageText,
      hopCount: pulse.segments.length,
      segmentCount: pulse.segments.length,
      distanceKm: pulse.segments.reduce((total, segment) => total + Math.max(0, segment.distanceKm), 0),
      routeIds,
      endpointLabels,
      segments: pulse.segments
    });
  }
  for (const item of activity) {
    if (item.kind !== 'packet' && item.kind !== 'route') continue;
    const routeIds = item.routeIds ?? [];
    if (pulseKeys.has(livePacketKey(item.heardAt, item.payloadTypeName, routeIds))) continue;
    output.push({
      id: `live-activity:${item.seq ?? item.id}`,
      at: item.heardAt,
      iata: item.iata,
      region: item.region,
      payloadTypeName: item.payloadTypeName,
      messageSender: item.messageSender,
      messageText: item.messageText,
      hopCount: Math.max(0, item.hopCount),
      segmentCount: 0,
      distanceKm: 0,
      routeIds,
      endpointLabels: item.endpointLabels ?? [],
      segments: []
    });
  }
  return output.sort((left, right) => right.at - left.at);
}

function livePacketKey(at: number, payloadTypeName: string, routeIds: readonly string[]): string {
  return `${at}:${payloadTypeName}:${routeIds.join('|')}`;
}

export function packetRegion(packet: Pick<PublicPacketPath, 'region' | 'iata'>): string {
  return packet.region ?? packet.iata ?? '';
}

export function packetRouteIDs(packet: PublicPacketPath | null): Set<string> {
  return new Set(packet?.routeIds ?? []);
}

export function packetNodeIDs(packet: PublicPacketPath | null): Set<string> {
  const ids = new Set<string>();
  for (const segment of packet?.segments ?? []) {
    if (!segment?.from?.nodeId && !segment?.to?.nodeId) continue;
    if (segment?.from?.nodeId) ids.add(segment.from.nodeId);
    if (segment?.to?.nodeId) ids.add(segment.to.nodeId);
  }
  return ids;
}

export function packetEndpointSummary(packet: PublicPacketPath): string {
  const labels = Array.isArray(packet.endpointLabels) ? packet.endpointLabels : [];
  if (labels.length === 0) return 'Unknown path';
  if (labels.length === 1) return labels[0] ?? 'Unknown path';
  const first = labels[0] ?? 'Unknown';
  const last = labels[labels.length - 1] ?? 'Unknown';
  return `${first} -> ${last}`;
}

export function packetWindowForScope(now: number, scopeMs: number): { from: number; to: number } {
  const to = Math.max(0, Math.round(now));
  return { from: Math.max(0, to - scopeMs), to };
}
