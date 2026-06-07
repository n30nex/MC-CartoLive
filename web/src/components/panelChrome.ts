import { useCallback, useEffect, useRef, useState } from 'react';

export type ChromePanelID = 'search' | 'legend' | 'hotRoutes';

export type ChromePanelAnchor = 'top-left' | 'top-left-stack' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right';

export const CHROME_PANEL_ANCHORS: readonly { value: ChromePanelAnchor; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-left-stack', label: 'Under search' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'left', label: 'Left edge' },
  { value: 'right', label: 'Right edge' }
] as const;

export const DEFAULT_CHROME_PANEL_ANCHORS: Record<ChromePanelID, ChromePanelAnchor> = {
  search: 'top-left',
  legend: 'top-left-stack',
  hotRoutes: 'top-right'
};

export const DEFAULT_CHROME_PANEL_VISIBILITY: Record<ChromePanelID, boolean> = {
  search: true,
  legend: true,
  hotRoutes: true
};

export const INITIAL_CHROME_PANEL_VISIBILITY: Record<ChromePanelID, boolean> = {
  search: true,
  legend: true,
  hotRoutes: false
};

export const CHROME_PANEL_SNAP_KEYS: Record<ChromePanelAnchor, string> = {
  'top-left': '1',
  'top-left-stack': '2',
  'top-right': '3',
  'bottom-left': '4',
  'bottom-right': '5',
  left: '6',
  right: '7'
};

export interface ViewportBounds {
  width: number;
  height: number;
  margin?: number;
  topInset?: number;
  topStackOffset?: number;
  bottomInset?: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ChromePanelSnapMenuItem {
  id: `chrome-panel-snap-${ChromePanelAnchor}`;
  value: ChromePanelAnchor;
  label: string;
  ariaLabel: string;
  role: 'menuitemradio';
  checked: boolean;
  tabIndex: 0 | -1;
  key: string;
  ariaKeyShortcuts: string;
}

export function clampPanelPosition(position: Point, panel: PanelSize, viewport: ViewportBounds): Point {
  const margin = viewport.margin ?? 10;
  const topInset = viewport.topInset ?? margin;
  const topStackOffset = viewport.topStackOffset ?? 76;
  const bottomInset = viewport.bottomInset ?? margin;
  const maxX = Math.max(margin, viewport.width - panel.width - margin);
  const maxY = Math.max(topInset, viewport.height - panel.height - bottomInset);
  return {
    x: clamp(position.x, margin, maxX),
    y: clamp(position.y, topInset, maxY)
  };
}

export function anchorPosition(anchor: ChromePanelAnchor, panel: PanelSize, viewport: ViewportBounds): Point {
  const margin = viewport.margin ?? 10;
  const topInset = viewport.topInset ?? margin;
  const topStackOffset = viewport.topStackOffset ?? 76;
  const bottomInset = viewport.bottomInset ?? margin;
  const centerY = Math.max(topInset, Math.round((viewport.height - panel.height - bottomInset + topInset) / 2));
  const rightX = viewport.width - panel.width - margin;
  const bottomY = viewport.height - panel.height - bottomInset;

  const positions: Record<ChromePanelAnchor, Point> = {
    'top-left': { x: margin, y: topInset },
    'top-left-stack': { x: margin, y: topInset + topStackOffset },
    'top-right': { x: rightX, y: topInset },
    'bottom-left': { x: margin, y: bottomY },
    'bottom-right': { x: rightX, y: bottomY },
    left: { x: margin, y: centerY },
    right: { x: rightX, y: centerY }
  };
  return clampPanelPosition(positions[anchor], panel, viewport);
}

export function normalizePanelAnchor(panel: ChromePanelID, anchor: ChromePanelAnchor): ChromePanelAnchor {
  return panel === 'legend' && anchor === 'top-left' ? 'top-left-stack' : anchor;
}

export function nearestPanelAnchor(point: Point, panel: PanelSize, viewport: ViewportBounds): ChromePanelAnchor {
  let nearest: ChromePanelAnchor = 'top-left';
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const option of CHROME_PANEL_ANCHORS) {
    const position = anchorPosition(option.value, panel, viewport);
    const center = { x: position.x + panel.width / 2, y: position.y + panel.height / 2 };
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    if (distance < nearestDistance) {
      nearest = option.value;
      nearestDistance = distance;
    }
  }
  return nearest;
}

const SNAP_MENU_TEMPLATES: Omit<ChromePanelSnapMenuItem, 'checked' | 'tabIndex'>[] = CHROME_PANEL_ANCHORS.map((option) => {
  const key = CHROME_PANEL_SNAP_KEYS[option.value];
  return {
    id: `chrome-panel-snap-${option.value}`,
    value: option.value,
    label: option.label,
    ariaLabel: `Snap panel to ${option.label.toLowerCase()}`,
    role: 'menuitemradio',
    key,
    ariaKeyShortcuts: `Alt+${key}`
  };
});

export function chromePanelSnapMenuItems(currentAnchor: ChromePanelAnchor): ChromePanelSnapMenuItem[] {
  return SNAP_MENU_TEMPLATES.map((template) => ({
    ...template,
    checked: template.value === currentAnchor,
    tabIndex: template.value === currentAnchor ? 0 : -1
  }));
}

export interface ChromeVisibilityState {
  chromeHidden: boolean;
  panels: Record<ChromePanelID, boolean>;
}

export type ChromeVisibilityAction =
  | { type: 'hide-all' }
  | { type: 'show-all' }
  | { type: 'toggle-all' }
  | { type: 'hide-panel'; panel: ChromePanelID }
  | { type: 'show-panel'; panel: ChromePanelID };

export function reduceChromeVisibility(state: ChromeVisibilityState, action: ChromeVisibilityAction): ChromeVisibilityState {
  switch (action.type) {
    case 'hide-all':
      return { ...state, chromeHidden: true };
    case 'show-all':
      return { chromeHidden: false, panels: { ...DEFAULT_CHROME_PANEL_VISIBILITY } };
    case 'toggle-all':
      return allChromeVisible(state) ? reduceChromeVisibility(state, { type: 'hide-all' }) : reduceChromeVisibility(state, { type: 'show-all' });
    case 'hide-panel':
      return { ...state, panels: { ...state.panels, [action.panel]: false } };
    case 'show-panel':
      return { ...state, chromeHidden: false, panels: { ...state.panels, [action.panel]: true } };
    default:
      return state;
  }
}

export function allChromeVisible(state: ChromeVisibilityState): boolean {
  return !state.chromeHidden && Object.values(state.panels).every(Boolean);
}

export function chromePanelVisible(state: ChromeVisibilityState, panel: ChromePanelID): boolean {
  return !state.chromeHidden && state.panels[panel];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function useViewportBounds(): ViewportBounds {
  const [bounds, setBounds] = useState<ViewportBounds>({ width: 0, height: 0, margin: 10, topInset: 92, bottomInset: 110 });
  const shellRef = useRef<HTMLElement | null>(null);

  const measure = useCallback(() => {
    const shell = shellRef.current;
    const vcrHeight = shell ? Number.parseFloat(getComputedStyle(shell).getPropertyValue('--vcr-bar-height')) || 92 : 92;
    const small = window.innerWidth <= 760;
    setBounds({
      width: window.innerWidth,
      height: window.innerHeight,
      margin: 10,
      topInset: small ? 48 : 92,
      topStackOffset: small ? 58 : 76,
      bottomInset: vcrHeight + 18
    });
  }, []);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell');
    shellRef.current = shell;
    measure();
    if (!shell || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return bounds;
}
