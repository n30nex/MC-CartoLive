import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensurePerfDiagnostics,
  perfDiagnosticsSnapshot,
  recordLivePendingQueueSize,
  recordLiveAnimationStart,
  recordLiveAnimationEmergencyActivation,
  recordLiveStateApplied,
  recordLiveVisualQueue,
  recordLongTask,
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
    recordPacketFrame(3, 2, 12.34, ['pulse-a', 'pulse-b', 'pulse-a']);
    recordPacketSkippedFrame();
    recordLivePendingQueueSize(87.1);
    recordLiveStateApplied([{ receivedAt: 9_900 }, { receivedAt: 9_950 }], 10_000);
    recordLiveVisualQueue(12, 345.67);
    recordLiveAnimationStart(9_800, 'degraded', 10_000);
    recordLiveAnimationEmergencyActivation();
    recordLiveAnimationStart(9_900, 'emergency', 10_000);
    recordLongTask(72.34);
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
      packetActiveCometIDs: ['pulse-a', 'pulse-b'],
      packetActiveObserverBursts: 2,
      packetFrameMs: 12.3,
      packetSkippedFrames: 1,
      livePendingQueueSize: 87,
      liveStateLatencyP50Ms: 50,
      liveStateLatencyP95Ms: 100,
      liveStateLatencyMaxMs: 100,
      liveVisualQueueDepth: 12,
      liveVisualQueueOldestAgeMs: 345.7,
      liveAnimationStarts: 2,
      liveAnimationDegradedStarts: 1,
      liveAnimationEmergencyStarts: 1,
      liveAnimationLatencyP95Ms: 200,
      longTasks: 1,
      longestTaskMs: 72.3,
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

  it('ignores buffered long-task entries from before an explicit measurement window', () => {
    const counters = ensurePerfDiagnostics();
    expect(counters).toBeTruthy();
    counters!.longTaskWindowStartMs = 500;

    recordLongTask(90, 499);
    recordLongTask(70, 500);

    expect(counters).toMatchObject({ longTasks: 1, longestTaskMs: 70 });
  });
});
