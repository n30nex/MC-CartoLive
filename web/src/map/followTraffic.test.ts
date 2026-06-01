import { describe, expect, it } from 'vitest';
import {
  FOLLOW_TRAFFIC_DURATION_MS,
  FOLLOW_TRAFFIC_IMMEDIATE_DURATION_MS,
  FOLLOW_TRAFFIC_MIN_INTERVAL_MS,
  followTrafficDecision
} from './followTraffic';

describe('follow traffic decisions', () => {
  it('uses slower camera timings for watchable live following', () => {
    expect(FOLLOW_TRAFFIC_DURATION_MS).toBeGreaterThanOrEqual(7_000);
    expect(FOLLOW_TRAFFIC_IMMEDIATE_DURATION_MS).toBeGreaterThanOrEqual(2_500);
    expect(FOLLOW_TRAFFIC_MIN_INTERVAL_MS).toBeGreaterThan(FOLLOW_TRAFFIC_DURATION_MS);
  });

  it('accepts immediate movement with a shorter startup duration', () => {
    const decision = followTrafficDecision({ lastAt: 1000, lastID: 'old' }, { id: 'next', now: 1200, immediate: true, mapMoving: true });
    expect(decision).toEqual({ shouldMove: true, durationMs: FOLLOW_TRAFFIC_IMMEDIATE_DURATION_MS, reason: 'immediate' });
  });

  it('ignores duplicate and too-frequent live targets', () => {
    expect(followTrafficDecision({ lastAt: 1000, lastID: 'same' }, { id: 'same', now: 20_000, immediate: false, mapMoving: false }).reason).toBe('duplicate');
    expect(followTrafficDecision({ lastAt: 1000, lastID: 'old' }, { id: 'new', now: 1000 + FOLLOW_TRAFFIC_MIN_INTERVAL_MS - 1, immediate: false, mapMoving: false }).reason).toBe('throttled');
  });

  it('waits while the previous camera movement is still active', () => {
    const decision = followTrafficDecision({ lastAt: 1000, lastID: 'old' }, { id: 'new', now: 1000 + FOLLOW_TRAFFIC_DURATION_MS, immediate: false, mapMoving: true });
    expect(decision).toEqual({ shouldMove: false, durationMs: FOLLOW_TRAFFIC_DURATION_MS, reason: 'camera_busy' });
  });

  it('accepts a fresh live target after the minimum interval', () => {
    const decision = followTrafficDecision({ lastAt: 1000, lastID: 'old' }, { id: 'new', now: 1000 + FOLLOW_TRAFFIC_MIN_INTERVAL_MS + 1, immediate: false, mapMoving: false });
    expect(decision).toEqual({ shouldMove: true, durationMs: FOLLOW_TRAFFIC_DURATION_MS, reason: 'accepted' });
  });
});
