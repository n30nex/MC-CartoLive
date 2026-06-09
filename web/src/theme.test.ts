import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_PALETTE_ID,
  THEME_MODE_STORAGE_KEY,
  THEME_PALETTE_IDS,
  THEME_PALETTE_STORAGE_KEY,
  THEME_PALETTES,
  contrastRatio,
  normalizeThemeMode,
  readablePaletteText,
  readStoredThemePreference,
  resolveThemeMode,
  themePaletteByID,
  themeStyleVariables,
  toggleThemeMode,
  writeStoredThemePreference
} from './theme';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('theme helpers', () => {
  it('validates theme mode and palette ids', () => {
    expect(normalizeThemeMode('light')).toBe('light');
    expect(normalizeThemeMode('dark')).toBe('dark');
    expect(normalizeThemeMode('system')).toBe('system');
    expect(normalizeThemeMode('other')).toBe('system');
    expect(toggleThemeMode('system')).toBe('dark');
    expect(toggleThemeMode('dark')).toBe('light');
    expect(toggleThemeMode('light')).toBe('system');
    expect(resolveThemeMode('dark')).toBe('dark');
    expect(resolveThemeMode('light')).toBe('light');
    expect(THEME_PALETTE_IDS).toEqual([
      'neutral-blue',
      'arctic',
      'amber',
      'charcoal-white',
      'command',
      'cyberpunk',
      'earth',
      'electric-lime',
      'indigo-clean',
      'midnight-gold',
      'phosphor',
      'radar',
      'signal-orange',
      'slate-rose',
      'synthwave',
      'teal'
    ]);
    expect(themePaletteByID('missing').id).toBe(DEFAULT_THEME_PALETTE_ID);
  });

  it('reads and writes client-side theme preferences', () => {
    const storage = new MemoryStorage();
    const palette = THEME_PALETTES.find((item) => item.id === 'radar') ?? THEME_PALETTES[0];

    writeStoredThemePreference({ mode: 'light', palette }, storage);

    expect(storage.getItem(THEME_MODE_STORAGE_KEY)).toBe('light');
    expect(storage.getItem(THEME_PALETTE_STORAGE_KEY)).toBe('radar');
    expect(readStoredThemePreference(storage)).toEqual({ mode: 'light', palette });
  });

  it('exposes palette CSS variables without mutating registry entries', () => {
    const palette = themePaletteByID('cyberpunk');
    const variables = themeStyleVariables(palette, 'dark');
    variables['--palette-primary'] = '#000000';

    expect(palette.vars['--palette-primary']).toBe('#00F0FF');
    expect(variables['--palette-readable-text']).toBeTruthy();
  });

  it('keeps readable text options above AA contrast in dark and light modes', () => {
    for (const palette of THEME_PALETTES) {
      expect(contrastRatio(readablePaletteText(palette, 'dark'), palette.vars['--palette-bg-raised'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(readablePaletteText(palette, 'light'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
