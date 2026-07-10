#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const assetsDir = join(root, 'web', 'dist', 'assets');

const budgets = [
  { label: 'main app JS', pattern: /^index-.*\.js$/, maxRaw: 500_000, maxGzip: 100_000 },
  { label: 'main app CSS', pattern: /^index-.*\.css$/, maxRaw: 180_000, maxGzip: 32_000 }
];

const files = readdirSync(assetsDir);
const errors = [];
const measurements = [];

for (const budget of budgets) {
  const file = files.find((name) => budget.pattern.test(name));
  if (!file) {
    errors.push(`${budget.label}: no built asset matching ${budget.pattern}`);
    continue;
  }
  const fullPath = join(assetsDir, file);
  const raw = statSync(fullPath).size;
  const gzip = gzipSync(readFileSync(fullPath)).length;
  measurements.push({ label: budget.label, file, raw, gzip });
  if (raw > budget.maxRaw) errors.push(`${budget.label}: ${raw} raw bytes exceeds ${budget.maxRaw}`);
  if (gzip > budget.maxGzip) errors.push(`${budget.label}: ${gzip} gzip bytes exceeds ${budget.maxGzip}`);
}

const indexHTML = readFileSync(join(root, 'web', 'dist', 'index.html'), 'utf8');
const firstViewFiles = [...indexHTML.matchAll(/(?:src|href)=["']\/?(assets\/[^"']+)["']/g)]
  .map((match) => match[1].replace(/^assets\//, ''))
  .filter((name, index, all) => all.indexOf(name) === index && /\.(?:js|css)$/.test(name));
let firstViewGzip = 0;
for (const file of firstViewFiles) {
  const fullPath = join(assetsDir, file);
  firstViewGzip += gzipSync(readFileSync(fullPath)).length;
}
if (firstViewGzip > 500_000) errors.push(`initial first-view JS+CSS: ${firstViewGzip} gzip bytes exceeds 500000`);

for (const file of files.filter((name) => /maplibre.*\.css$/i.test(name))) {
  measurements.push({ label: 'MapLibre vendor CSS (reported separately)', file, raw: statSync(join(assetsDir, file)).size, gzip: gzipSync(readFileSync(join(assetsDir, file))).length });
}

if (errors.length > 0) {
  console.error('frontend budget check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

for (const item of measurements) {
  console.log(`${item.label}: ${item.file} raw=${item.raw} gzip=${item.gzip}`);
}
console.log(`initial first-view JS+CSS: files=${firstViewFiles.length} gzip=${firstViewGzip}`);
console.log('frontend budget ok');
