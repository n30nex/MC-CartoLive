#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = read('VERSION').trim();
const schema = JSON.parse(read('docs/public-api.openapi.json'));
const backendRoutes = read('backend/internal/api/routes.go');
const backendSchema = read('backend/internal/api/public_extended.go');
const errors = [];

if (schema.openapi !== '3.1.0') errors.push('openapi document version must be 3.1.0');
if (schema.info?.version !== version) errors.push(`schema version ${schema.info?.version} does not match VERSION ${version}`);
if (!backendSchema.includes('publicOpenAPISchema(s.Config.AppVersion)')) errors.push('runtime schema must use compiled Config.AppVersion');
if (!backendSchema.includes('"version": version')) errors.push('runtime schema must populate info.version dynamically');

const requiredPaths = [
  '/healthz', '/readyz', '/api/v1/public/state', '/api/v1/public/bootstrap',
  '/api/v1/public/history', '/api/v1/public/history/summary', '/api/v1/public/events',
  '/api/v1/public/viewport', '/api/v1/public/noc', '/api/v1/public/packets',
  '/api/v1/public/chat', '/api/v1/public/solar', '/api/v1/public/propagation',
  '/api/v1/public/coverage', '/api/v1/public/los/profile', '/api/v1/public/schema',
  '/api/v1/public/integrations/home-assistant', '/ws/public'
];
for (const path of requiredPaths) {
  if (!schema.paths?.[path]?.get) errors.push(`missing public schema path ${path}`);
  const routeNeedle = path === '/ws/public' ? 'GET /ws/public' : `GET ${path}`;
  if (!backendRoutes.includes(routeNeedle)) errors.push(`backend route inventory missing ${path}`);
}

for (const component of [
  'RuntimeStatus', 'PublicRuntimeHealth', 'PublicBootstrapResponse', 'PublicEventsResponse',
  'PublicViewportResponse', 'PublicLiveState', 'PublicNode', 'PublicRoute', 'PublicMapCluster'
]) {
  if (!schema.components?.schemas?.[component]) errors.push(`missing public schema component ${component}`);
}
if (!schema.paths?.['/ws/public']?.get?.['x-websocket-messages']) errors.push('WebSocket message inventory is missing');

for (const forbidden of ['rawHex', 'rawJson', 'payloadHex', 'pathHex', 'packetHash', 'observerPublicKey']) {
  if (!schema['x-public-forbidden-fields']?.includes(forbidden)) errors.push(`missing forbidden field marker ${forbidden}`);
}
if (/"example"\s*:/i.test(JSON.stringify(schema))) errors.push('OpenAPI examples require separate privacy review and are not permitted here');

if (errors.length > 0) {
  console.error('public schema check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`public schema and route inventory ok: ${version}`);

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}
