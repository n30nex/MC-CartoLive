import { describe, expect, it, vi } from 'vitest';
import swSource from '../public/sw.js?raw';
import { activateWaitingServiceWorker, cleanupLegacyServiceWorkers, clearLegacyCaches, configureServiceWorker, serviceWorkerEnabled, serviceWorkerMayCacheURL, serviceWorkerScriptURL, type ServiceWorkerWindowLike } from './serviceWorker';

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

  it('only activates an installed worker after an explicit request', () => {
    const postMessage = vi.fn();
    const reload = vi.fn();
    let fallback: (() => void) | undefined;
    const registration = { waiting: { state: 'installed', postMessage, addEventListener: vi.fn() } };
    const win = {
      location: { reload },
      sessionStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
      setTimeout: vi.fn((callback: () => void) => { fallback = callback; return 1; })
    } as unknown as ServiceWorkerWindowLike;

    expect(activateWaitingServiceWorker(registration as never, win)).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: 'ACTIVATE_UPDATE' });
    expect(reload).not.toHaveBeenCalled();
    fallback?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never auto-activates or claims clients from worker lifecycle events', () => {
    const installBlock = swSource.slice(swSource.indexOf("self.addEventListener('install'"), swSource.indexOf("self.addEventListener('message'"));
    expect(installBlock).not.toContain('skipWaiting');
    expect(swSource).not.toContain('clients.claim');
    expect(swSource).toContain("event.data?.type === 'ACTIVATE_UPDATE'");
  });

  it('detects an already-waiting worker and reloads on controllerchange only after consent', async () => {
    const postMessage = vi.fn();
    const reload = vi.fn();
    const dispatchEvent = vi.fn();
    let controllerChange: (() => void) | undefined;
    const registration = { waiting: { state: 'installed', postMessage, addEventListener: vi.fn() }, unregister: vi.fn() };
    const container = {
      controller: {},
      getRegistrations: vi.fn(async () => []),
      register: vi.fn(async () => registration),
      addEventListener: vi.fn((_type: string, listener: () => void) => { controllerChange = listener; })
    };
    const win = {
      document: { readyState: 'complete' },
      navigator: { serviceWorker: container },
      location: { reload },
      sessionStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
      dispatchEvent,
      setTimeout: vi.fn(() => 1)
    } as unknown as ServiceWorkerWindowLike;

    configureServiceWorker(win);
    await vi.waitFor(() => expect(dispatchEvent).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
    expect(activateWaitingServiceWorker(registration as never, win)).toBe(true);
    controllerChange?.();
    expect(postMessage).toHaveBeenCalledWith({ type: 'ACTIVATE_UPDATE' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports updatefound only after the new worker reaches installed', async () => {
    let updateFound: (() => void) | undefined;
    let stateChange: (() => void) | undefined;
    const worker = { state: 'installing', postMessage: vi.fn(), addEventListener: vi.fn((_type: string, listener: () => void) => { stateChange = listener; }) };
    const registration = { waiting: null, installing: worker, unregister: vi.fn(), addEventListener: vi.fn((_type: string, listener: () => void) => { updateFound = listener; }) };
    const dispatchEvent = vi.fn();
    const container = { controller: {}, getRegistrations: vi.fn(async () => []), register: vi.fn(async () => registration), addEventListener: vi.fn() };
    const win = { document: { readyState: 'complete' }, navigator: { serviceWorker: container }, dispatchEvent } as unknown as ServiceWorkerWindowLike;
    configureServiceWorker(win);
    await vi.waitFor(() => expect(updateFound).toBeTypeOf('function'));
    updateFound?.();
    expect(dispatchEvent).not.toHaveBeenCalled();
    worker.state = 'installed';
    stateChange?.();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
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
