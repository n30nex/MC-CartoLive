export type ThemeMode = 'dark' | 'light' | 'system';

export interface ThemePalette {
  id: string;
  name: string;
  vars: Record<string, string>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const THEME_MODE_STORAGE_KEY = 'mc-cartolive-theme-mode';
export const THEME_PALETTE_STORAGE_KEY = 'mc-cartolive-palette-id';
export const DEFAULT_THEME_MODE: ThemeMode = 'system';
export const DEFAULT_THEME_PALETTE_ID = 'neutral-blue';

export const THEME_PALETTES: readonly ThemePalette[] = [
  {
    id: 'neutral-blue',
    name: 'Neutral Blue',
    vars: {
      '--palette-bg-base': '#09090B',
      '--palette-bg-surface': '#111114',
      '--palette-bg-raised': '#1A1A1F',
      '--palette-border': '#27272A',
      '--palette-border-subtle': '#1E1E22',
      '--palette-primary': '#3B82F6',
      '--palette-primary-dim': '#1D4ED8',
      '--palette-secondary': '#A78BFA',
      '--palette-green': '#22C55E',
      '--palette-danger': '#EF4444',
      '--palette-warn': '#EAB308',
      '--palette-text-bright': '#FAFAFA',
      '--palette-text-normal': '#A1A1AA',
      '--palette-text-muted': '#73737B',
      '--palette-text-dim': '#5F5F65'
    }
  },
  {
    id: 'arctic',
    name: 'Arctic',
    vars: {
      '--palette-bg-base': '#0A0E18',
      '--palette-bg-surface': '#101624',
      '--palette-bg-raised': '#182030',
      '--palette-border': '#1E2C44',
      '--palette-border-subtle': '#152438',
      '--palette-primary': '#38BDF8',
      '--palette-primary-dim': '#0369A1',
      '--palette-secondary': '#C084FC',
      '--palette-green': '#34D399',
      '--palette-danger': '#FB7185',
      '--palette-warn': '#FCD34D',
      '--palette-text-bright': '#F0F4FA',
      '--palette-text-normal': '#A4B4CC',
      '--palette-text-muted': '#667790',
      '--palette-text-dim': '#56647A'
    }
  },
  {
    id: 'amber',
    name: 'Amber',
    vars: {
      '--palette-bg-base': '#0C0A09',
      '--palette-bg-surface': '#1C1917',
      '--palette-bg-raised': '#292524',
      '--palette-border': '#292524',
      '--palette-border-subtle': '#1C1917',
      '--palette-primary': '#F59E0B',
      '--palette-primary-dim': '#B45309',
      '--palette-secondary': '#4ADE80',
      '--palette-green': '#4ADE80',
      '--palette-danger': '#EF4444',
      '--palette-warn': '#FBBF24',
      '--palette-text-bright': '#FAFAF9',
      '--palette-text-normal': '#D6D3D1',
      '--palette-text-muted': '#A8A29E',
      '--palette-text-dim': '#78716C'
    }
  },
  {
    id: 'charcoal-white',
    name: 'Charcoal White',
    vars: {
      '--palette-bg-base': '#161616',
      '--palette-bg-surface': '#1E1E1E',
      '--palette-bg-raised': '#282828',
      '--palette-border': '#333333',
      '--palette-border-subtle': '#252525',
      '--palette-primary': '#FFFFFF',
      '--palette-primary-dim': '#999999',
      '--palette-secondary': '#3B82F6',
      '--palette-green': '#22C55E',
      '--palette-danger': '#EF4444',
      '--palette-warn': '#EAB308',
      '--palette-text-bright': '#FFFFFF',
      '--palette-text-normal': '#B0B0B0',
      '--palette-text-muted': '#7C7C7C',
      '--palette-text-dim': '#696969'
    }
  },
  {
    id: 'command',
    name: 'Command',
    vars: {
      '--palette-bg-base': '#0C0A10',
      '--palette-bg-surface': '#14111A',
      '--palette-bg-raised': '#1E1A26',
      '--palette-border': '#2A2434',
      '--palette-border-subtle': '#1E1828',
      '--palette-primary': '#E85D75',
      '--palette-primary-dim': '#8B2E42',
      '--palette-secondary': '#8B9FE8',
      '--palette-green': '#5AD8A6',
      '--palette-danger': '#FF6B6B',
      '--palette-warn': '#F0C674',
      '--palette-text-bright': '#F0ECF4',
      '--palette-text-normal': '#B4AACC',
      '--palette-text-muted': '#796F91',
      '--palette-text-dim': '#645D75'
    }
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    vars: {
      '--palette-bg-base': '#0C0A14',
      '--palette-bg-surface': '#13101E',
      '--palette-bg-raised': '#1A1628',
      '--palette-border': '#2A2440',
      '--palette-border-subtle': '#1E1A30',
      '--palette-primary': '#00F0FF',
      '--palette-primary-dim': '#0088A0',
      '--palette-secondary': '#FF2E97',
      '--palette-green': '#39FF14',
      '--palette-danger': '#FF3030',
      '--palette-warn': '#FFE744',
      '--palette-text-bright': '#EAE6F5',
      '--palette-text-normal': '#9E96B8',
      '--palette-text-muted': '#766F93',
      '--palette-text-dim': '#625D79'
    }
  },
  {
    id: 'earth',
    name: 'Earth',
    vars: {
      '--palette-bg-base': '#110E0A',
      '--palette-bg-surface': '#1A1610',
      '--palette-bg-raised': '#26211A',
      '--palette-border': '#302A20',
      '--palette-border-subtle': '#201C14',
      '--palette-primary': '#D4915C',
      '--palette-primary-dim': '#8B5A30',
      '--palette-secondary': '#7DD3A8',
      '--palette-green': '#7DD3A8',
      '--palette-danger': '#E57373',
      '--palette-warn': '#F0C674',
      '--palette-text-bright': '#F0E8DA',
      '--palette-text-normal': '#C4B8A4',
      '--palette-text-muted': '#8A7E6C',
      '--palette-text-dim': '#6B6253'
    }
  },
  {
    id: 'electric-lime',
    name: 'Electric Lime',
    vars: {
      '--palette-bg-base': '#0A0C08',
      '--palette-bg-surface': '#121410',
      '--palette-bg-raised': '#1C1E18',
      '--palette-border': '#282C22',
      '--palette-border-subtle': '#1E2218',
      '--palette-primary': '#B8E636',
      '--palette-primary-dim': '#6A8A14',
      '--palette-secondary': '#36C4E6',
      '--palette-green': '#4ADE80',
      '--palette-danger': '#FF6B6B',
      '--palette-warn': '#FFD166',
      '--palette-text-bright': '#EEF0E8',
      '--palette-text-normal': '#B0B8A0',
      '--palette-text-muted': '#6F7861',
      '--palette-text-dim': '#5D6454'
    }
  },
  {
    id: 'indigo-clean',
    name: 'Indigo Clean',
    vars: {
      '--palette-bg-base': '#0B0B14',
      '--palette-bg-surface': '#12121C',
      '--palette-bg-raised': '#1A1A28',
      '--palette-border': '#252536',
      '--palette-border-subtle': '#1C1C2A',
      '--palette-primary': '#6366F1',
      '--palette-primary-dim': '#4338CA',
      '--palette-secondary': '#06B6D4',
      '--palette-green': '#10B981',
      '--palette-danger': '#F43F5E',
      '--palette-warn': '#F59E0B',
      '--palette-text-bright': '#F8F8FC',
      '--palette-text-normal': '#A0A0B8',
      '--palette-text-muted': '#717194',
      '--palette-text-dim': '#606076'
    }
  },
  {
    id: 'midnight-gold',
    name: 'Midnight Gold',
    vars: {
      '--palette-bg-base': '#07081A',
      '--palette-bg-surface': '#0E1030',
      '--palette-bg-raised': '#181C48',
      '--palette-border': '#1E2254',
      '--palette-border-subtle': '#141840',
      '--palette-primary': '#E2B340',
      '--palette-primary-dim': '#9A7520',
      '--palette-secondary': '#60A5FA',
      '--palette-green': '#4ADE80',
      '--palette-danger': '#F87171',
      '--palette-warn': '#FBBF24',
      '--palette-text-bright': '#F0ECE0',
      '--palette-text-normal': '#B8B2A0',
      '--palette-text-muted': '#7A7566',
      '--palette-text-dim': '#615E81'
    }
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    vars: {
      '--palette-bg-base': '#030712',
      '--palette-bg-surface': '#0A1628',
      '--palette-bg-raised': '#14243D',
      '--palette-border': '#14243D',
      '--palette-border-subtle': '#0E1C32',
      '--palette-primary': '#4ADE80',
      '--palette-primary-dim': '#166534',
      '--palette-secondary': '#22D3EE',
      '--palette-green': '#4ADE80',
      '--palette-danger': '#F87171',
      '--palette-warn': '#FDE047',
      '--palette-text-bright': '#DCFCE7',
      '--palette-text-normal': '#A7D8B4',
      '--palette-text-muted': '#6A7C64',
      '--palette-text-dim': '#506950'
    }
  },
  {
    id: 'radar',
    name: 'Radar',
    vars: {
      '--palette-bg-base': '#0B1118',
      '--palette-bg-surface': '#111921',
      '--palette-bg-raised': '#1A242E',
      '--palette-border': '#243040',
      '--palette-border-subtle': '#182430',
      '--palette-primary': '#3EE08F',
      '--palette-primary-dim': '#1A7A48',
      '--palette-secondary': '#5CC8E4',
      '--palette-green': '#3EE08F',
      '--palette-danger': '#FF6B6B',
      '--palette-warn': '#FFD166',
      '--palette-text-bright': '#EAF0F4',
      '--palette-text-normal': '#B0BEC5',
      '--palette-text-muted': '#607D8B',
      '--palette-text-dim': '#536674'
    }
  },
  {
    id: 'signal-orange',
    name: 'Signal Orange',
    vars: {
      '--palette-bg-base': '#08101C',
      '--palette-bg-surface': '#0E1828',
      '--palette-bg-raised': '#162236',
      '--palette-border': '#1E3050',
      '--palette-border-subtle': '#142640',
      '--palette-primary': '#FF8C42',
      '--palette-primary-dim': '#A85520',
      '--palette-secondary': '#64B5F6',
      '--palette-green': '#66DE93',
      '--palette-danger': '#FF6B6B',
      '--palette-warn': '#FFE066',
      '--palette-text-bright': '#ECF0F8',
      '--palette-text-normal': '#A8B8CC',
      '--palette-text-muted': '#647897',
      '--palette-text-dim': '#56667A'
    }
  },
  {
    id: 'slate-rose',
    name: 'Slate Rose',
    vars: {
      '--palette-bg-base': '#0F0F14',
      '--palette-bg-surface': '#18181F',
      '--palette-bg-raised': '#24242E',
      '--palette-border': '#2A2A36',
      '--palette-border-subtle': '#1E1E28',
      '--palette-primary': '#F472B6',
      '--palette-primary-dim': '#9D174D',
      '--palette-secondary': '#A78BFA',
      '--palette-green': '#4ADE80',
      '--palette-danger': '#F87171',
      '--palette-warn': '#FBBF24',
      '--palette-text-bright': '#F0EEF4',
      '--palette-text-normal': '#B8B4C4',
      '--palette-text-muted': '#79758A',
      '--palette-text-dim': '#666275'
    }
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    vars: {
      '--palette-bg-base': '#0E0816',
      '--palette-bg-surface': '#160E22',
      '--palette-bg-raised': '#201630',
      '--palette-border': '#2C2040',
      '--palette-border-subtle': '#1C1430',
      '--palette-primary': '#FF6EC7',
      '--palette-primary-dim': '#A83878',
      '--palette-secondary': '#00E5FF',
      '--palette-green': '#5AE8B6',
      '--palette-danger': '#FF5C5C',
      '--palette-warn': '#FFD54F',
      '--palette-text-bright': '#F4ECFF',
      '--palette-text-normal': '#B8A8D8',
      '--palette-text-muted': '#7D6B9E',
      '--palette-text-dim': '#675A7D'
    }
  },
  {
    id: 'teal',
    name: 'Teal',
    vars: {
      '--palette-bg-base': '#0A0F0F',
      '--palette-bg-surface': '#111B1B',
      '--palette-bg-raised': '#1A2727',
      '--palette-border': '#1A2727',
      '--palette-border-subtle': '#142020',
      '--palette-primary': '#14B8A6',
      '--palette-primary-dim': '#0F766E',
      '--palette-secondary': '#E87A41',
      '--palette-green': '#4ADE80',
      '--palette-danger': '#EF4444',
      '--palette-warn': '#FBBF24',
      '--palette-text-bright': '#E2F0F0',
      '--palette-text-normal': '#B0CECE',
      '--palette-text-muted': '#6B8A8A',
      '--palette-text-dim': '#4D6A6A'
    }
  }
] as const;

export const THEME_PALETTE_IDS = THEME_PALETTES.map((palette) => palette.id);

export interface ThemePreference {
  mode: ThemeMode;
  palette: ThemePalette;
}

export function normalizeThemeMode(value: string | null | undefined): ThemeMode {
  if (value === 'light' || value === 'dark' || value === 'system') return value;
  return DEFAULT_THEME_MODE;
}

export function toggleThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'system' ? 'dark' : mode === 'dark' ? 'light' : 'system';
}

export function resolveThemeMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode !== 'system') return mode;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export function themePaletteByID(id: string | null | undefined): ThemePalette {
  return THEME_PALETTES.find((palette) => palette.id === id) ?? THEME_PALETTES.find((palette) => palette.id === DEFAULT_THEME_PALETTE_ID) ?? THEME_PALETTES[0];
}

export function themeStyleVariables(palette: ThemePalette, mode: ThemeMode = DEFAULT_THEME_MODE): Record<string, string> {
  return {
    ...palette.vars,
    '--palette-readable-text': readablePaletteText(palette, mode)
  };
}

export function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const foreground = parseHexColor(foregroundHex);
  const background = parseHexColor(backgroundHex);
  if (!foreground || !background) return 0;
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const light = Math.max(foregroundLuminance, backgroundLuminance);
  const dark = Math.min(foregroundLuminance, backgroundLuminance);
  return (light + 0.05) / (dark + 0.05);
}

export function readablePaletteText(palette: ThemePalette, mode: ThemeMode): string {
  const background = mode === 'light' ? '#ffffff' : palette.vars['--palette-bg-raised'];
  const candidates = mode === 'light'
    ? ['#0f172a', palette.vars['--palette-text-bright'], palette.vars['--palette-text-normal']]
    : [palette.vars['--palette-text-bright'], palette.vars['--palette-text-normal'], '#f8fafc'];
  return candidates.find((candidate) => contrastRatio(candidate, background) >= 4.5) ?? (mode === 'light' ? '#0f172a' : '#f8fafc');
}

export function readStoredThemePreference(storage: StorageLike | undefined = browserStorage()): ThemePreference {
  return {
    mode: normalizeThemeMode(storage?.getItem(THEME_MODE_STORAGE_KEY)),
    palette: themePaletteByID(storage?.getItem(THEME_PALETTE_STORAGE_KEY))
  };
}

export function writeStoredThemePreference(preference: ThemePreference, storage: StorageLike | undefined = browserStorage()): void {
  storage?.setItem(THEME_MODE_STORAGE_KEY, preference.mode);
  storage?.setItem(THEME_PALETTE_STORAGE_KEY, preference.palette.id);
}

export function applyDocumentTheme(preference: ThemePreference, root: HTMLElement | undefined = document.documentElement): void {
  root.dataset.themeMode = preference.mode;
  root.dataset.themePalette = preference.palette.id;
  root.style.colorScheme = preference.mode === 'system' ? 'dark light' : preference.mode;
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function parseHexColor(value: string): [number, number, number] | null {
  const normalized = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const [r, g, b] = [red, green, blue].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
