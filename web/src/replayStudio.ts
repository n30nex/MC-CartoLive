import type { PublicPacketPath, PublicRoute, PublicRoutePulse, PublicRouteSegment } from './types';

export interface ReplayTimelineSegment {
  segment: PublicRouteSegment;
  start: number;
  end: number;
}

export function routeToReplayPacket(route: PublicRoute): PublicPacketPath {
  return {
    id: `route-${route.id}`,
    at: route.lastHeard,
    payloadTypeName: route.payloadTypeNames[0] ?? 'RF route',
    hopCount: 1,
    segmentCount: 1,
    distanceKm: route.distanceKm,
    routeIds: [route.id],
    endpointLabels: [route.from.label, route.to.label],
    segments: [{ routeId: route.id, from: route.from, to: route.to, distanceKm: route.distanceKm }]
  };
}

export function pulseToReplayPacket(pulse: PublicRoutePulse): PublicPacketPath {
  const routeIds = [...new Set(pulse.segments.map((segment) => segment.routeId).filter(Boolean))];
  const endpointLabels = pulse.segments.length > 0
    ? [pulse.segments[0].from.label, ...pulse.segments.map((segment) => segment.to.label)]
    : [];
  return {
    id: pulse.id,
    at: pulse.heardAt,
    iata: pulse.iata,
    region: pulse.region,
    payloadTypeName: pulse.payloadTypeName,
    messageSender: pulse.messageSender,
    messageText: pulse.messageText,
    hopCount: pulse.segments.length + 1,
    segmentCount: pulse.segments.length,
    distanceKm: pulse.segments.reduce((sum, segment) => sum + Math.max(0, segment.distanceKm), 0),
    routeIds,
    endpointLabels,
    segments: pulse.segments
  };
}

export type ReplayDeepLinkResolution =
  | { status: 'resolved'; packet: PublicPacketPath; route: null }
  | { status: 'resolved'; packet: null; route: PublicRoute }
  | { status: 'fallback'; packet: null; route: PublicRoute }
  | { status: 'unavailable'; packet: null; route: null };

export function resolveReplayDeepLink(input: { replayPacket?: string; replayRoute?: string; route?: string }, pulses: PublicRoutePulse[], routes: PublicRoute[]): ReplayDeepLinkResolution {
  const packetID = safeReplayIdentifier(input.replayPacket);
  const routeID = safeReplayIdentifier(input.replayRoute ?? input.route);
  if (packetID) {
    const pulse = pulses.find((candidate) => candidate.id === packetID && candidate.segments.length > 0);
    if (pulse) return { status: 'resolved', packet: pulseToReplayPacket(pulse), route: null };
  }
  if (routeID) {
    const route = routes.find((candidate) => candidate.id === routeID);
    if (route) return { status: packetID ? 'fallback' : 'resolved', packet: null, route };
  }
  return { status: 'unavailable', packet: null, route: null };
}

export function replayTimeline(packet: PublicPacketPath): ReplayTimelineSegment[] {
  const weights = packet.segments.map((segment) => Math.max(0.1, segment.distanceKm || 0.1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return packet.segments.map((segment, index) => {
    const start = cursor / total;
    cursor += weights[index];
    return { segment, start, end: cursor / total };
  });
}

export function replaySegmentAt(packet: PublicPacketPath, progress: number): ReplayTimelineSegment | null {
  const safeProgress = Math.max(0, Math.min(1, progress));
  const timeline = replayTimeline(packet);
  return timeline.find((entry) => safeProgress <= entry.end) ?? timeline.at(-1) ?? null;
}

export function safeReplayIdentifier(value: string | null | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && /^[a-zA-Z0-9._:-]{1,96}$/.test(candidate) ? candidate : undefined;
}

export function addReplayStudioParams(urlValue: string, packet: PublicPacketPath): string {
  const url = new URL(urlValue);
  url.searchParams.set('studio', '1');
  const packetID = safeReplayIdentifier(packet.id);
  const routeID = safeReplayIdentifier(packet.routeIds[0]);
  if (packetID) url.searchParams.set('replayPacket', packetID);
  else url.searchParams.delete('replayPacket');
  if (routeID) url.searchParams.set('replayRoute', routeID);
  else url.searchParams.delete('replayRoute');
  return url.toString();
}
