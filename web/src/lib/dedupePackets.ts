import type { PublicPacketPath } from '../types';

export function dedupePackets(packets: PublicPacketPath[]): PublicPacketPath[] {
  const seen = new Set<string>();
  const liveSignatures = new Set<string>();
  const output: PublicPacketPath[] = [];
  for (const packet of packets) {
    const routeIds = Array.isArray(packet?.routeIds) ? packet.routeIds.filter((value): value is string => typeof value === 'string') : [];
    const endpointLabels = Array.isArray(packet?.endpointLabels) ? packet.endpointLabels.filter((value): value is string => typeof value === 'string') : [];
    const segmentCount = Number.isFinite(packet?.segmentCount) ? packet.segmentCount : 0;
    const signature = `${packet?.at ?? 0}:${packet?.payloadTypeName ?? ''}:${routeIds.join('|')}:${endpointLabels.join('|')}:${segmentCount}`;
    const liveIdentity = typeof packet?.id === 'string' && packet.id.startsWith('live-') ? packet.id : '';
    if (!liveIdentity && liveSignatures.has(signature)) continue;
    const key = liveIdentity ? `live:${liveIdentity}` : `history:${signature}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (liveIdentity) liveSignatures.add(signature);
    output.push({
      ...packet,
      segmentCount,
      routeIds,
      endpointLabels
    });
  }
  return output;
}
