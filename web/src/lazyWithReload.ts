import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { appVersion } from './buildInfo';
import { clearLegacyCaches, reloadOnce, type ServiceWorkerWindowLike } from './serviceWorker';

export function lazyWithReload<T extends ComponentType<any>>(importer: () => Promise<{ default: T }>, name: string): LazyExoticComponent<T> {
  return lazy(() => loadLazyModuleWithRetry(importer, name));
}

export async function loadLazyModuleWithRetry<T>(
  importer: () => Promise<T>,
  name: string,
  win: ServiceWorkerWindowLike = window
): Promise<T> {
  try {
    return await importer();
  } catch (error) {
    const key = `mc-cartolive-lazy-reload-${name}-${appVersion}`;
    if (!win.sessionStorage?.getItem(key)) {
      try {
        await clearLegacyCaches(win);
      } catch {
        // Cache cleanup is best-effort; reload-once is the recovery mechanism.
      }
      reloadOnce(win, key);
    }
    throw error;
  }
}
