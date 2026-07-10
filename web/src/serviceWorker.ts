import { appVersion, gitSha } from './buildInfo';

const LEGACY_CACHE_PREFIX = 'mc-cartolive';
const SW_CLEANUP_RELOAD_KEY = `mc-cartolive-sw-cleanup-reload-${appVersion}`;
const SW_ACTIVATION_RELOAD_KEY = `mc-cartolive-sw-activation-${appVersion}-${gitSha.slice(0, 12) || 'dev'}`;
export const SERVICE_WORKER_UPDATE_EVENT = 'mc-cartolive:service-worker-update';

type CacheStorageLike = Pick<CacheStorage, 'keys' | 'delete'>;
type WorkerLike = Pick<ServiceWorker, 'state' | 'postMessage' | 'addEventListener'>;
type ServiceWorkerRegistrationLike = Pick<ServiceWorkerRegistration, 'unregister'> & Partial<Pick<ServiceWorkerRegistration, 'installing' | 'waiting' | 'addEventListener'>>;
type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, 'controller' | 'getRegistrations'> & {
  register?: (scriptURL: string, options?: RegistrationOptions) => Promise<ServiceWorkerRegistrationLike>;
  addEventListener?: (type: 'controllerchange', listener: () => void) => void;
};

export interface ServiceWorkerWindowLike {
  addEventListener?: Window['addEventListener'];
  caches?: CacheStorageLike;
  document?: Pick<Document, 'readyState'>;
  location?: Pick<Location, 'reload'>;
  navigator?: Navigator & { serviceWorker?: ServiceWorkerContainerLike };
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>;
  dispatchEvent?: Window['dispatchEvent'];
  setTimeout?: typeof window.setTimeout;
}

let pendingWaitingWorker: WorkerLike | null = null;
let activationRequested = false;
let controllerListenerTarget: ServiceWorkerContainerLike | null = null;

export function serviceWorkerEnabled(env: Record<string, unknown> = import.meta.env): boolean {
  return env.VITE_ENABLE_SERVICE_WORKER !== 'false';
}

export function configureServiceWorker(win: ServiceWorkerWindowLike = window): void {
  if (serviceWorkerEnabled()) {
    runOnLoad(() => {
      const container = win.navigator?.serviceWorker;
      const register = container?.register;
      if (!container || !register) return;
      bindExplicitActivationReload(container, win);
      void register.call(container, serviceWorkerScriptURL(), { updateViaCache: 'none' })
        .then((registration) => watchForServiceWorkerUpdate(registration, win))
        .catch(() => undefined);
    }, win);
    return;
  }
  runOnLoad(() => {
    void cleanupLegacyServiceWorkers(win).catch(() => undefined);
  }, win);
}

export function serviceWorkerScriptURL(version = appVersion, sha = gitSha): string {
  const params = new URLSearchParams({ version: version || 'dev', sha: (sha || 'dev').slice(0, 12) });
  return `/sw.js?${params.toString()}`;
}

export function serviceWorkerMayCacheURL(urlValue: string, origin: string): boolean {
  try {
    return new URL(urlValue, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function activateWaitingServiceWorker(registration?: ServiceWorkerRegistrationLike, win: ServiceWorkerWindowLike = window): boolean {
  const worker = registration?.waiting as WorkerLike | undefined ?? pendingWaitingWorker ?? undefined;
  if (!worker) return false;
  pendingWaitingWorker = worker;
  activationRequested = true;
  try {
    worker.postMessage({ type: 'ACTIVATE_UPDATE' });
  } catch {
    activationRequested = false;
    pendingWaitingWorker = null;
    return false;
  }
  const schedule = win.setTimeout ?? (typeof window !== 'undefined' ? window.setTimeout.bind(window) : undefined);
  schedule?.(() => {
    if (!activationRequested) return;
    activationRequested = false;
    pendingWaitingWorker = null;
    reloadOnce(win, SW_ACTIVATION_RELOAD_KEY);
  }, 1_000);
  return true;
}

export function waitingServiceWorkerUpdateAvailable(): boolean {
  return pendingWaitingWorker !== null;
}

function watchForServiceWorkerUpdate(registration: ServiceWorkerRegistrationLike, win: ServiceWorkerWindowLike): void {
  if (registration.waiting && win.navigator?.serviceWorker?.controller) notifyUpdateReady(registration.waiting as WorkerLike, win);
  registration.addEventListener?.('updatefound', () => {
    const worker = registration.installing as WorkerLike | undefined;
    worker?.addEventListener('statechange', () => {
      if (worker.state !== 'installed' || !win.navigator?.serviceWorker?.controller) return;
      notifyUpdateReady((registration.waiting as WorkerLike | undefined) ?? worker, win);
    });
  });
}

function notifyUpdateReady(worker: WorkerLike, win: ServiceWorkerWindowLike): void {
  pendingWaitingWorker = worker;
  win.dispatchEvent?.(new CustomEvent(SERVICE_WORKER_UPDATE_EVENT));
}

function bindExplicitActivationReload(container: ServiceWorkerContainerLike, win: ServiceWorkerWindowLike): void {
  if (controllerListenerTarget === container) return;
  controllerListenerTarget = container;
  container.addEventListener?.('controllerchange', () => {
    if (!activationRequested) return;
    activationRequested = false;
    pendingWaitingWorker = null;
    reloadOnce(win, SW_ACTIVATION_RELOAD_KEY);
  });
}

export async function cleanupLegacyServiceWorkers(win: ServiceWorkerWindowLike = window): Promise<void> {
  const serviceWorker = win.navigator?.serviceWorker;
  if (serviceWorker?.getRegistrations) {
    const registrations = await serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  await clearLegacyCaches(win);
  if (serviceWorker?.controller) reloadOnce(win, SW_CLEANUP_RELOAD_KEY);
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
