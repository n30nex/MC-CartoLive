import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_SETTINGS } from '../mapSettings';
import MapSettingsDrawer, { LAYER_GROUPS } from './MapSettingsDrawer';

describe('MapSettingsDrawer', () => {
  it('shows simple map modes and common layer controls first', () => {
    const html = renderToStaticMarkup(
      <MapSettingsDrawer settings={DEFAULT_MAP_SETTINGS} onChange={() => undefined} onClose={() => undefined} />
    );

    expect(LAYER_GROUPS.map((group) => group.label)).toEqual(['Base', 'Live', 'Routes', 'Analysis', 'Visuals']);
    expect(html).toContain('Clean Live');
    expect(html).toContain('Terrain/Topo');
    expect(html).toContain('3D');
    expect(html).toContain('Low Bandwidth');
    expect(html).toContain('Routes');
    expect(html).toContain('Labels');
    expect(html).toContain('Live packets');
    expect(html).toContain('Activity heat');
    expect(html).toContain('Terrain relief');
    expect(html).toContain('Style Library');
    expect(html).toContain('Packet Motion');
    expect(html).not.toContain('Weather clouds');
    expect(html).not.toContain('Propagation insights');
    expect(html).not.toContain('Terrain clarity');
    expect(html).not.toContain('Terrain lift');
    expect(html).not.toContain('API key required');
  });

  it('keeps propagation history advanced and disabled by default', () => {
    const html = renderToStaticMarkup(
      <MapSettingsDrawer settings={DEFAULT_MAP_SETTINGS} onChange={() => undefined} onClose={() => undefined} onOpenPropagation={() => undefined} />
    );

    expect(DEFAULT_MAP_SETTINGS.layers.propagationInsights).toBe(false);
    expect(html).not.toContain('Open history');
  });

  it('renders clean flat map defaults', () => {
    const html = renderToStaticMarkup(
      <MapSettingsDrawer settings={DEFAULT_MAP_SETTINGS} onChange={() => undefined} onClose={() => undefined} />
    );

    expect(html).toContain('3D And RF');
    expect(html).toContain('aria-pressed="true"');
    expect(DEFAULT_MAP_SETTINGS.layers.routes).toBe(false);
    expect(DEFAULT_MAP_SETTINGS.layers.terrainHeightmap).toBe(false);
    expect(DEFAULT_MAP_SETTINGS.layers.propagationInsights).toBe(false);
  });
});
