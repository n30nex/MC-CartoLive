import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NetGraphPanel, { netGraphSettlePlan, netGraphThemeFromStyle, packedComponentCells } from './NetGraphPanel';

describe('NetGraphPanel', () => {
  it('renders the closeable live graph shell without private packet language', () => {
    const html = renderToStaticMarkup(
      <NetGraphPanel nodes={[]} routes={[]} pulses={[]} activity={[]} socketStatus="live" onClose={() => undefined} />
    );
    expect(html).toContain('NetGraph');
    expect(html).toContain('Live Network Graph');
    expect(html).toContain('Search nodes, routes, region');
    expect(html).toContain('Devices');
    expect(html).toContain('Packets');
    expect(html).toContain('Repeater');
    expect(html).toContain('Observer');
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

  it('uses active palette tokens for canvas colors in dark and light modes', () => {
    const style = {
      getPropertyValue: (name: string) => ({
        '--palette-bg-base': '#05070b',
        '--palette-bg-surface': '#101827',
        '--palette-bg-raised': '#172033',
        '--palette-primary': '#14b8a6',
        '--palette-secondary': '#f97316',
        '--palette-readable-text': '#e2f0f0',
        '--palette-warn': '#f59e0b'
      })[name] ?? ''
    } as Pick<CSSStyleDeclaration, 'getPropertyValue'>;

    expect(netGraphThemeFromStyle(style, 'dark')).toMatchObject({
      selectedEdge: '#14b8a6',
      edgeFallback: '#f97316',
      labelText: '#e2f0f0',
      observerStroke: '#f59e0b'
    });
    expect(netGraphThemeFromStyle(style, 'light')).toMatchObject({
      selectedEdge: '#14b8a6',
      edgeFallback: '#f97316',
      labelText: '#0f172a',
      observerStroke: '#f59e0b'
    });
  });
});
