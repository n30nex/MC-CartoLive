import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LinkBar from './LinkBar';

describe('LinkBar', () => {
  it('renders NetGraph beside the existing top-bar pages and marks it active', () => {
    const html = renderToStaticMarkup(<LinkBar netGraphOpen />);
    expect(html).toContain('#/perf');
    expect(html).toContain('#/packets');
    expect(html).toContain('#/netgraph');
    expect(html).toContain('#/chat');
    expect(html).toContain('NetGraph');
    expect(html).toContain('Chat');
    expect(html).not.toContain('Open first-run setup');
    expect(html).not.toContain('#/setup');
    expect(html).toContain('link-bar-perf active');
    expect(html).toContain('Open MC-CartoLive');
    expect(html).toContain('Changelog');
    expect(html).toContain('Features');
    expect(html).toContain('Guide');
  });
});
