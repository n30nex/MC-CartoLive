import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ChromePanel from './ChromePanel';

describe('ChromePanel', () => {
  it('renders panel chrome without a visible snap-position select', () => {
    const html = renderToStaticMarkup(
      <ChromePanel
        panel="search"
        title="Search"
        anchor="top-left"
        hidden={false}
        onAnchorChange={() => undefined}
        onHide={() => undefined}
      >
        <div>Search body</div>
      </ChromePanel>
    );

    expect(html).toContain('Search');
    expect(html).toContain('Search body');
    expect(html).toContain('Hide Search');
    expect(html).not.toContain('snap position');
    expect(html).not.toContain('<select');
  });
});
