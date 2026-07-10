import { describe, expect, it, vi } from 'vitest';
import { installResumeRecovery, type ResumeDocumentTarget, type ResumeEventTarget } from './resumeRecovery';

class FakeTarget implements ResumeEventTarget {
  private listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event = new Event(type)) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

class FakeDocument extends FakeTarget implements ResumeDocumentTarget {
  hidden = false;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('installResumeRecovery', () => {
  it('coalesces visibility, lifecycle, and focus signals into one refresh per resume', async () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new FakeTarget();
    const rehydrate = vi.fn();
    const cleanup = installResumeRecovery({
      document: documentTarget,
      window: windowTarget,
      rehydrate,
      shouldRehydrate: () => true,
      now: () => 5_000
    });

    documentTarget.hidden = true;
    documentTarget.dispatch('visibilitychange');
    documentTarget.hidden = false;
    documentTarget.dispatch('visibilitychange');
    documentTarget.dispatch('resume');
    documentTarget.dispatch('resume');
    windowTarget.dispatch('focus');
    await flushPromises();

    expect(rehydrate).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('rehydrates a lifecycle resume even when visibility never changed', async () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new FakeTarget();
    const rehydrate = vi.fn();
    installResumeRecovery({
      document: documentTarget,
      window: windowTarget,
      rehydrate,
      shouldRehydrate: () => true,
      now: () => 10_000
    });

    documentTarget.dispatch('resume');
    await flushPromises();

    expect(rehydrate).toHaveBeenCalledTimes(1);
  });

  it('uses blur/focus and pagehide/pageshow as fallbacks without refreshing continuously', async () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new FakeTarget();
    const rehydrate = vi.fn();
    installResumeRecovery({
      document: documentTarget,
      window: windowTarget,
      rehydrate,
      shouldRehydrate: () => true
    });

    windowTarget.dispatch('focus');
    windowTarget.dispatch('blur');
    windowTarget.dispatch('focus');
    windowTarget.dispatch('focus');
    await flushPromises();
    expect(rehydrate).toHaveBeenCalledTimes(1);

    windowTarget.dispatch('pagehide');
    windowTarget.dispatch('pageshow');
    await flushPromises();
    expect(rehydrate).toHaveBeenCalledTimes(2);
  });

  it('stays idle outside live mode and unregisters every listener', async () => {
    const documentTarget = new FakeDocument();
    const windowTarget = new FakeTarget();
    const rehydrate = vi.fn();
    const cleanup = installResumeRecovery({
      document: documentTarget,
      window: windowTarget,
      rehydrate,
      shouldRehydrate: () => false
    });

    documentTarget.dispatch('freeze');
    documentTarget.dispatch('resume');
    windowTarget.dispatch('blur');
    windowTarget.dispatch('focus');
    await flushPromises();
    expect(rehydrate).not.toHaveBeenCalled();

    cleanup();
    expect(documentTarget.listenerCount()).toBe(0);
    expect(windowTarget.listenerCount()).toBe(0);
  });
});
