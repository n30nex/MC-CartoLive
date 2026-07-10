import { afterEach, describe, expect, it, vi } from 'vitest';

describe('route WebM export', () => {
  const originalRecorder = globalThis.MediaRecorder;
  const originalCaptureStream = HTMLCanvasElement.prototype.captureStream;

  afterEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, writable: true, value: originalRecorder });
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', { configurable: true, writable: true, value: originalCaptureStream });
  });

  it('reports an explicit fallback when MediaRecorder is unavailable', async () => {
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, writable: true, value: undefined });
    const { routeWebMSupport } = await import('./routeWebmExport');
    expect(routeWebMSupport()).toEqual({ supported: false, reason: 'MediaRecorder is unavailable in this browser.' });
  });

  it('selects the first browser-supported WebM codec', async () => {
    const { preferredWebMMimeType } = await import('./routeWebmExport');
    const recorder = { isTypeSupported: vi.fn((type: string) => type.includes('vp8')) } as unknown as Pick<typeof MediaRecorder, 'isTypeSupported'>;
    expect(preferredWebMMimeType(recorder)).toBe('video/webm;codecs=vp8');
  });

  it('reports missing canvas capture without attempting a recording', async () => {
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, writable: true, value: class { static isTypeSupported() { return true; } } });
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', { configurable: true, writable: true, value: undefined });
    const { routeWebMSupport } = await import('./routeWebmExport');
    expect(routeWebMSupport().reason).toContain('Canvas recording');
  });

  it('composites the preserved base map and live RF overlay in order', async () => {
    const { drawCanvasLayers } = await import('./routeWebmExport');
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const context = { fillStyle: '', fillRect, drawImage } as unknown as CanvasRenderingContext2D;
    const base = document.createElement('canvas');
    const rfOverlay = document.createElement('canvas');
    drawCanvasLayers(context, [base, rfOverlay], 960, 540);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 960, 540);
    expect(drawImage.mock.calls.map((call) => call[0])).toEqual([base, rfOverlay]);
  });
});
