import type { PublicPacketPath } from '../types';

export function dedupePackets(packets: PublicPacketPath[]): PublicPacketPath[] {
  const seen = new Set<string>();
  const output: PublicPacketPath[] = [];
  for (const packet of packets) {
    const routeIds = Array.isArray(packet?.routeIds) ? packet.routeIds.filter((value): value is string => typeof value === 'string') : [];
    const endpointLabels = Array.isArray(packet?.endpointLabels) ? packet.endpointLabels.filter((value): value is string => typeof value === 'string') : [];
    const segmentCount = Number.isFinite(packet?.segmentCount) ? packet.segmentCount : 0;
    const key = `${packet?.at ?? 0}:${routeIds.join('|')}:${endpointLabels.join('|')}:${segmentCount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      ...packet,
      segmentCount,
      routeIds,
      endpointLabels
    });
  }
  return output;
}
