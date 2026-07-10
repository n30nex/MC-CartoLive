import { describe, expect, it } from 'vitest';
import {
  allChromeVisible,
  DEFAULT_CHROME_PANEL_VISIBILITY,
  INITIAL_CHROME_PANEL_VISIBILITY,
  anchorPosition,
  chromePanelSnapMenuItems,
  chromePanelVisible,
  clampPanelPosition,
  nearestPanelAnchor,
  normalizePanelAnchor,
  reduceChromeVisibility,
  type ChromeVisibilityState
} from './panelChrome';

describe('panel chrome helpers', () => {
  it('resolves every supported snap anchor', () => {
    const panel = { width: 200, height: 120 };
    const viewport = { width: 1000, height: 800, margin: 10, topInset: 20, bottomInset: 140 };

    expect({
      'top-left': anchorPosition('top-left', panel, viewport),
      'top-left-stack': anchorPosition('top-left-stack', panel, viewport),
      'top-right': anchorPosition('top-right', panel, viewport),
      'bottom-left': anchorPosition('bottom-left', panel, viewport),
      'bottom-right': anchorPosition('bottom-right', panel, viewport),
      left: anchorPosition('left', panel, viewport),
      right: anchorPosition('right', panel, viewport)
    }).toEqual({
      'top-left': { x: 10, y: 20 },
      'top-left-stack': { x: 10, y: 96 },
      'top-right': { x: 790, y: 20 },
      'bottom-left': { x: 10, y: 540 },
      'bottom-right': { x: 790, y: 540 },
      left: { x: 10, y: 280 },
      right: { x: 790, y: 280 }
    });
  });

  it('defaults Legend below Search and normalizes top-left snaps away from Search overlap', () => {
    const search = { width: 300, height: 64 };
    const legend = { width: 300, height: 132 };
    const viewport = { width: 1200, height: 800, margin: 10, topInset: 92, topStackOffset: 76, bottomInset: 110 };
    const searchPosition = anchorPosition('top-left', search, viewport);
    const legendPosition = anchorPosition('top-left-stack', legend, viewport);

    expect(legendPosition.y).toBeGreaterThanOrEqual(searchPosition.y + search.height + 8);
    expect(normalizePanelAnchor('legend', 'top-left')).toBe('top-left-stack');
    expect(normalizePanelAnchor('search', 'top-left')).toBe('top-left');
  });

  it('clamps panels inside the viewport and above reserved bottom UI', () => {
    const panel = { width: 320, height: 240 };
    const viewport = { width: 390, height: 844, margin: 10, topInset: 44, bottomInset: 210 };

    expect(clampPanelPosition({ x: -200, y: 900 }, panel, viewport)).toEqual({ x: 10, y: 394 });
    expect(anchorPosition('bottom-right', panel, viewport)).toEqual({ x: 60, y: 394 });
  });

  it('selects the nearest snap anchor from a dragged panel center', () => {
    const panel = { width: 300, height: 180 };
    const viewport = { width: 1200, height: 800, margin: 10, topInset: 88, bottomInset: 110 };

    expect(nearestPanelAnchor({ x: 1080, y: 180 }, panel, viewport)).toBe('top-right');
    expect(nearestPanelAnchor({ x: 170, y: 640 }, panel, viewport)).toBe('bottom-left');
    expect(nearestPanelAnchor({ x: 1080, y: 430 }, panel, viewport)).toBe('right');
  });

  it('toggles all chrome while preserving explicit panel hide/show semantics', () => {
    const visible: ChromeVisibilityState = {
      chromeHidden: false,
      panels: { search: true, legend: true, hotRoutes: true }
    };
    const hiddenPanel = reduceChromeVisibility(visible, { type: 'hide-panel', panel: 'legend' });
    const restored = reduceChromeVisibility(hiddenPanel, { type: 'toggle-all' });
    const hiddenAll = reduceChromeVisibility(restored, { type: 'toggle-all' });

    expect(allChromeVisible(hiddenPanel)).toBe(false);
    expect(chromePanelVisible(hiddenPanel, 'legend')).toBe(false);
    expect(allChromeVisible(restored)).toBe(true);
    expect(chromePanelVisible(restored, 'legend')).toBe(true);
    expect(hiddenAll.chromeHidden).toBe(true);
    expect(chromePanelVisible(hiddenAll, 'search')).toBe(false);
  });

  it('starts Busy Pathways hidden but restores it when showing all panels', () => {
    expect(INITIAL_CHROME_PANEL_VISIBILITY).toEqual({ search: true, legend: false, hotRoutes: false });
    expect(DEFAULT_CHROME_PANEL_VISIBILITY).toEqual({ search: true, legend: true, hotRoutes: true });

    const initial: ChromeVisibilityState = {
      chromeHidden: false,
      panels: { ...INITIAL_CHROME_PANEL_VISIBILITY }
    };
    const restored = reduceChromeVisibility(initial, { type: 'show-all' });

    expect(chromePanelVisible(initial, 'hotRoutes')).toBe(false);
    expect(chromePanelVisible(restored, 'hotRoutes')).toBe(true);
    expect(allChromeVisible(restored)).toBe(true);
  });

  it('builds keyboard-accessible snap menu data', () => {
    const items = chromePanelSnapMenuItems('right');

    expect(items.map((item) => item.value)).toEqual(['top-left', 'top-left-stack', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right']);
    expect(items.find((item) => item.value === 'right')).toMatchObject({
      id: 'chrome-panel-snap-right',
      label: 'Right edge',
      ariaLabel: 'Snap panel to right edge',
      role: 'menuitemradio',
      checked: true,
      tabIndex: 0,
      key: '7',
      ariaKeyShortcuts: 'Alt+7'
    });
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    expect(items.every((item) => item.role === 'menuitemradio')).toBe(true);
  });
});
