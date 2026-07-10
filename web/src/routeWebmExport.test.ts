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
});
