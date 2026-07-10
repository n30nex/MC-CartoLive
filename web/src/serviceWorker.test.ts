import { describe, expect, it, vi } from 'vitest';
import { cleanupLegacyServiceWorkers, clearLegacyCaches, serviceWorkerEnabled, serviceWorkerMayCacheURL, serviceWorkerScriptURL, type ServiceWorkerWindowLike } from './serviceWorker';

describe('service worker release safety', () => {
  it('is enabled unless explicitly disabled', () => {
    expect(serviceWorkerEnabled({})).toBe(true);
    expect(serviceWorkerEnabled({ VITE_ENABLE_SERVICE_WORKER: 'false' })).toBe(false);
    expect(serviceWorkerEnabled({ VITE_ENABLE_SERVICE_WORKER: 'true' })).toBe(true);
  });

  it('deletes legacy mc-cartolive caches only', async () => {
    const deleted: string[] = [];
    const win = {
      caches: {
        keys: vi.fn(async () => ['mc-cartolive-v1', 'tiles-cache', 'mc-cartolive-old']),
        delete: vi.fn(async (key: string) => {
          deleted.push(key);
          return true;
        })
      }
    } as unknown as ServiceWorkerWindowLike;

    await expect(clearLegacyCaches(win)).resolves.toEqual(['mc-cartolive-v1', 'mc-cartolive-old']);
    expect(deleted).toEqual(['mc-cartolive-v1', 'mc-cartolive-old']);
  });

  it('keys the worker script to release version and git sha', () => {
    expect(serviceWorkerScriptURL('3.2.0', 'abcdef0123456789')).toBe('/sw.js?version=3.2.0&sha=abcdef012345');
  });

  it('never admits third-party tiles to the app runtime cache', () => {
    expect(serviceWorkerMayCacheURL('/assets/index.js', 'https://carto.canadaverse.org')).toBe(true);
    expect(serviceWorkerMayCacheURL('https://tiles.openfreemap.org/planet/5/8/9.pbf', 'https://carto.canadaverse.org')).toBe(false);
    expect(serviceWorkerMayCacheURL('not a valid absolute origin', 'bad origin')).toBe(false);
  });

  it('unregisters service workers and clears legacy caches when disabled', async () => {
    const unregister = vi.fn(async () => true);
    const win = {
      caches: {
        keys: vi.fn(async () => ['mc-cartolive-v1']),
        delete: vi.fn(async () => true)
      },
      location: { reload: vi.fn() },
      navigator: {
        serviceWorker: {
          controller: null,
          getRegistrations: vi.fn(async () => [{ unregister }])
        }
      },
      sessionStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn()
      }
    } as unknown as ServiceWorkerWindowLike;

    await cleanupLegacyServiceWorkers(win);

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(win.caches?.delete).toHaveBeenCalledWith('mc-cartolive-v1');
    expect(win.location?.reload).not.toHaveBeenCalled();
  });
});
