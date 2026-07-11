#!/usr/bin/env node

import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import net from 'node:net';
import tls from 'node:tls';

const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeOrigin(args.url ?? args._[0] ?? process.env.BASE_URL ?? 'https://carto.canadaverse.org');
const origin = normalizeOrigin(args.origin ?? baseUrl);
const timeoutMs = numberArg(args['timeout-ms'] ?? process.env.WEBSOCKET_FLOW_TIMEOUT_MS ?? 60000, 'timeout-ms');
const output = String(args.output ?? '').trim();
const requireEvent = args['require-event'] === true;

try {
  const result = await waitForLiveEvent(baseUrl, origin, timeoutMs);
  if (requireEvent && !result.eventReceived) {
    throw new Error(`no live WebSocket event arrived within ${timeoutMs}ms`);
  }
  const json = `${JSON.stringify(result)}\n`;
  if (output) await writeFile(output, json, 'utf8');
  process.stdout.write(json);
} catch (error) {
  const result = { eventReceived: false, error: error.message, checkedAt: new Date().toISOString() };
  const json = `${JSON.stringify(result)}\n`;
  if (output) await writeFile(output, json, 'utf8');
  process.stderr.write(`websocket flow probe failed: ${error.message}\n`);
  process.exitCode = 1;
}

async function waitForLiveEvent(publicBaseUrl, publicOrigin, waitMs) {
  const httpUrl = new URL(publicBaseUrl);
  const target = new URL(`${httpUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${httpUrl.host}/ws/public`);
  const secure = target.protocol === 'wss:';
  const port = Number(target.port || (secure ? 443 : 80));
  const path = `${target.pathname}${target.search}`;
  const key = crypto.randomBytes(16).toString('base64');
  const expectedAccept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');

  return await new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    let hello;
    let settled = false;
    const socket = secure
      ? tls.connect({ host: target.hostname, port, servername: target.hostname }, sendUpgrade)
      : net.connect({ host: target.hostname, port }, sendUpgrade);
    const timer = setTimeout(() => {
      if (hello) {
        done({
          eventReceived: false,
          helloSeq: hello.seq ?? 0,
          timedOut: true,
          checkedAt: new Date().toISOString(),
        });
      } else {
        fail(new Error(`WebSocket hello did not arrive within ${waitMs}ms`));
      }
    }, waitMs);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        parseAvailable();
      } catch (error) {
        fail(error);
      }
    });
    socket.on('error', fail);
    socket.on('close', () => {
      if (!settled) fail(new Error('WebSocket closed before a live event arrived'));
    });

    function sendUpgrade() {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${target.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        `Origin: ${publicOrigin}`,
        '',
        '',
      ].join('\r\n'));
    }

    function parseAvailable() {
      if (!upgraded) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        buffer = buffer.subarray(headerEnd + 4);
        const lines = header.split('\r\n');
        if (!/^HTTP\/1\.[01] 101\b/.test(lines[0] ?? '')) throw new Error('WebSocket upgrade was refused');
        const accept = lines.find((line) => /^sec-websocket-accept:/i.test(line))?.split(':').slice(1).join(':').trim();
        if (accept !== expectedAccept) throw new Error('WebSocket accept identity was invalid');
        upgraded = true;
      }

      for (;;) {
        const frame = readFrame(buffer);
        if (!frame) return;
        buffer = buffer.subarray(frame.consumed);
        if (frame.opcode === 0x9) {
          socket.write(clientFrame(0xA, frame.payload));
          continue;
        }
        if (frame.opcode === 0x8) throw new Error('WebSocket closed before a live event arrived');
        if (frame.opcode !== 0x1) continue;
        let message;
        try {
          message = JSON.parse(frame.payload.toString('utf8'));
        } catch {
          throw new Error('WebSocket sent a non-JSON text frame');
        }
        if (!hello) {
          if (message?.type !== 'hello' || !Number.isInteger(message?.seq ?? 0) || (message?.seq ?? 0) < 0) {
            throw new Error('WebSocket first frame was not a valid hello');
          }
          hello = message;
          continue;
        }
        const eventSeq = Number.isInteger(message?.seq) ? message.seq : null;
        done({
          eventReceived: true,
          helloSeq: hello.seq ?? 0,
          eventSeq,
          eventType: String(message?.type ?? 'unknown'),
          receivedAt: new Date().toISOString(),
        });
        return;
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
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function readFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const wide = buffer.readBigUInt64BE(2);
    if (wide > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebSocket frame was too large');
    length = Number(wide);
    offset = 10;
  }
  let mask;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  return { opcode, payload, consumed: offset + length };
}

function clientFrame(opcode, payload) {
  if (payload.length > 125) throw new Error('control frame payload was too large');
  const mask = crypto.randomBytes(4);
  const frame = Buffer.alloc(2 + 4 + payload.length);
  frame[0] = 0x80 | opcode;
  frame[1] = 0x80 | payload.length;
  mask.copy(frame, 2);
  for (let i = 0; i < payload.length; i += 1) frame[6 + i] = payload[i] ^ mask[i % 4];
  return frame;
}

function normalizeOrigin(raw) {
  const url = new URL(String(raw));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`invalid credential-free HTTP(S) origin: ${raw}`);
  }
  return url.origin;
}

function numberArg(raw, name) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1000 || value > 24 * 60 * 60 * 1000) throw new Error(`${name} must be 1000..86400000`);
  return value;
}

function parseArgs(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (key === 'require-event') {
      result[key] = true;
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`missing value for --${key}`);
    result[key] = next;
    index += 1;
  }
  return result;
}
