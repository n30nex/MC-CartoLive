import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { fetchWithRateLimitRetry } from './public-privacy-retry.mjs';

export async function readFirstWebSocketTextFrame(rawUrl, origin, options = {}) {
  const response = await fetchWithRateLimitRetry(rawUrl, {}, {
    fetchImpl: () => readFirstWebSocketAttempt(rawUrl, origin, options.timeoutMs),
    sleep: options.sleep,
    maxAttempts: options.maxAttempts,
    now: options.now,
    onRetry: options.onRetry
  });
  if (response.status !== 101) {
    throw new Error(`/ws/public websocket connection failed with HTTP ${response.status}`);
  }
  return response.frame;
}

async function readFirstWebSocketAttempt(rawUrl, origin, timeoutMs = 5000) {
  const target = new URL(rawUrl);
  const isSecure = target.protocol === 'wss:';
  if (!isSecure && target.protocol !== 'ws:') throw new Error('/ws/public websocket URL must use ws or wss');
  const port = Number(target.port || (isSecure ? 443 : 80));
  const path = `${target.pathname || '/'}${target.search || ''}`;
  const host = target.port ? target.host : target.hostname;
  const key = crypto.randomBytes(16).toString('base64');
  const expectedAccept = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  return await new Promise((resolve, reject) => {
    const socket = isSecure
      ? tls.connect({ host: target.hostname, port, servername: target.hostname })
      : net.connect({ host: target.hostname, port });
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    let responseHeaders = null;
    let settled = false;
    const timer = setTimeout(() => fail(new Error(`/ws/public did not send a frame within ${timeoutMs}ms`)), timeoutMs);

    socket.on('connect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        `Origin: ${normalizeHttpOrigin(origin)}`,
        '',
        ''
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      tryParse();
    });
    socket.on('error', (error) => fail(error));
    socket.on('close', () => {
      if (!settled) fail(new Error('/ws/public websocket connection closed before first frame'));
    });

    function tryParse() {
      if (!upgraded) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        buffer = buffer.subarray(headerEnd + 4);
        const lines = header.split('\r\n');
        const statusMatch = /^HTTP\/1\.[01] (\d{3})\b/.exec(lines[0] || '');
        if (!statusMatch) {
          fail(new Error('/ws/public websocket response status was invalid'));
          return;
        }
        const status = Number(statusMatch[1]);
        responseHeaders = parseHeaders(lines.slice(1));
        if (status !== 101) {
          done(httpResponse(status, responseHeaders));
          return;
        }
        if (responseHeaders.get('sec-websocket-accept') !== expectedAccept) {
          fail(new Error('/ws/public websocket accept header invalid'));
          return;
        }
        upgraded = true;
      }

      for (;;) {
        const frame = tryReadFrame(buffer);
        if (!frame) return;
        buffer = buffer.subarray(frame.consumed);
        if (frame.opcode === 0x1) {
          done({ ...httpResponse(101, responseHeaders), frame: frame.payload.toString('utf8') });
          return;
        }
        if (frame.opcode === 0x8) {
          fail(new Error('/ws/public websocket closed before first text frame'));
          return;
        }
      }
    }

    function done(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    }
  });
}

function parseHeaders(lines) {
  const values = new Map();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    values.set(name, values.has(name) ? `${values.get(name)}, ${value}` : value);
  }
  return { get: (name) => values.get(String(name).toLowerCase()) ?? null };
}

function httpResponse(status, headers) {
  return { status, headers, arrayBuffer: async () => new ArrayBuffer(0) };
}

function tryReadFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('/ws/public websocket frame too large');
    length = Number(bigLength);
    offset += 8;
  }

  let mask;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { opcode, payload, consumed: offset + length };
}

function normalizeHttpOrigin(value) {
  const parsed = new URL(String(value));
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('invalid public WebSocket origin');
  }
  return parsed.origin;
}
