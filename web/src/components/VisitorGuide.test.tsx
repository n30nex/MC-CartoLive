import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ShortcutHelp from './ShortcutHelp';
import VisitorGuide from './VisitorGuide';

describe('visitor orientation', () => {
  it('renders the first-visit map guide with layer, pathway, and help actions', () => {
    const html = renderToStaticMarkup(
      <VisitorGuide
        knownPathwaysOn={false}
        defaultOpen
        onOpenSettings={() => undefined}
        onOpenHelp={() => undefined}
        onToggleKnownPathways={() => undefined}
      />
    );

    expect(html).toContain('2.9.1 Live');
    expect(html).toContain('Watch live traffic first');
    expect(html).toContain('Layer presets');
    expect(html).toContain('Paths off');
    expect(html).toContain('Help');
  });

  it('renders orientation sections inside shortcut help', () => {
    const html = renderToStaticMarkup(<ShortcutHelp onClose={() => undefined} />);

    expect(html).toContain('Map Help');
    expect(html).toContain('Live Map');
    expect(html).toContain('Map Controls');
    expect(html).toContain('Keyboard Shortcuts');
  });
});
