#!/usr/bin/env node
import { fetchWithRateLimitRetry } from './public-privacy-retry.mjs';
import { readFirstWebSocketTextFrame } from './public-privacy-websocket.mjs';

const options = parseOptions(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.BASE_URL || 'http://127.0.0.1:39476');
const publicOrigin = normalizeOrigin(options.origin || process.env.PUBLIC_ORIGIN || baseUrl);
const now = Date.now();
const from = now - 10 * 60 * 1000;

const endpoints = [
  { path: '/healthz', type: 'json' },
  { path: '/readyz', type: 'json' },
  { path: '/metrics', type: 'text', optionalNotFound: true },
  { path: '/api/v1/public/state', type: 'json' },
  { path: '/api/v1/public/bootstrap', type: 'json' },
  { path: '/api/v1/public/events?afterSeq=0&limit=25', type: 'json' },
  { path: '/api/v1/public/viewport?bbox=-142,41,-52,84&zoom=4&limit=25', type: 'json' },
  { path: '/api/v1/public/noc', type: 'json' },
  { path: `/api/v1/public/history?from=${from}&to=${now}&limit=25`, type: 'json' },
  { path: `/api/v1/public/history/summary?from=${from}&to=${now}&bucketMs=60000`, type: 'json' },
  { path: `/api/v1/public/packets?from=${from}&to=${now}&limit=25`, type: 'json' },
  { path: `/api/v1/public/chat?from=${from}&to=${now}&limit=25`, type: 'json' },
  { path: '/api/v1/public/solar', type: 'json' },
  { path: `/api/v1/public/propagation?from=${from}&to=${now}&limit=25`, type: 'json' },
  { path: '/api/v1/public/coverage?limit=25', type: 'json' },
  { path: '/api/v1/public/los/profile?aLat=43.65&aLng=-79.38&bLat=45.42&bLng=-75.69', type: 'json' },
  { path: '/api/v1/public/schema', type: 'json' },
  { path: '/api/v1/public/integrations/home-assistant', type: 'json' }
];

const forbiddenKeyPatterns = [
  /packetHash/i,
  /^hash$/i,
  /rawHex/i,
  /rawJson/i,
  /payloadHex/i,
  /pathHex/i,
  /publicKey/i,
  /privateKey/i,
  /resolver/i,
  /debug/i,
  /secret/i,
  /password/i,
  /token/i
];

const allowedKeyPatterns = [
  /^gitSha$/i,
  /^nextCursor$/i,
  /^cursor$/i,
  /^pathHash3$/i,
  /^hashSize$/i,
  /^mqttConnected$/i,
  /^mqttDroppedMessages$/i,
  /^mqttLastMessageAgeMs$/i,
  /^mqttMalformedTopics$/i,
  /^mqttMessages$/i,
  /^mqttReconnects$/i,
  /^mqttEnabled$/i
];

const longHex = /(?:^|\b)(?:0x)?[a-f0-9]{32,}(?:\b|$)/i;
const pathHex = /\b(?:[a-f0-9]{2}[:\-\s]){5,}[a-f0-9]{2}\b/i;
const base64Token = /\b[A-Za-z0-9+/]{48,}={0,2}\b/;
const secretPair = /\b(?:broker|resolver|debug|secret|token|key|hash|payload|path)[\w.-]*\s*[:=]\s*\S+/i;
const findings = [];

for (const endpoint of endpoints) {
  const url = `${baseUrl}${endpoint.path}`;
  const response = await fetchPublicEndpoint(url, endpoint.path);
  if (endpoint.optionalNotFound && response.status === 404) continue;
  if (!response.ok) {
    throw new Error(`${endpoint.path} returned ${response.status}`);
  }
  const text = await response.text();
  if (endpoint.type === 'text') {
    scanPublicText(text, endpoint.path, '$');
    continue;
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${endpoint.path} returned non-JSON: ${error.message}`);
  }
  scanValue(json, endpoint.path, '$', null);
}

await scanPublicWebSocket(baseUrl, publicOrigin);

if (findings.length > 0) {
  console.error(`Public privacy scan failed for ${baseUrl}:`);
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`public privacy scan ok: ${baseUrl}`);

async function fetchPublicEndpoint(url, path) {
  return fetchWithRateLimitRetry(url, { headers: { accept: 'application/json' } }, {
    onRetry: ({ delayMs }) => {
      console.warn(`${path} rate limited; retrying in ${Math.ceil(delayMs / 1000)}s`);
    }
  });
}

async function scanPublicWebSocket(base, origin) {
  const url = `${webSocketBaseUrl(base)}/ws/public`;
  const frame = await readFirstWebSocketTextFrame(url, origin, {
    onRetry: ({ delayMs }) => {
      console.warn(`/ws/public rate limited; retrying in ${Math.ceil(delayMs / 1000)}s`);
    }
  });
  let json;
  try {
    json = JSON.parse(frame);
  } catch (error) {
    throw new Error(`/ws/public returned non-JSON: ${error.message}`);
  }
  if (
    json?.type !== 'hello' ||
    json?.v !== 1 ||
    !Number.isInteger(json?.seq ?? 0) ||
    (json?.seq ?? 0) < 0 ||
    typeof json?.connectionId !== 'string' ||
    json.connectionId.trim().length === 0
  ) {
    throw new Error('/ws/public first frame was not a valid version-1 hello');
  }
  scanValue(json, '/ws/public', '$', null);
}

function scanValue(value, endpoint, path, key) {
  if (key && isForbiddenKey(key) && !isAllowedKey(key)) {
    findings.push(`${endpoint} ${path}: forbidden key "${key}"`);
  }

  if (typeof value === 'string') {
    if (!isAllowedKey(key || '') && !isLocalSchemaRef(key, value)) {
      const stringFinding = publicStringFinding(value);
      if (stringFinding) {
        findings.push(`${endpoint} ${path}: ${stringFinding}`);
      }
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanValue(item, endpoint, `${path}[${index}]`, null));
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    scanValue(childValue, endpoint, `${path}.${childKey}`, childKey);
  }
}

function isForbiddenKey(key) {
  return forbiddenKeyPatterns.some((pattern) => pattern.test(key));
}

function isAllowedKey(key) {
  return allowedKeyPatterns.some((pattern) => pattern.test(key));
}

function isLocalSchemaRef(key, value) {
  return key === '$ref' && /^#\/components\/schemas\/[A-Za-z][A-Za-z0-9]*$/.test(value);
}

function publicStringFinding(value) {
  if (secretPair.test(value)) {
    return 'sensitive key/value-like string';
  }
  if (pathHex.test(value)) {
    return 'raw path hex-like substring';
  }
  if (longHex.test(value)) {
    return 'long hex-like substring';
  }
  if (base64Token.test(value)) {
    return 'long base64-like substring';
  }
  return '';
}

function scanPublicText(value, endpoint, path) {
  const finding = publicStringFinding(value);
  if (finding) {
    findings.push(`${endpoint} ${path}: ${finding}`);
  }
}

function normalizeBaseUrl(value) {
  const normalized = String(value).replace(/\/+$/, '');
  const parsed = new URL(normalized);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`invalid public HTTP base URL: ${normalized}`);
  }
  return normalized;
}

function normalizeOrigin(value) {
  const parsed = new URL(String(value));
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('invalid public WebSocket origin');
  }
  return parsed.origin;
}

function parseOptions(args) {
  let baseUrl = '';
  let origin = '';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--origin') {
      if (!args[index + 1] || String(args[index + 1]).startsWith('--') || origin) {
        throw new Error('--origin requires exactly one HTTP(S) origin');
      }
      origin = String(args[index + 1]);
      index += 1;
    } else if (!arg.startsWith('--') && !baseUrl) {
      baseUrl = arg;
    } else {
      throw new Error(`unknown privacy-scan argument: ${arg}`);
    }
  }
  return { baseUrl, origin };
}

function webSocketBaseUrl(value) {
  return normalizeBaseUrl(value)
    .replace(/^https:/i, 'wss:')
    .replace(/^http:/i, 'ws:');
}
