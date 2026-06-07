import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RouteGifExportButton from './RouteGifExportButton';
import type { PublicPacketPath } from '../types';

const packet: PublicPacketPath = {
  id: 'packet-1',
  at: Date.now(),
  region: 'YYZ',
  payloadTypeName: 'ADVERT',
  hopCount: 1,
  segmentCount: 1,
  distanceKm: 12,
  routeIds: ['route-1'],
  endpointLabels: ['Sender', 'Destination'],
  segments: []
};

describe('RouteGifExportButton', () => {
  it('renders a glowing export action for selected packet routes', () => {
    const html = renderToStaticMarkup(<RouteGifExportButton packet={packet} status="idle" progress={0} cooldownUntil={0} remainingExports={5} onExport={() => undefined} />);
    expect(html).toContain('Export as GIF');
    expect(html).toContain('Sender -&gt; Destination');
  });

  it('shows rendering progress while disabled', () => {
    const html = renderToStaticMarkup(<RouteGifExportButton packet={packet} status="rendering" progress={0.42} cooldownUntil={0} remainingExports={5} onExport={() => undefined} />);
    expect(html).toContain('Rendering 42%');
    expect(html).toContain('disabled=""');
  });
});
