import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CommandPalette from './CommandPalette';

describe('CommandPalette', () => {
  it('renders shared dashboard actions in an accessible command dialog', () => {
    const html = renderToStaticMarkup(
      <CommandPalette
        actions={[{ id: 'studio', label: 'RF Replay Studio', description: 'Play route', group: 'Playback', run: vi.fn() }]}
        nodes={[]}
        routes={[]}
        onSelectNode={vi.fn()}
        onSelectRoute={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain('Search commands, nodes, and routes');
    expect(html).toContain('RF Replay Studio');
    expect(html).toContain('aria-modal="true"');
  });
});
