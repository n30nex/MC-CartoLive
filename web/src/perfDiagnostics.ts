export interface PerfCounters {
  packetActiveComets: number;
  packetActiveCometIDs: string[];
  packetActiveObserverBursts: number;
  packetFrameMs: number;
  packetSkippedFrames: number;
  routeSourceUpdates: number;
  nodeSourceUpdates: number;
  otherSourceUpdates: number;
  skippedSourceUpdates: number;
  signatureSourceSkips: number;
  heatmapSourceUpdates: number;
  snapshotReplacements: number;
  snapshotSkips: number;
  routeReducerMs: number;
  livePendingQueueSize: number;
  visibilityPauses: number;
  geoJSONWorkerTransforms: number;
  geoJSONWorkerFallbacks: number;
  geoJSONWorkerErrors: number;
  netGraphWorkerTransforms: number;
  netGraphWorkerFallbacks: number;
  netGraphWorkerErrors: number;
  netGraphPrepMs: number;
  netGraphLayoutMs: number;
  netGraphLayoutTicks: number;
  netGraphDrawMs: number;
  netGraphRenderedNodes: number;
  netGraphRenderedEdges: number;
  netGraphHitCandidates: number;
}

const STORAGE_KEY = 'mc-cartolive-debug-perf';

declare global {
  interface Window {
    __mcCartoLivePerf?: PerfCounters;
  }
}

export function perfDiagnosticsEnabled(storage: Storage | undefined = safeStorage()): boolean {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) return true;
  try {
    return storage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPerfDiagnosticsEnabled(enabled: boolean, storage: Storage | undefined = safeStorage()): void {
  try {
    if (enabled) {
      storage?.setItem(STORAGE_KEY, '1');
    } else {
      storage?.removeItem(STORAGE_KEY);
    }
  } catch {
  }
}

export function ensurePerfDiagnostics(): PerfCounters | null {
  if (typeof window === 'undefined' || !perfDiagnosticsEnabled()) return null;
  const existing = window.__mcCartoLivePerf;
  if (existing) return existing;
  const counters: PerfCounters = {
    packetActiveComets: 0,
    packetActiveCometIDs: [],
    packetActiveObserverBursts: 0,
    packetFrameMs: 0,
    packetSkippedFrames: 0,
    routeSourceUpdates: 0,
    nodeSourceUpdates: 0,
    otherSourceUpdates: 0,
    skippedSourceUpdates: 0,
    signatureSourceSkips: 0,
    heatmapSourceUpdates: 0,
    snapshotReplacements: 0,
    snapshotSkips: 0,
    routeReducerMs: 0,
    livePendingQueueSize: 0,
    visibilityPauses: 0,
    geoJSONWorkerTransforms: 0,
    geoJSONWorkerFallbacks: 0,
    geoJSONWorkerErrors: 0,
    netGraphWorkerTransforms: 0,
    netGraphWorkerFallbacks: 0,
    netGraphWorkerErrors: 0,
    netGraphPrepMs: 0,
    netGraphLayoutMs: 0,
    netGraphLayoutTicks: 0,
    netGraphDrawMs: 0,
    netGraphRenderedNodes: 0,
    netGraphRenderedEdges: 0,
    netGraphHitCandidates: 0
  };
  window.__mcCartoLivePerf = counters;
  return counters;
}

export function perfDiagnosticsSnapshot(): PerfCounters | null {
  return typeof window === 'undefined' ? null : window.__mcCartoLivePerf ?? ensurePerfDiagnostics();
}

export function recordSourceUpdate(sourceID: string): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  if (sourceID.includes('route') && !sourceID.includes('payload')) {
    counters.routeSourceUpdates += 1;
  } else if (sourceID.includes('node')) {
    counters.nodeSourceUpdates += 1;
  } else if (sourceID.includes('heatmap')) {
    counters.heatmapSourceUpdates += 1;
  } else {
    counters.otherSourceUpdates += 1;
  }
}

export function recordSkippedSourceUpdate(): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.skippedSourceUpdates += 1;
}

export function recordSignatureSourceSkip(): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.signatureSourceSkips += 1;
}

export function recordSnapshotReplacement(skipped: boolean): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  if (skipped) counters.snapshotSkips += 1;
  else counters.snapshotReplacements += 1;
}

export function recordRouteReducerDuration(ms: number): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.routeReducerMs = Math.max(0, Math.round(ms * 10) / 10);
}

export function recordPacketFrame(activeComets: number, activeObserverBursts: number, frameMs: number, activeCometIDs: readonly string[] = []): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.packetActiveComets = activeComets;
  counters.packetActiveCometIDs = [...new Set(activeCometIDs.filter(Boolean))].slice(-240);
  counters.packetActiveObserverBursts = activeObserverBursts;
  counters.packetFrameMs = Math.max(0, Math.round(frameMs * 10) / 10);
}

export function recordPacketSkippedFrame(): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.packetSkippedFrames += 1;
}

export function recordLivePendingQueueSize(size: number): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.livePendingQueueSize = Math.max(0, Math.floor(size));
}

export function recordVisibilityPause(): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.visibilityPauses += 1;
}

export function recordGeoJSONWorkerTransform(): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.geoJSONWorkerTransforms += 1;
}

export function recordGeoJSONWorkerFallback(): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.geoJSONWorkerFallbacks += 1;
}

export function recordGeoJSONWorkerError(): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.geoJSONWorkerErrors += 1;
}

export function recordNetGraphWorkerTransform(workerUsed: boolean, prepMs: number, layoutMs: number, layoutTicks: number): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  if (workerUsed) counters.netGraphWorkerTransforms += 1;
  else counters.netGraphWorkerFallbacks += 1;
  counters.netGraphPrepMs = roundedMs(prepMs);
  counters.netGraphLayoutMs = roundedMs(layoutMs);
  counters.netGraphLayoutTicks = Math.max(0, Math.floor(layoutTicks));
}

export function recordNetGraphWorkerError(): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.netGraphWorkerErrors += 1;
}

export function recordNetGraphDraw(frameMs: number, renderedNodes: number, renderedEdges: number): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.netGraphDrawMs = roundedMs(frameMs);
  counters.netGraphRenderedNodes = Math.max(0, Math.floor(renderedNodes));
  counters.netGraphRenderedEdges = Math.max(0, Math.floor(renderedEdges));
}

export function recordNetGraphHitCandidates(candidates: number): void {
  const counters = ensurePerfDiagnostics();
  if (!counters) return;
  counters.netGraphHitCandidates = Math.max(0, Math.floor(candidates));
}

function roundedMs(ms: number): number {
  return Math.max(0, Math.round(ms * 10) / 10);
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
