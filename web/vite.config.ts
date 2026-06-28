import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const packageJSON = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string };
const GITHUB_REPO_URL = 'https://github.com/n30nex/MC-CartoLive';
const APP_ASSET_PACK = normalizeAssetPack(process.env.VITE_APP_ASSET_PACK);

function buildNumber(): string {
  if (process.env.VITE_BUILD_NUMBER) return process.env.VITE_BUILD_NUMBER;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  const git = gitSha();
  if (git) return git.slice(0, 7);
  return new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
}

function gitSha(): string {
  if (process.env.VITE_GIT_SHA) return process.env.VITE_GIT_SHA;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function buildTime(): string {
  if (process.env.VITE_BUILD_TIME) return process.env.VITE_BUILD_TIME;
  if (process.env.SOURCE_DATE_EPOCH) {
    const epochMs = Number(process.env.SOURCE_DATE_EPOCH) * 1000;
    if (Number.isFinite(epochMs)) return new Date(epochMs).toISOString();
  }
  return new Date().toISOString();
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mc-cartolive-asset-pack-html',
      transformIndexHtml(html) {
        return html.replaceAll('__APP_ASSET_PACK__', APP_ASSET_PACK);
      }
    }
  ],
  build: {
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'maplibre', test: /[\\/]node_modules[\\/]maplibre-gl[\\/]/ },
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: 'd3-force', test: /[\\/]node_modules[\\/](d3-force|d3-dispatch|d3-quadtree|d3-timer)[\\/]/ },
            { name: 'gif-export', test: /[\\/]node_modules[\\/]gifenc[\\/]/ },
            { name: 'icons', test: /[\\/]node_modules[\\/]lucide-react[\\/]/ },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/ }
          ]
        }
      }
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJSON.version ?? '1.0.0'),
    __BUILD_NUMBER__: JSON.stringify(buildNumber()),
    __GIT_SHA__: JSON.stringify(gitSha()),
    __BUILD_TIME__: JSON.stringify(buildTime()),
    __RELEASE_URL__: JSON.stringify(`${GITHUB_REPO_URL}/releases/tag/v${packageJSON.version ?? '1.0.0'}`),
    __APP_BRAND_NAME__: JSON.stringify(process.env.VITE_APP_BRAND_NAME || 'MC-CartoLive'),
    __APP_BRAND_URL__: JSON.stringify(process.env.VITE_APP_BRAND_URL || GITHUB_REPO_URL),
    __APP_BRAND_LOGO__: JSON.stringify(process.env.VITE_APP_BRAND_LOGO || ''),
    __APP_ASSET_PACK__: JSON.stringify(APP_ASSET_PACK)
  },
  test: {
    environment: 'jsdom'
  }
});

function normalizeAssetPack(value: string | undefined): 'world' | 'canada' {
  return value === 'canada' ? 'canada' : 'world';
}
