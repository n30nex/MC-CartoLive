import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_VISUAL_MAX_STARTS_PER_FRAME,
  LIVE_VISUAL_QUEUE_LIMIT,
  LiveVisualScheduler,
  type SchedulableLiveVisual
} from './liveVisualScheduler';

type TestVisual = SchedulableLiveVisual & { marker: number };

describe('LiveVisualScheduler', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true);
    delete window.__mcCartoLivePerf;
  });

  it('starts every distinct live visual exactly once without coalescing', () => {
    let now = 10_000;
    const starts: Array<{ id: string; pressure: string }> = [];
    const scheduler = new LiveVisualScheduler<TestVisual>({
      now: () => now,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      start: (visual, pressure) => {
        starts.push({ id: visual.id, pressure });
        return 'started';
      }
    });
    scheduler.enqueue(Array.from({ length: 100 }, (_, marker) => ({ id: `v-${marker}`, marker, receivedAt: now })));

    while (scheduler.size() > 0) {
      now += 16;
      scheduler.drainFrame();
    }

    expect(starts).toHaveLength(100);
    expect(new Set(starts.map((item) => item.id)).size).toBe(100);
  });

  it('drains up to eight per frame when the oldest visual reaches the latency target', () => {
    const starts: string[] = [];
    const scheduler = new LiveVisualScheduler<TestVisual>({
      now: () => 12_100,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      start: (visual) => {
        starts.push(visual.id);
        return 'started';
      }
    });
    scheduler.enqueue(Array.from({ length: 30 }, (_, marker) => ({ id: `v-${marker}`, marker, receivedAt: 10_000 })));
    scheduler.drainFrame();
    expect(starts).toHaveLength(LIVE_VISUAL_MAX_STARTS_PER_FRAME);
  });

  it('uses synchronous emergency minimal starts instead of dropping on overflow', () => {
    const starts: Array<{ id: string; pressure: string }> = [];
    const scheduler = new LiveVisualScheduler<TestVisual>({
      now: () => 20_000,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      start: (visual, pressure) => {
        starts.push({ id: visual.id, pressure });
        return 'started';
      }
    });
    const count = LIVE_VISUAL_QUEUE_LIMIT + 3;
    scheduler.enqueue(Array.from({ length: count }, (_, marker) => ({ id: `v-${marker}`, marker, receivedAt: 20_000 })));

    expect(starts).toEqual([
      { id: 'v-0', pressure: 'emergency' },
      { id: 'v-1', pressure: 'emergency' },
      { id: 'v-2', pressure: 'emergency' }
    ]);
    expect(scheduler.size()).toBe(LIVE_VISUAL_QUEUE_LIMIT);
    expect(window.__mcCartoLivePerf?.liveAnimationEmergencyStarts).toBe(3);
  });

  it('starts a 100-per-second minute burst losslessly without emergency pressure', () => {
    let now = 100_000;
    let enqueued = 0;
    const starts: string[] = [];
    const scheduler = new LiveVisualScheduler<TestVisual>({
      now: () => now,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      start: (visual) => {
        starts.push(visual.id);
        return 'started';
      }
    });
    for (let frame = 1; frame <= 3_750; frame += 1) {
      now = 100_000 + frame * 16;
      const target = Math.floor((frame * 16) / 10);
      const arrivals = Array.from({ length: target - enqueued }, (_, index) => {
        const marker = enqueued + index;
        return { id: `burst-${marker}`, marker, receivedAt: now };
      });
      enqueued = target;
      scheduler.enqueue(arrivals);
      scheduler.drainFrame();
    }
    while (scheduler.size() > 0) {
      now += 16;
      scheduler.drainFrame();
    }

    expect(enqueued).toBe(6_000);
    expect(starts).toHaveLength(6_000);
    expect(new Set(starts).size).toBe(6_000);
    expect(window.__mcCartoLivePerf?.liveAnimationEmergencyStarts).toBe(0);
  });

  it('keeps eligible visuals queued until the renderer becomes available', () => {
    let ready = false;
    const admitted: string[] = [];
    const scheduler = new LiveVisualScheduler<TestVisual>({
      now: () => 30_000,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      start: (visual) => {
        if (!ready) return 'retry';
        admitted.push(visual.id);
        return 'started';
      }
    });
    scheduler.enqueue([{ id: 'waiting', marker: 1, receivedAt: 30_000 }]);
    scheduler.drainFrame();

    expect(scheduler.size()).toBe(1);
    expect(admitted).toEqual([]);
    expect(window.__mcCartoLivePerf?.liveAnimationStarts).toBe(0);

    ready = true;
    scheduler.drainFrame();
    expect(scheduler.size()).toBe(0);
    expect(admitted).toEqual(['waiting']);
    expect(window.__mcCartoLivePerf?.liveAnimationStarts).toBe(1);
  });

  it('does not count intentionally ineligible visuals as animation starts', () => {
    const scheduler = new LiveVisualScheduler<TestVisual>({
      now: () => 40_000,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      start: () => 'ineligible'
    });
    scheduler.enqueue([{ id: 'invalid', marker: 1, receivedAt: 40_000 }]);
    scheduler.drainFrame();

    expect(scheduler.size()).toBe(0);
    expect(window.__mcCartoLivePerf?.liveAnimationStarts).toBe(0);
  });

  it('flags retry-at-capacity as an emergency without claiming an actual start', () => {
    const scheduler = new LiveVisualScheduler<TestVisual>({
      now: () => 50_000,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
      start: () => 'retry'
    });
    scheduler.enqueue(Array.from({ length: LIVE_VISUAL_QUEUE_LIMIT }, (_, marker) => ({
      id: `waiting-${marker}`,
      marker,
      receivedAt: 50_000
    })));
    scheduler.enqueue([{ id: 'overflow', marker: LIVE_VISUAL_QUEUE_LIMIT, receivedAt: 50_000 }]);

    // Preserve the eligible visual for readiness recovery, but make the
    // safety-limit breach release-gate visible instead of claiming success.
    expect(scheduler.size()).toBe(LIVE_VISUAL_QUEUE_LIMIT + 1);
    expect(window.__mcCartoLivePerf?.liveAnimationEmergencyStarts).toBe(1);
    expect(window.__mcCartoLivePerf?.liveAnimationStarts).toBe(0);
  });
});
