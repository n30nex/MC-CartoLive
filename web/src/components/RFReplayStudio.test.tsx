import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RFReplayStudio from './RFReplayStudio';
import { routeToReplayPacket } from '../replayStudio';
import type { PublicRoute } from '../types';

const route: PublicRoute = {
  id: 'route-1',
  from: { nodeId: 'a', label: 'Alpha', lat: 43, lng: -79, pathHash3: 'abc123' },
  to: { nodeId: 'b', label: 'Bravo', lat: 45, lng: -76, pathHash3: 'def456' },
  distanceKm: 310,
  packetCount: 22,
  lastHeard: 1_700_000_000,
  frequencyBucket: 2,
  payloadTypeNames: ['PLAIN_TEXT']
};

describe('RFReplayStudio', () => {
  it('renders a privacy-safe lazy route story with camera, timeline, share, and export controls', () => {
    const html = renderToStaticMarkup(
      <RFReplayStudio
        packet={routeToReplayPacket(route)}
        mode="studio"
        onModeChange={vi.fn()}
        onReplay={vi.fn()}
        onPause={vi.fn()}
        onSeek={vi.fn()}
        onShare={vi.fn()}
        onExportGif={vi.fn()}
        webmSupported
        onExportWebM={vi.fn()}
        onOpenWaterfall={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain('RF Replay Studio');
    expect(html).toContain('Alpha');
    expect(html).toContain('Bravo');
    expect(html).toContain('3D flight');
    expect(html).toContain('Copy story link');
    expect(html).toContain('Export GIF');
    expect(html).toContain('Export WebM');
    expect(html).toContain('LOS / elevation');
    expect(html).toContain('aria-modal="true"');
    expect(html).not.toContain('abc123');
    expect(html).not.toContain('def456');
  });
});
