#!/usr/bin/env node
const baseUrl = normalizeBaseUrl(process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:39476');
const now = Date.now();
const from = now - 10 * 60 * 1000;

const endpoints = [
  '/healthz',
  '/readyz',
  '/api/v1/public/state',
  `/api/v1/public/history?from=${from}&to=${now}&limit=25`,
  `/api/v1/public/history/summary?from=${from}&to=${now}&bucketMs=60000`,
  `/api/v1/public/packets?from=${from}&to=${now}&limit=25`,
  `/api/v1/public/chat?from=${from}&to=${now}&limit=25`
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
  const url = `${baseUrl}${endpoint}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (response.status === 404 && endpoint.startsWith('/api/v1/public/chat')) {
    continue;
  }
  if (!response.ok) {
    throw new Error(`${endpoint} returned ${response.status}`);
  }
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${endpoint} returned non-JSON: ${error.message}`);
  }
  scanValue(json, endpoint, '$', null);
}

await scanPublicWebSocket(baseUrl);

if (findings.length > 0) {
  console.error(`Public privacy scan failed for ${baseUrl}:`);
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`public privacy scan ok: ${baseUrl}`);

async function scanPublicWebSocket(base) {
  if (typeof WebSocket !== 'function') {
    return;
  }
  const url = `${webSocketBaseUrl(base)}/ws/public`;
  const frame = await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('/ws/public did not send a frame within 5s'));
    }, 5000);
    ws.addEventListener('message', (event) => {
      clearTimeout(timer);
      ws.close();
      resolve(String(event.data));
    }, { once: true });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('/ws/public websocket connection failed'));
    }, { once: true });
  });
  let json;
  try {
    json = JSON.parse(frame);
  } catch (error) {
    throw new Error(`/ws/public returned non-JSON: ${error.message}`);
  }
  scanValue(json, '/ws/public', '$', null);
}

function scanValue(value, endpoint, path, key) {
  if (key && isForbiddenKey(key) && !isAllowedKey(key)) {
    findings.push(`${endpoint} ${path}: forbidden key "${key}"`);
  }

  if (typeof value === 'string') {
    if (!isAllowedKey(key || '')) {
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

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '');
}

function webSocketBaseUrl(value) {
  return normalizeBaseUrl(value)
    .replace(/^https:/i, 'wss:')
    .replace(/^http:/i, 'ws:');
}
