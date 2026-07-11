import { shouldAnimateLiveEvent } from './animationSafety';

export class RecentIdentityTracker {
  private readonly entries = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number, ttlMs: number) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.ttlMs = Math.max(1, ttlMs);
  }

  /** Returns true once per retained identity window. */
  remember(key: string, now: number): boolean {
    this.prune(now);
    const seenAt = this.entries.get(key);
    if (seenAt !== undefined && now - seenAt <= this.ttlMs) {
      // Refresh insertion order so frequently repeated live identities remain
      // protected while inactive entries are the first capacity evictions.
      this.entries.delete(key);
      this.entries.set(key, now);
      return false;
    }

    this.entries.delete(key);
    this.entries.set(key, now);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return true;
  }

  prune(now: number): void {
    const cutoff = now - this.ttlMs;
    for (const [key, seenAt] of this.entries) {
      if (seenAt >= cutoff) break;
      this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Retained snapshots can keep an identity longer than the tracker TTL. Do not
 * let an expired tracker entry turn that old snapshot item into new motion.
 */
export function rememberFreshLiveIdentity(
  tracker: RecentIdentityTracker,
  key: string,
  eventAt: number,
  epochNow: number,
  monotonicNow: number
): boolean {
  if (!shouldAnimateLiveEvent(eventAt, epochNow, false)) return false;
  return tracker.remember(key, monotonicNow);
}
