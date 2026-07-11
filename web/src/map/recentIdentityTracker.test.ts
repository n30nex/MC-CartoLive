import { describe, expect, it } from 'vitest';
import { MAX_ANIMATION_EVENT_AGE_MS } from './animationSafety';
import { RecentIdentityTracker, rememberFreshLiveIdentity } from './recentIdentityTracker';

describe('RecentIdentityTracker', () => {
  it('suppresses retained identities and allows them after the TTL', () => {
    const tracker = new RecentIdentityTracker(8, 100);

    expect(tracker.remember('packet', 0)).toBe(true);
    expect(tracker.remember('packet', 80)).toBe(false);
    expect(tracker.remember('packet', 181)).toBe(true);
  });

  it('refreshes duplicate age without growing the tracker', () => {
    const tracker = new RecentIdentityTracker(8, 100);

    tracker.remember('packet', 0);
    expect(tracker.remember('packet', 80)).toBe(false);
    expect(tracker.remember('packet', 150)).toBe(false);
    expect(tracker.size).toBe(1);
    expect(tracker.remember('packet', 251)).toBe(true);
  });

  it('evicts oldest inactive identities at the fixed capacity', () => {
    const tracker = new RecentIdentityTracker(3, 10_000);

    tracker.remember('a', 1);
    tracker.remember('b', 2);
    tracker.remember('c', 3);
    tracker.remember('d', 4);

    expect(tracker.size).toBe(3);
    expect(tracker.remember('a', 5)).toBe(true);
    expect(tracker.size).toBe(3);
  });

  it('prunes expired identities and clears on an explicit visual reset', () => {
    const tracker = new RecentIdentityTracker(8, 100);
    tracker.remember('a', 0);
    tracker.remember('b', 40);

    tracker.prune(101);
    expect(tracker.size).toBe(1);
    tracker.clear();
    expect(tracker.size).toBe(0);
  });

  it('does not requeue an old retained pulse after its identity TTL expires', () => {
    const tracker = new RecentIdentityTracker(8, 100);
    const receivedAt = 1_000;

    expect(rememberFreshLiveIdentity(tracker, 'retained-pulse', receivedAt, receivedAt, 0)).toBe(true);
    expect(rememberFreshLiveIdentity(
      tracker,
      'retained-pulse',
      receivedAt,
      receivedAt + MAX_ANIMATION_EVENT_AGE_MS + 1,
      101
    )).toBe(false);
    expect(rememberFreshLiveIdentity(
      tracker,
      'new-pulse',
      receivedAt + MAX_ANIMATION_EVENT_AGE_MS + 1,
      receivedAt + MAX_ANIMATION_EVENT_AGE_MS + 1,
      101
    )).toBe(true);
  });
});
