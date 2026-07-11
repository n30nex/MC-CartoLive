export interface RouteExportSurface {
  canvases: readonly HTMLCanvasElement[];
  cleanup: () => void;
}

export function onceRouteExportCleanup(cleanup: () => void): () => void {
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    cleanup();
  };
}
