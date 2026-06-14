import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToasts } from './ToastProvider';

function ToastProbe() {
  const { showToast } = useToasts();
  return (
    <button type="button" onClick={() => showToast({ tone: 'success', title: 'Copied', message: 'Ready to share', durationMs: 1000 })}>
      Show
    </button>
  );
}

describe('ToastProvider', () => {
  let root: Root | null = null;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    host.remove();
    vi.useRealTimers();
  });

  it('queues visible toasts and auto-dismisses them', () => {
    act(() => {
      root?.render(
        <ToastProvider>
          <ToastProbe />
        </ToastProvider>
      );
    });

    act(() => {
      host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('.app-toast')?.textContent).toContain('Copied');
    expect(document.querySelector('.app-toast')?.textContent).toContain('Ready to share');

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(document.querySelector('.app-toast')).toBeNull();
  });
});
