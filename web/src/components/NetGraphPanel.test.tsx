import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NetGraphPanel, { netGraphSettlePlan, packedComponentCells } from './NetGraphPanel';

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

  it('packs graph components near the viewport center instead of pushing them to far edges', () => {
    const cells = packedComponentCells(9, 1200, 800);
    expect(cells).toHaveLength(9);
    const center = { x: 600, y: 400 };
    const farthest = Math.max(...cells.map((cell) => Math.hypot(cell.x - center.x, cell.y - center.y)));
    expect(farthest).toBeLessThan(430);
    expect(Math.hypot(cells[0].x - center.x, cells[0].y - center.y)).toBeLessThan(150);
  });

  it('does not pre-tick or restart the force layout when graph layout is paused', () => {
    expect(netGraphSettlePlan(120, 121, 1, true)).toEqual({ ticks: 0, alpha: 0, restart: false });
  });

  it('uses gentle incremental settling for small live topology changes', () => {
    const initial = netGraphSettlePlan(0, 120, 120, false);
    const incremental = netGraphSettlePlan(120, 121, 1, false);
    const major = netGraphSettlePlan(120, 160, 40, false);

    expect(initial.ticks).toBeGreaterThan(major.ticks);
    expect(major.ticks).toBeGreaterThan(incremental.ticks);
    expect(incremental.alpha).toBeLessThan(major.alpha);
    expect(incremental.restart).toBe(true);
  });
});
