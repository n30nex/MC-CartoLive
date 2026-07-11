const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 65_000;

export async function fetchWithRateLimitRetry(url, init, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const now = options.now ?? Date.now;
  const onRetry = options.onRetry ?? (() => undefined);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts must be a positive integer');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetchImpl(url, init);
    if (response.status !== 429 || attempt === maxAttempts - 1) return response;

    const retryAfterMs = boundedRetryAfterMs(response.headers?.get?.('retry-after'), attempt, now());
    await response.arrayBuffer?.().catch(() => undefined);
    onRetry({ attempt: attempt + 1, delayMs: retryAfterMs, response });
    await sleep(retryAfterMs);
  }
  throw new Error('bounded rate-limit retry loop exhausted unexpectedly');
}

export function boundedRetryAfterMs(value, attempt, nowMs = Date.now()) {
  const raw = String(value ?? '').trim();
  const seconds = Number(raw);
  let delayMs = raw && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Number.NaN;
  if (!Number.isFinite(delayMs) && raw) {
    const retryAt = Date.parse(raw);
    if (Number.isFinite(retryAt)) delayMs = Math.max(0, retryAt - nowMs);
  }
  if (!Number.isFinite(delayMs)) delayMs = 1000 * (2 ** attempt);
  return Math.max(250, Math.min(MAX_RETRY_DELAY_MS, Math.ceil(delayMs)));
}
