import type { PublicRouteSegment } from './types';

export interface ReplayExportSurface {
  canvases: readonly HTMLCanvasElement[];
  cleanup: () => void;
}

export interface ReplayExportSurfaceOptions {
  width: number;
  height: number;
  segments: PublicRouteSegment[];
}

export type ReplayExportSurfaceProvider = (options: ReplayExportSurfaceOptions) => Promise<ReplayExportSurface>;

export function onceReplayExportCleanup(cleanup: () => void): () => void {
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    cleanup();
  };
}
