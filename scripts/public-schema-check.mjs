#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = read('VERSION').trim();
const schema = JSON.parse(read('docs/public-api.openapi.json'));
const errors = [];

if (schema.openapi !== '3.1.0') errors.push('openapi version must be 3.1.0');
if (schema.info?.version !== version) errors.push(`schema version ${schema.info?.version} does not match VERSION ${version}`);

const requiredPaths = [
  '/api/v1/public/state',
  '/api/v1/public/events',
  '/api/v1/public/viewport',
  '/api/v1/public/noc',
  '/api/v1/public/coverage',
  '/api/v1/public/los/profile',
  '/api/v1/public/schema',
  '/api/v1/public/integrations/home-assistant'
];
for (const path of requiredPaths) {
  if (!schema.paths?.[path]?.get) errors.push(`missing public schema path ${path}`);
}

const text = JSON.stringify(schema);
for (const forbidden of ['rawHex', 'rawJson', 'payloadHex', 'pathHex', 'packetHash', 'observerPublicKey']) {
  if (!schema['x-public-forbidden-fields']?.includes(forbidden)) {
    errors.push(`missing forbidden field marker ${forbidden}`);
  }
}
if (/"example"\s*:/i.test(text)) {
  errors.push('schema examples must go through the public privacy scanner before being added');
}

if (errors.length > 0) {
  console.error('public schema check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`public schema ok: ${version}`);

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}
