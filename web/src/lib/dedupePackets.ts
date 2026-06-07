import type { PublicPacketPath } from '../types';

export function dedupePackets(packets: PublicPacketPath[]): PublicPacketPath[] {
  const seen = new Set<string>();
  const output: PublicPacketPath[] = [];
  for (const packet of packets) {
    const key = `${packet.at}:${packet.routeIds.join('|')}:${packet.endpointLabels.join('|')}:${packet.segmentCount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(packet);
  }
  return output;
}
