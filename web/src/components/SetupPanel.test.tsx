import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SetupPanel, { buildSetupEnvSnippet } from './SetupPanel';

describe('SetupPanel', () => {
  it('renders a first-run setup page without secret fields', () => {
    const html = renderToStaticMarkup(<SetupPanel onClose={vi.fn()} />);
    expect(html).toContain('First-run deployment setup');
    expect(html).toContain('MAP_REGION_PRESET=world');
    expect(html).toContain('PUBLIC_REGIONS=');
    expect(html).not.toContain('MQTT_PASSWORD');
    expect(html).not.toContain('MESHCORE_CHANNEL_SECRETS');
  });

  it('builds custom region snippets with public-safe operator settings', () => {
    const snippet = buildSetupEnvSnippet({
      preset: 'custom',
      publicBaseURL: 'https://mesh.example',
      regions: 'r1,r2',
      bounds: '-45,110,-10,155',
      brandName: 'AUS Mesh',
      brandURL: 'https://example.org',
      assetPack: 'world'
    });
    expect(snippet).toContain('PUBLIC_BASE_URL=https://mesh.example');
    expect(snippet).toContain('MAP_REGION_PRESET=custom');
    expect(snippet).toContain('PUBLIC_REGIONS=r1,r2');
    expect(snippet).toContain('MAP_BOUNDS=-45,110,-10,155');
    expect(snippet).toContain('VITE_APP_BRAND_NAME=AUS Mesh');
    expect(snippet).toContain('VITE_APP_ASSET_PACK=world');
    expect(snippet).toContain('VITE_ENABLE_SERVICE_WORKER=false');
  });
});
