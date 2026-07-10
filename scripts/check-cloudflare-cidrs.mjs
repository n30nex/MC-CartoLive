#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cidrs = readFileSync(join(root, 'deploy/cloudflare-cidrs.txt'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const compose = readFileSync(join(root, 'docker-compose.production.yml'), 'utf8');
const joined = cidrs.join(',');
const errors = [];

if (!compose.includes('TRUST_PROXY_HEADERS: "true"')) errors.push('production Compose must enable trusted proxy parsing');
if (!compose.includes(joined)) errors.push('production Compose CIDR default does not match deploy/cloudflare-cidrs.txt');
if (new Set(cidrs).size !== cidrs.length) errors.push('Cloudflare CIDR list contains duplicates');
if (!cidrs.some((value) => value.includes(':')) || !cidrs.some((value) => value.includes('.'))) {
  errors.push('Cloudflare CIDR list must include IPv4 and IPv6');
}

if (process.argv.includes('--online')) {
  const [v4, v6] = await Promise.all([
    fetchText('https://www.cloudflare.com/ips-v4/'),
    fetchText('https://www.cloudflare.com/ips-v6/')
  ]);
  const official = [...v4.split(/\s+/), ...v6.split(/\s+/)].filter(Boolean);
  if (official.join(',') !== joined) errors.push('committed Cloudflare CIDRs differ from the official published lists');
}

if (errors.length) {
  console.error('Cloudflare CIDR contract failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log(`Cloudflare CIDR contract ok: ${cidrs.length} networks`);

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return (await response.text()).trim();
}
