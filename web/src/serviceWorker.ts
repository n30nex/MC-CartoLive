import { appVersion } from './buildInfo';

const LEGACY_CACHE_PREFIX = 'mc-cartolive';
const SW_CLEANUP_RELOAD_KEY = `mc-cartolive-sw-cleanup-reload-${appVersion}`;

type CacheStorageLike = Pick<CacheStorage, 'keys' | 'delete'>;
type ServiceWorkerRegistrationLike = Pick<ServiceWorkerRegistration, 'unregister'>;
type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, 'controller' | 'register' | 'getRegistrations'>;

export interface ServiceWorkerWindowLike {
  addEventListener?: Window['addEventListener'];
  caches?: CacheStorageLike;
  document?: Pick<Document, 'readyState'>;
  location?: Pick<Location, 'reload'>;
  navigator?: Navigator & { serviceWorker?: ServiceWorkerContainerLike };
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>;
}

export function serviceWorkerEnabled(env: Record<string, unknown> = import.meta.env): boolean {
  return env.VITE_ENABLE_SERVICE_WORKER === 'true';
}

export function configureServiceWorker(win: ServiceWorkerWindowLike = window): void {
  if (serviceWorkerEnabled()) {
    runOnLoad(() => {
      void win.navigator?.serviceWorker?.register('/sw.js').catch(() => undefined);
    }, win);
    return;
  }
  runOnLoad(() => {
    void cleanupLegacyServiceWorkers(win).catch(() => undefined);
  }, win);
}

export async function cleanupLegacyServiceWorkers(win: ServiceWorkerWindowLike = window): Promise<void> {
  const serviceWorker = win.navigator?.serviceWorker;
  if (serviceWorker?.getRegistrations) {
    const registrations = await serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  await clearLegacyCaches(win);
  if (serviceWorker?.controller) {
    reloadOnce(win, SW_CLEANUP_RELOAD_KEY);
  }
}

export async function clearLegacyCaches(win: ServiceWorkerWindowLike = window): Promise<string[]> {
  const cacheStorage = win.caches;
  if (!cacheStorage) return [];
  const keys = await cacheStorage.keys();
  const legacyKeys = keys.filter((key) => key.startsWith(LEGACY_CACHE_PREFIX));
  await Promise.all(legacyKeys.map((key) => cacheStorage.delete(key)));
  return legacyKeys;
}

export function reloadOnce(win: ServiceWorkerWindowLike, key: string): boolean {
  try {
    if (win.sessionStorage?.getItem(key)) return false;
    win.sessionStorage?.setItem(key, '1');
  } catch {
    // Session storage can be blocked; still attempt one recovery reload.
  }
  win.location?.reload();
  return true;
}

function runOnLoad(callback: () => void, win: ServiceWorkerWindowLike): void {
  if (win.document?.readyState === 'complete' || !win.addEventListener) {
    callback();
    return;
  }
  win.addEventListener('load', callback, { once: true });
}
