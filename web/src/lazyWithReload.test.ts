import { describe, expect, it, vi } from 'vitest';
import { loadLazyModuleWithRetry } from './lazyWithReload';
import type { ServiceWorkerWindowLike } from './serviceWorker';

describe('lazy import reload recovery', () => {
  it('clears old caches and reloads once after a lazy import failure', async () => {
    const win = fakeWindow();
    const failure = new Error('Failed to fetch dynamically imported module');

    await expect(loadLazyModuleWithRetry(async () => {
      throw failure;
    }, 'PacketsPanel', win)).rejects.toThrow(failure);

    expect(win.caches?.delete).toHaveBeenCalledWith('mc-cartolive-v1');
    expect(win.sessionStorage?.setItem).toHaveBeenCalledTimes(1);
    expect(win.location?.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload repeatedly for the same lazy panel and version', async () => {
    const win = fakeWindow('1');

    await expect(loadLazyModuleWithRetry(async () => {
      throw new Error('Loading chunk failed');
    }, 'ChatPanel', win)).rejects.toThrow('Loading chunk failed');

    expect(win.location?.reload).not.toHaveBeenCalled();
  });
});

function fakeWindow(existingReloadMarker: string | null = null): ServiceWorkerWindowLike {
  return {
    caches: {
      keys: vi.fn(async () => ['mc-cartolive-v1']),
      delete: vi.fn(async () => true)
    },
    location: { reload: vi.fn() },
    sessionStorage: {
      getItem: vi.fn(() => existingReloadMarker),
      setItem: vi.fn()
    }
  } as unknown as ServiceWorkerWindowLike;
}
