import { recordLiveAnimationEmergencyActivation, recordLiveAnimationStart, recordLiveVisualQueue, type LiveAnimationPressure } from '../perfDiagnostics';

export const LIVE_VISUAL_QUEUE_LIMIT = 1_024;
export const LIVE_VISUAL_MAX_STARTS_PER_FRAME = 8;
export const LIVE_VISUAL_DEGRADED_ACTIVE = 48;
export const LIVE_VISUAL_MINIMAL_ACTIVE = 120;

export interface SchedulableLiveVisual {
  id: string;
  receivedAt: number;
}

export type LiveVisualStartResult = 'started' | 'retry' | 'ineligible';

interface SchedulerOptions<T extends SchedulableLiveVisual> {
  start: (visual: T, pressure: LiveAnimationPressure) => LiveVisualStartResult;
  activeCount?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
}

/**
 * One scheduler owns all connected-live map motion. It never coalesces visual
 * identities. When its safety queue fills it starts the oldest item in minimal
 * emergency mode, making overload visible in diagnostics without losing it.
 */
export class LiveVisualScheduler<T extends SchedulableLiveVisual> {
  private queue: T[] = [];
  private frameHandle = 0;
  private recentStarts: number[] = [];
  private readonly start: SchedulerOptions<T>['start'];
  private readonly activeCount: () => number;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly now: () => number;

  constructor(options: SchedulerOptions<T>) {
    this.start = options.start;
    this.activeCount = options.activeCount ?? (() => 0);
    this.requestFrame = options.requestFrame ?? ((callback) => window.requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
    this.now = options.now ?? Date.now;
  }

  enqueue(visuals: readonly T[]): void {
    for (const visual of visuals) {
      if (this.queue.length >= LIVE_VISUAL_QUEUE_LIMIT) {
        recordLiveAnimationEmergencyActivation();
        const oldest = this.queue.shift();
        if (oldest) {
          const result = this.startVisual(oldest, 'emergency');
          if (result === 'retry') this.queue.unshift(oldest);
        }
      }
      this.queue.push(visual);
    }
    this.recordQueue();
    this.schedule();
  }

  clear(): void {
    this.queue = [];
    this.recentStarts = [];
    if (this.frameHandle !== 0) this.cancelFrame(this.frameHandle);
    this.frameHandle = 0;
    recordLiveVisualQueue(0, 0);
  }

  size(): number {
    return this.queue.length;
  }

  /** Exposed for deterministic tests; browser callers use requestAnimationFrame. */
  drainFrame(): void {
    this.frameHandle = 0;
    if (this.queue.length === 0) {
      this.recordQueue();
      return;
    }
    const starts = Math.min(this.queue.length, LIVE_VISUAL_MAX_STARTS_PER_FRAME);
    for (let index = 0; index < starts; index += 1) {
      const visual = this.queue.shift();
      if (!visual) break;
      const result = this.startVisual(visual, this.pressure());
      if (result === 'retry') {
        this.queue.unshift(visual);
        break;
      }
    }
    this.recordQueue();
    this.schedule();
  }

  private schedule(): void {
    if (this.frameHandle !== 0 || this.queue.length === 0) return;
    this.frameHandle = this.requestFrame(() => this.drainFrame());
  }

  private pressure(): LiveAnimationPressure {
    const now = this.now();
    this.recentStarts = this.recentStarts.filter((startedAt) => now - startedAt <= 2_100);
    const active = Math.max(this.activeCount(), this.recentStarts.length);
    if (active > LIVE_VISUAL_MINIMAL_ACTIVE) return 'minimal';
    if (active > LIVE_VISUAL_DEGRADED_ACTIVE) return 'degraded';
    return 'normal';
  }

  private startVisual(visual: T, pressure: LiveAnimationPressure): LiveVisualStartResult {
    const now = this.now();
    const result = this.start(visual, pressure);
    if (result !== 'started') return result;
    this.recentStarts.push(now);
    recordLiveAnimationStart(visual.receivedAt, pressure, now);
    return result;
  }

  private recordQueue(): void {
    const now = this.now();
    const oldestAge = this.queue.length > 0 ? Math.max(0, now - (this.queue[0]?.receivedAt ?? now)) : 0;
    recordLiveVisualQueue(this.queue.length, oldestAge);
  }
}
