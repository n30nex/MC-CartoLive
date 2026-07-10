export const ROUTE_WEBM_MAX_WIDTH = 1280;
export const ROUTE_WEBM_MAX_HEIGHT = 720;
export const ROUTE_WEBM_MAX_DURATION_MS = 30_000;

export interface RouteWebMSupport {
  supported: boolean;
  mimeType?: string;
  reason?: string;
}

export interface RouteWebMOptions {
  durationMs: number;
  frameRate?: number;
  onStarted?: () => void;
  onProgress?: (progress: number) => void;
}

export function routeWebMSupport(canvas?: HTMLCanvasElement | null): RouteWebMSupport {
  if (typeof MediaRecorder === 'undefined') return { supported: false, reason: 'MediaRecorder is unavailable in this browser.' };
  if (typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    return { supported: false, reason: 'Canvas recording is unavailable in this browser.' };
  }
  if (canvas && (canvas.width <= 0 || canvas.height <= 0)) return { supported: false, reason: 'The map canvas is not ready.' };
  const mimeType = preferredWebMMimeType(MediaRecorder);
  if (!mimeType) return { supported: false, reason: 'This browser has no WebM recorder.' };
  return { supported: true, mimeType };
}

export function preferredWebMMimeType(recorder: Pick<typeof MediaRecorder, 'isTypeSupported'>): string | undefined {
  for (const mimeType of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (typeof recorder.isTypeSupported !== 'function' || recorder.isTypeSupported(mimeType)) return mimeType;
  }
  return undefined;
}

export async function recordMapCanvasWebM(sourceCanvas: HTMLCanvasElement, options: RouteWebMOptions): Promise<Blob> {
  const support = routeWebMSupport(sourceCanvas);
  if (!support.supported || !support.mimeType) throw new Error(support.reason ?? 'WebM recording is unavailable.');
  const durationMs = Math.max(1_000, Math.min(ROUTE_WEBM_MAX_DURATION_MS, Math.round(options.durationMs)));
  const frameRate = Math.max(12, Math.min(30, Math.round(options.frameRate ?? 30)));
  const scale = Math.min(1, ROUTE_WEBM_MAX_WIDTH / sourceCanvas.width, ROUTE_WEBM_MAX_HEIGHT / sourceCanvas.height);
  const output = document.createElement('canvas');
  output.width = Math.max(2, Math.round(sourceCanvas.width * scale));
  output.height = Math.max(2, Math.round(sourceCanvas.height * scale));
  const context = output.getContext('2d', { alpha: false });
  if (!context) throw new Error('The browser could not create an export canvas.');

  let drawFrame = 0;
  try {
    context.drawImage(sourceCanvas, 0, 0, output.width, output.height);
  } catch (error) {
    throw mapCanvasRecordingError(error);
  }

  const stream = output.captureStream(frameRate);
  const recorder = new MediaRecorder(stream, { mimeType: support.mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: BlobPart[] = [];
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    let stopTimer = 0;
    let progressTimer = 0;
    const startedAt = performance.now();
    const cleanup = () => {
      window.clearTimeout(stopTimer);
      window.clearInterval(progressTimer);
      window.cancelAnimationFrame(drawFrame);
      for (const track of stream.getTracks()) track.stop();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(mapCanvasRecordingError(error));
    };
    const draw = () => {
      try {
        context.drawImage(sourceCanvas, 0, 0, output.width, output.height);
      } catch (error) {
        fail(error);
        return;
      }
      drawFrame = window.requestAnimationFrame(draw);
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = (event) => fail((event as Event & { error?: unknown }).error ?? new Error('WebM recorder error.'));
    recorder.onstop = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (chunks.length === 0) {
        reject(new Error('The browser produced an empty WebM recording.'));
        return;
      }
      resolve(new Blob(chunks, { type: support.mimeType }));
    };
    try {
      recorder.start(500);
      drawFrame = window.requestAnimationFrame(draw);
      options.onStarted?.();
      progressTimer = window.setInterval(() => options.onProgress?.(Math.min(1, (performance.now() - startedAt) / durationMs)), 250);
      stopTimer = window.setTimeout(() => {
        options.onProgress?.(1);
        if (recorder.state !== 'inactive') recorder.stop();
      }, durationMs);
    } catch (error) {
      fail(error);
    }
  });
}

export function downloadRouteWebM(packetID: string, blob: Blob): void {
  const safeID = packetID.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'route';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mc-cartolive-${safeID}.webm`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function mapCanvasRecordingError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'SecurityError') {
    return new Error('WebM export was blocked because the active map tiles do not permit canvas recording. Try the Classic map style or export a GIF.');
  }
  return error instanceof Error ? error : new Error('WebM export failed.');
}
