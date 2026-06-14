#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const assetsDir = join(root, 'web', 'dist', 'assets');

const budgets = [
  { label: 'main app JS', pattern: /^index-.*\.js$/, maxRaw: 500_000, maxGzip: 190_000 },
  { label: 'main app CSS', pattern: /^index-.*\.css$/, maxRaw: 180_000, maxGzip: 32_000 }
];

const files = readdirSync(assetsDir);
const errors = [];

for (const budget of budgets) {
  const file = files.find((name) => budget.pattern.test(name));
  if (!file) {
    errors.push(`${budget.label}: no built asset matching ${budget.pattern}`);
    continue;
  }
  const fullPath = join(assetsDir, file);
  const raw = statSync(fullPath).size;
  const gzip = gzipSync(readFileSync(fullPath)).length;
  if (raw > budget.maxRaw) errors.push(`${budget.label}: ${raw} raw bytes exceeds ${budget.maxRaw}`);
  if (gzip > budget.maxGzip) errors.push(`${budget.label}: ${gzip} gzip bytes exceeds ${budget.maxGzip}`);
}

if (errors.length > 0) {
  console.error('frontend budget check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('frontend budget ok');
