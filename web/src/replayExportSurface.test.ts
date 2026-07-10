import { describe, expect, it, vi } from 'vitest';
import { onceReplayExportCleanup } from './replayExportSurface';

describe('temporary replay export surfaces', () => {
  it('removes temporary maps, canvases, and their listeners exactly once', () => {
    const removeMapAndListeners = vi.fn();
    const removeContainer = vi.fn();
    const cleanup = onceReplayExportCleanup(() => {
      removeMapAndListeners();
      removeContainer();
    });
    cleanup();
    cleanup();
    expect(removeMapAndListeners).toHaveBeenCalledTimes(1);
    expect(removeContainer).toHaveBeenCalledTimes(1);
  });
});
