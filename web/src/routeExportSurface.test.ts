import { describe, expect, it, vi } from 'vitest';
import { onceRouteExportCleanup } from './routeExportSurface';

describe('temporary route export surfaces', () => {
  it('removes temporary maps, canvases, and their listeners exactly once', () => {
    const removeMapAndListeners = vi.fn();
    const removeContainer = vi.fn();
    const cleanup = onceRouteExportCleanup(() => {
      removeMapAndListeners();
      removeContainer();
    });
    cleanup();
    cleanup();
    expect(removeMapAndListeners).toHaveBeenCalledTimes(1);
    expect(removeContainer).toHaveBeenCalledTimes(1);
  });
});
