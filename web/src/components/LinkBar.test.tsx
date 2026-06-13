import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LinkBar, { LATEST_RELEASE_HIGHLIGHTS } from './LinkBar';

describe('LinkBar', () => {
  it('renders NetGraph beside the existing top-bar pages and marks it active', () => {
    const html = renderToStaticMarkup(<LinkBar netGraphOpen />);
    expect(html).toContain('#/packets');
    expect(html).toContain('#/netgraph');
    expect(html).toContain('#/chat');
    expect(html).toContain('NetGraph');
    expect(html).toContain('Chat');
    expect(html).not.toContain('Open first-run setup');
    expect(html).not.toContain('#/setup');
    expect(html).not.toContain('#/perf');
    expect(html).not.toContain('Perf');
    expect(html).not.toContain('Features');
    expect(html).not.toContain('Guide');
    expect(html).toContain('class="link-bar-page active" href="#/netgraph"');
    expect(html).toContain('Open MC-CartoLive');
    expect(html).toContain('Changelog');
  });

  it('keeps the compact changelog focused on the current release train', () => {
    expect(LATEST_RELEASE_HIGHLIGHTS.map((item) => item.label)).toEqual(['2.9.2', '2.9.1', '2.9.0']);
    expect(LATEST_RELEASE_HIGHLIGHTS.map((item) => item.title)).toContain('Durable public live');
    expect(LATEST_RELEASE_HIGHLIGHTS.map((item) => item.title)).toContain('Live map performance');
    expect(LATEST_RELEASE_HIGHLIGHTS.map((item) => item.title)).toContain('Visitor UX rollup');
    expect(LATEST_RELEASE_HIGHLIGHTS.map((item) => item.body).join(' ')).not.toContain('Perf/Guide/Features');
  });
});
