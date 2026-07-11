#!/usr/bin/env node
import assert from 'node:assert/strict';
import { probeCurrentPublicTopology } from './browser-smoke-topology.mjs';

const calls = [];
const advancing = await probeCurrentPublicTopology('http://fixture.test/', async (url) => {
  const path = new URL(url).pathname;
  calls.push(path);
  if (path.endsWith('/bootstrap')) return jsonResponse({ latestSeq: 100 });
  return jsonResponse({ stats: { latestSeq: 105 }, nodes: [{ id: 'node' }], routes: [{ id: 'route' }], recentPulses: [] });
}, 1);
assert.deepEqual(calls, ['/api/v1/public/bootstrap', '/api/v1/public/state']);
assert.equal(advancing.ready, true, advancing.diagnostic);

const staleState = await probeCurrentPublicTopology('http://fixture.test', async (url) => {
  if (new URL(url).pathname.endsWith('/bootstrap')) return jsonResponse({ latestSeq: 105 });
  return jsonResponse({ stats: { latestSeq: 100 }, nodes: [{ id: 'node' }], routes: [{ id: 'route' }] });
}, 2);
assert.equal(staleState.ready, false, 'state older than the earlier bootstrap cursor must fail closed');

const missingTopology = await probeCurrentPublicTopology('http://fixture.test', async (url) => {
  if (new URL(url).pathname.endsWith('/bootstrap')) return jsonResponse({ latestSeq: 100 });
  return jsonResponse({ stats: { latestSeq: 100 }, nodes: [{ id: 'node' }], routes: [] });
}, 3);
assert.equal(missingTopology.ready, false, 'current sequence without route topology must not pass');

console.log('browser smoke topology contracts passed');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}
