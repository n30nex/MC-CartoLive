import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensurePerfDiagnostics,
  perfDiagnosticsSnapshot,
  recordLivePendingQueueSize,
  recordNetGraphDraw,
  recordNetGraphHitCandidates,
  recordNetGraphWorkerError,
  recordNetGraphWorkerTransform,
  recordPacketFrame,
  recordPacketSkippedFrame,
  recordRouteReducerDuration,
  recordSourceUpdate,
  recordSkippedSourceUpdate,
  recordSnapshotReplacement,
  recordVcrReplayQueueSize,
  recordVisibilityPause,
  setPerfDiagnosticsEnabled
} from './perfDiagnostics';

describe('perf diagnostics', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true);
    delete window.__mcCartoLivePerf;
  });

  it('exposes local counters without sending telemetry', () => {
    const counters = ensurePerfDiagnostics();
    expect(counters).toBeTruthy();

    recordSourceUpdate('routes');
    recordSourceUpdate('nodes');
    recordSourceUpdate('activity-heatmap');
    recordSourceUpdate('cluster-activity');
    recordSkippedSourceUpdate();
    recordSnapshotReplacement(false);
    recordSnapshotReplacement(true);
    recordRouteReducerDuration(4.56);
    recordPacketFrame(3, 2, 12.34);
    recordPacketSkippedFrame();
    recordLivePendingQueueSize(87.1);
    recordVcrReplayQueueSize(42.8);
    recordVisibilityPause();
    recordNetGraphWorkerTransform(true, 12.34, 5.67, 16);
    recordNetGraphWorkerTransform(false, 3.21, 0, 0);
    recordNetGraphWorkerError();
    recordNetGraphDraw(9.87, 120.4, 80.9);
    recordNetGraphHitCandidates(14.7);

    expect(window.__mcCartoLivePerf).toMatchObject({
      routeSourceUpdates: 1,
      nodeSourceUpdates: 1,
      heatmapSourceUpdates: 1,
      otherSourceUpdates: 1,
      skippedSourceUpdates: 1,
      snapshotReplacements: 1,
      snapshotSkips: 1,
      routeReducerMs: 4.6,
      packetActiveComets: 3,
      packetActiveObserverBursts: 2,
      packetFrameMs: 12.3,
      packetSkippedFrames: 1,
      livePendingQueueSize: 87,
      vcrReplayQueueSize: 42,
      visibilityPauses: 1,
      netGraphWorkerTransforms: 1,
      netGraphWorkerFallbacks: 1,
      netGraphWorkerErrors: 1,
      netGraphPrepMs: 3.2,
      netGraphLayoutMs: 0,
      netGraphLayoutTicks: 0,
      netGraphDrawMs: 9.9,
      netGraphRenderedNodes: 120,
      netGraphRenderedEdges: 80,
      netGraphHitCandidates: 14
    });
  });

  it('can be enabled by the in-app perf tab in production mode', () => {
    vi.stubEnv('DEV', false);
    delete window.__mcCartoLivePerf;
    localStorage.clear();

    expect(ensurePerfDiagnostics()).toBeNull();
    setPerfDiagnosticsEnabled(true);
    expect(perfDiagnosticsSnapshot()).toMatchObject({
      packetActiveComets: 0,
      routeSourceUpdates: 0
    });
  });
});
