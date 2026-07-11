import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CommandPalette, { commandPaletteRegions } from './CommandPalette';

describe('CommandPalette', () => {
  it('renders shared dashboard actions in an accessible command dialog', () => {
    const html = renderToStaticMarkup(
      <CommandPalette
        actions={[{ id: 'packets', label: 'Packet history', description: 'Inspect routed packets', group: 'Explore', run: vi.fn() }]}
        nodes={[]}
        routes={[]}
        clusters={[]}
        onSelectNode={vi.fn()}
        onSelectRoute={vi.fn()}
        onSelectRegion={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain('Search commands, regions, nodes, and routes');
    expect(html).toContain('Packet history');
    expect(html).toContain('aria-modal="true"');
  });

  it('groups sanitized public clusters into searchable region focus targets', () => {
    const regions = commandPaletteRegions([
      { id: 'a', region: 'Atlantic', latitude: 45, longitude: -63, count: 3 },
      { id: 'b', region: 'atlantic', latitude: 47, longitude: -61, count: 1 },
      { id: 'private-shape', latitude: 50, longitude: -100, count: 9 }
    ]);

    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ id: 'atlantic', label: 'Atlantic', nodeCount: 4 });
    expect(regions[0]?.latitude).toBeCloseTo(45.5);
    expect(regions[0]?.longitude).toBeCloseTo(-62.5);
  });
});
