import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_SETTINGS } from '../mapSettings';
import MapSettingsDrawer, { LAYER_GROUPS } from './MapSettingsDrawer';

describe('MapSettingsDrawer', () => {
  it('groups map layers and marks weather unavailable without an API key', () => {
    const html = renderToStaticMarkup(
      <MapSettingsDrawer settings={DEFAULT_MAP_SETTINGS} onChange={() => undefined} onClose={() => undefined} />
    );

    expect(LAYER_GROUPS.map((group) => group.label)).toEqual(['Base', 'Mesh', 'Live Motion', '3D', 'Analysis']);
    expect(html).toContain('Weather clouds');
    expect(html).toContain('Propagation insights');
    expect(html).toContain('Terrain relief');
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
});
