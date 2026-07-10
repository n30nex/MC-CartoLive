import type { PublicPacketPath, PublicRoute, PublicRouteSegment } from './types';

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
