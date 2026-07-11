#!/usr/bin/env node
import assert from 'node:assert/strict';
import { boundedRetryAfterMs, fetchWithRateLimitRetry } from './public-privacy-retry.mjs';

const fixedNow = Date.parse('2026-07-11T19:00:00Z');
assert.equal(boundedRetryAfterMs('60', 0, fixedNow), 60_000);
assert.equal(boundedRetryAfterMs('Sat, 11 Jul 2026 19:00:04 GMT', 0, fixedNow), 4_000);
assert.equal(boundedRetryAfterMs('', 1, fixedNow), 2_000);
assert.equal(boundedRetryAfterMs('999', 0, fixedNow), 65_000);

const responses = [mockResponse(429, '60'), mockResponse(200)];
const delays = [];
const retries = [];
const response = await fetchWithRateLimitRetry('https://example.test/public', {}, {
  fetchImpl: async () => responses.shift(),
  sleep: async (delayMs) => delays.push(delayMs),
  onRetry: (event) => retries.push(event)
});
assert.equal(response.status, 200);
assert.deepEqual(delays, [60_000]);
assert.equal(retries.length, 1);
assert.equal(retries[0].attempt, 1);

let calls = 0;
const exhausted = await fetchWithRateLimitRetry('https://example.test/public', {}, {
  fetchImpl: async () => { calls += 1; return mockResponse(429, '0'); },
  sleep: async () => undefined,
  maxAttempts: 2
});
assert.equal(exhausted.status, 429);
assert.equal(calls, 2);

console.log('public privacy retry contract ok');

function mockResponse(status, retryAfter = '') {
  return {
    status,
    headers: { get: (name) => name.toLowerCase() === 'retry-after' ? retryAfter : null },
    arrayBuffer: async () => new ArrayBuffer(0)
  };
}
