import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NetGraphPanel from './NetGraphPanel';

describe('NetGraphPanel', () => {
  it('renders the closeable live graph shell without private packet language', () => {
    const html = renderToStaticMarkup(
      <NetGraphPanel nodes={[]} routes={[]} pulses={[]} activity={[]} socketStatus="live" onClose={() => undefined} />
    );
    expect(html).toContain('NetGraph');
    expect(html).toContain('Live Network Graph');
    expect(html).toContain('Search nodes, routes, region');
    expect(html).toContain('Close');
    expect(html).not.toContain('packet hash');
    expect(html).not.toContain('raw path');
    expect(html).not.toContain('resolver');
  });
});
