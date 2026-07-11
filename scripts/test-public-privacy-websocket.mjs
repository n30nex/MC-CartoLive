#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { readFirstWebSocketTextFrame } from './public-privacy-websocket.mjs';

let attempts = 0;
const server = net.createServer((socket) => {
  let request = '';
  socket.on('data', (chunk) => {
    request += chunk.toString('utf8');
    if (!request.includes('\r\n\r\n')) return;
    attempts += 1;
    if (attempts === 1) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nRetry-After: 0\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    const key = /^Sec-WebSocket-Key:\s*(.+)$/im.exec(request)?.[1]?.trim();
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    const payload = Buffer.from(JSON.stringify({ v: 1, type: 'hello', seq: 0, connectionId: 'retry-test' }));
    const frame = Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.end(frame);
  });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  assert(address && typeof address === 'object');
  const delays = [];
  const frame = await readFirstWebSocketTextFrame(
    `ws://127.0.0.1:${address.port}/ws/public`,
    `http://127.0.0.1:${address.port}`,
    { maxAttempts: 2, timeoutMs: 2000, sleep: async (delayMs) => delays.push(delayMs) }
  );
  assert.equal(JSON.parse(frame).connectionId, 'retry-test');
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [250]);
  console.log('public privacy websocket retry contract ok');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
