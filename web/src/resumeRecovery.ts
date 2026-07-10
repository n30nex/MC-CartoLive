type ResumeListener = (event: Event) => void;

export interface ResumeEventTarget {
  addEventListener(type: string, listener: ResumeListener): void;
  removeEventListener(type: string, listener: ResumeListener): void;
}

export interface ResumeDocumentTarget extends ResumeEventTarget {
  hidden: boolean;
}

export interface ResumeRecoveryOptions {
  document: ResumeDocumentTarget;
  window: ResumeEventTarget;
  rehydrate: () => void | Promise<void>;
  shouldRehydrate: () => boolean;
  onSuspend?: () => void;
  now?: () => number;
  forceDedupeMs?: number;
}

/**
 * Page Lifecycle `resume` is not paired with visibilitychange in every browser.
 * Coalesce all lifecycle/focus signals into one refresh for each suspend cycle.
 */
export function installResumeRecovery(options: ResumeRecoveryOptions): () => void {
  const now = options.now ?? Date.now;
  const forceDedupeMs = Math.max(0, options.forceDedupeMs ?? 1_000);
  let disposed = false;
  let suspended = options.document.hidden;
  let cycle = suspended ? 1 : 0;
  let startedCycle = 0;
  let queuedCycle = 0;
  let inFlight = false;
  let lastResumeAt = Number.NEGATIVE_INFINITY;

  const start = (targetCycle: number) => {
    if (disposed || targetCycle <= startedCycle) return;
    if (inFlight) {
      queuedCycle = Math.max(queuedCycle, targetCycle);
      return;
    }
    startedCycle = targetCycle;
    inFlight = true;
    void Promise.resolve()
      .then(options.rehydrate)
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        if (disposed || options.document.hidden || !options.shouldRehydrate()) return;
        if (queuedCycle > startedCycle) {
          const nextCycle = queuedCycle;
          queuedCycle = 0;
          start(nextCycle);
        }
      });
  };

  const markSuspended = () => {
    if (!suspended) {
      cycle += 1;
      options.onSuspend?.();
    }
    suspended = true;
  };

  const resume = (force = false) => {
    if (disposed || options.document.hidden || !options.shouldRehydrate()) return;
    const resumedAt = now();
    if (force && !suspended) {
      if (resumedAt - lastResumeAt < forceDedupeMs) return;
      cycle += 1;
    } else if (!suspended) {
      return;
    }
    lastResumeAt = resumedAt;
    suspended = false;
    start(cycle);
  };

  const handleVisibility = () => {
    if (options.document.hidden) markSuspended();
    else resume();
  };
  const handleFreeze = () => markSuspended();
  const handleResume = () => resume(true);
  const handlePageHide = () => markSuspended();
  const handlePageShow: ResumeListener = (event) => resume((event as PageTransitionEvent).persisted === true);
  const handleBlur = () => markSuspended();
  const handleFocus = () => resume();

  options.document.addEventListener('visibilitychange', handleVisibility);
  options.document.addEventListener('freeze', handleFreeze);
  options.document.addEventListener('resume', handleResume);
  options.window.addEventListener('pagehide', handlePageHide);
  options.window.addEventListener('pageshow', handlePageShow);
  options.window.addEventListener('blur', handleBlur);
  options.window.addEventListener('focus', handleFocus);

  return () => {
    disposed = true;
    options.document.removeEventListener('visibilitychange', handleVisibility);
    options.document.removeEventListener('freeze', handleFreeze);
    options.document.removeEventListener('resume', handleResume);
    options.window.removeEventListener('pagehide', handlePageHide);
    options.window.removeEventListener('pageshow', handlePageShow);
    options.window.removeEventListener('blur', handleBlur);
    options.window.removeEventListener('focus', handleFocus);
  };
}
