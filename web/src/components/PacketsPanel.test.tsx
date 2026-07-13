import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PacketsPanel, { formatPacketScanStatus, packetFooterStatus, packetSearchStatus } from './PacketsPanel';

describe('PacketsPanel', () => {
  it('renders the true-path packet shell without exposing private packet concepts', () => {
    const html = renderToStaticMarkup(
      <PacketsPanel
        mode="expanded"
        selectedPacketID={null}
        selectedPacket={null}
        presentation="side"
        onClose={() => undefined}
        onExpand={() => undefined}
        onPresentationChange={() => undefined}
        onSelectPacket={() => undefined}
        onReplayPacket={() => undefined}
      />
    );
    expect(html).not.toContain('True Path Packets');
    expect(html).toContain('Select route to view on map');
    expect(html).toContain('workspace-side');
    expect(html).toContain('Expand to full screen');
    expect(html).not.toContain('Map fits the full route');
    expect(html).toContain('Search endpoint, region, route prefix, message');
    expect(html).toContain('Loading packets');
    expect(html).toContain('loading-spinner');
    expect(html).toContain('<span class="loading-row');
    expect(html).toContain('Region');
    expect(html).toContain('Returned path');
    expect(html).toContain('Other');
    expect(html).not.toContain('hash');
    expect(html).not.toContain('raw');
    expect(html).not.toContain('resolver');
  });

  it('renders compact replay tray controls for a selected packet', () => {
    const html = renderToStaticMarkup(
      <PacketsPanel
        mode="compactTray"
        selectedPacketID="packet-1"
        selectedPacket={{
          id: 'packet-1',
          at: Date.now() - 1000,
          iata: 'YYZ',
          payloadTypeName: 'PLAIN_TEXT',
          hopCount: 2,
          segmentCount: 2,
          distanceKm: 123,
          routeIds: ['route-a'],
          endpointLabels: ['A', 'B'],
          segments: []
        }}
        onClose={() => undefined}
        onExpand={() => undefined}
        onSelectPacket={() => undefined}
        onReplayPacket={() => undefined}
      />
    );
    expect(html).toContain('Packet path');
    expect(html).toContain('Animate again');
    expect(html).not.toContain('Resume live');
  });

  it('renders sanitized live activity immediately before history reconciliation', () => {
    const html = renderToStaticMarkup(
      <PacketsPanel
        mode="expanded"
        selectedPacketID={null}
        selectedPacket={null}
        livePackets={[{
          id: 'live-1',
          at: Date.now(),
          region: 'Ontario',
          payloadTypeName: 'ADVERT',
          hopCount: 0,
          segmentCount: 0,
          distanceKm: 0,
          routeIds: [],
          endpointLabels: [],
          segments: []
        }]}
        onClose={() => undefined}
        onExpand={() => undefined}
        onSelectPacket={() => undefined}
        onReplayPacket={() => undefined}
      />
    );
    expect(html).toContain('Ontario');
    expect(html).toContain('This packet has no public map geometry');
    expect(html).not.toContain('packetHash');
  });

  it('explains bounded packet scans without private wording', () => {
    expect(formatPacketScanStatus({ eventsScanned: 2500, scanLimit: 2500, filtered: true, partial: true })).toBe(
      'Searched 2.5k routes'
    );
    expect(packetFooterStatus(null, 'more', 'cursor', false, { eventsScanned: 5000, scanLimit: 5000, filtered: true, partial: true })).toBe(
      'More packet paths available.'
    );
    expect(packetSearchStatus('more', 'cursor', false, { eventsScanned: 5000, scanLimit: 5000, filtered: true, partial: true })).toContain(
      'Load older for more'
    );
  });
});
