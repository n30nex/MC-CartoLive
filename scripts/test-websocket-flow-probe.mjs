#!/usr/bin/env node

import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./websocket-flow-probe.mjs', import.meta.url));
const sockets = new Set();
let connections = 0;
const server = net.createServer((socket) => {
  connections += 1;
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  let request = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    request = Buffer.concat([request, chunk]);
    const headerEnd = request.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    socket.removeAllListeners('data');
    const header = request.subarray(0, headerEnd).toString('utf8');
    const key = header.match(/^Sec-WebSocket-Key:\s*(.+)$/im)?.[1]?.trim();
    if (!key) return socket.destroy();
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(textFrame(JSON.stringify({ type: 'hello', v: 1, seq: 41, connectionId: 'test' })));
    if (connections === 1) setTimeout(() => socket.write(textFrame(JSON.stringify({ type: 'packet', seq: 42 }))), 25);
  });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const result = await run(process.execPath, [helper, base, '--origin', base, '--timeout-ms', '3000']);
  if (result.code !== 0) throw new Error(`probe exited ${result.code}: ${result.stderr}`);
  const evidence = JSON.parse(result.stdout);
  if (evidence.eventReceived !== true || evidence.helloSeq !== 41 || evidence.eventSeq !== 42 || evidence.eventType !== 'packet') {
    throw new Error(`unexpected probe evidence: ${result.stdout}`);
  }
  const quiet = await run(process.execPath, [helper, base, '--origin', base, '--timeout-ms', '1000']);
  if (quiet.code !== 0) throw new Error(`quiet probe exited ${quiet.code}: ${quiet.stderr}`);
  const quietEvidence = JSON.parse(quiet.stdout);
  if (quietEvidence.eventReceived !== false || quietEvidence.helloSeq !== 41 || quietEvidence.timedOut !== true) {
    throw new Error(`unexpected quiet probe evidence: ${quiet.stdout}`);
  }
  const required = await run(process.execPath, [helper, '--url', base, '--origin', base, '--timeout-ms', '1000', '--require-event']);
  if (required.code === 0 || !required.stderr.includes('no live WebSocket event arrived')) {
    throw new Error(`required-event probe did not fail closed: ${JSON.stringify(required)}`);
  }
  console.log('websocket flow probe contract ok');
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
}

function textFrame(text) {
  const payload = Buffer.from(text);
  if (payload.length >= 126) throw new Error('test frame unexpectedly large');
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}
