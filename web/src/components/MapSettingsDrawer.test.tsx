import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_SETTINGS } from '../mapSettings';
import MapSettingsDrawer, { LAYER_GROUPS } from './MapSettingsDrawer';

describe('MapSettingsDrawer', () => {
  it('groups map layers and marks weather unavailable without an API key', () => {
    const html = renderToStaticMarkup(
      <MapSettingsDrawer settings={DEFAULT_MAP_SETTINGS} onChange={() => undefined} onClose={() => undefined} />
    );

    expect(LAYER_GROUPS.map((group) => group.label)).toEqual(['Base', 'Live', 'Routes', 'Analysis', 'Visuals']);
    expect(html).toContain('Weather clouds');
    expect(html).toContain('Propagation insights');
    expect(html).toContain('Terrain relief');
    expect(html).toContain('Map Studio');
    expect(html).toContain('Terrain clarity');
    expect(html).not.toContain('Terrain lift');
    expect(html).toContain('OpenFreeMap 3D');
    expect(html).toContain('Offline PMTiles');
    expect(html).toContain('API key required');
    expect(html).toContain('disabled=""');
  });

  it('can expose propagation history from settings without enabling it by default', () => {
    const html = renderToStaticMarkup(
      <MapSettingsDrawer settings={DEFAULT_MAP_SETTINGS} onChange={() => undefined} onClose={() => undefined} onOpenPropagation={() => undefined} />
    );

    expect(DEFAULT_MAP_SETTINGS.layers.propagationInsights).toBe(false);
    expect(html).toContain('Open history');
  });

  it('renders the 2.9.0 layer presets with Live active by default', () => {
    const html = renderToStaticMarkup(
      <MapSettingsDrawer settings={DEFAULT_MAP_SETTINGS} onChange={() => undefined} onClose={() => undefined} />
    );

    expect(html).toContain('Layer presets');
    expect(html).toContain('Live');
    expect(html).toContain('Clean');
    expect(html).toContain('Analysis');
    expect(html).toContain('3D');
    expect(html).toContain('3D And RF');
    expect(html).toContain('Role Towers');
    expect(html).toContain('aria-pressed="true"');
    expect(DEFAULT_MAP_SETTINGS.layers.routes).toBe(false);
    expect(DEFAULT_MAP_SETTINGS.layers.terrainHeightmap).toBe(true);
    expect(DEFAULT_MAP_SETTINGS.layers.propagationInsights).toBe(false);
  });
});
