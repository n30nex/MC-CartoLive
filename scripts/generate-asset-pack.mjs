#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAssetPackManifest } from './asset-pack-manifest.mjs';

const root = new URL('..', import.meta.url);
const args = parseArgs(process.argv.slice(2));
const records = buildAssetPackManifest().filter((record) => {
  if (args.pack && record.pack !== args.pack) return false;
  if (args.category && record.category !== args.category) return false;
  if (record.format === 'json') return false;
  return true;
});

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.batch) {
  const output = args.output ?? 'artifacts/asset-pack/openai-batch.jsonl';
  const body = records.map((record) => JSON.stringify({
    custom_id: record.id,
    method: 'POST',
    url: '/v1/images/generations',
    body: requestBody(record, args.draft)
  })).join('\n') + '\n';
  writeText(output, body);
  console.log(`wrote ${records.length} batch image requests to ${output}`);
  process.exit(0);
}

if (!args.sync) {
  console.log(`asset generation plan: ${records.length} image records`);
  console.log('Use --batch to write JSONL for the Batch API, or --sync with OPENAI_API_KEY to create raw candidate images.');
  process.exit(0);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY is required for --sync generation.');
  process.exit(1);
}

const rawDir = args.output ?? 'artifacts/asset-pack/raw';
mkdirSync(fileURL(rawDir), { recursive: true });
for (const record of records) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody(record, args.draft))
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${record.id} failed: ${response.status} ${text}`);
  }
  const payload = await response.json();
  const image = payload?.data?.[0]?.b64_json;
  if (!image) throw new Error(`${record.id} did not return data[0].b64_json`);
  const output = `${rawDir.replace(/[\\/]$/, '')}/${record.id}.${record.format || 'png'}`;
  writeFileSync(fileURL(output), Buffer.from(image, 'base64'));
  console.log(`generated ${output}`);
}

function requestBody(record, draft) {
  const format = record.format === 'json' ? 'png' : record.format;
  return {
    model: 'gpt-image-2',
    prompt: scrubbedPrompt(record),
    n: 1,
    size: record.size,
    quality: draft ? 'low' : record.quality,
    output_format: format,
    background: record.background === 'transparent' ? 'opaque' : (record.background ?? 'opaque')
  };
}

function scrubbedPrompt(record) {
  return [
    record.prompt,
    'Use abstract, synthetic public-safe map and radio motifs only.',
    'Do not include exact third-party logos, real packet hashes, full keys, node public keys, credentials, raw path hex, broker URLs, private payload text, or readable live identifiers.',
    'No text unless the prompt explicitly asks for text.'
  ].join(' ');
}

function writeText(path, text) {
  const url = fileURL(path);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, text);
}

function fileURL(path) {
  return new URL(path.replace(/\\/g, '/'), root);
}

function parseArgs(values) {
  const out = {
    help: false,
    batch: false,
    sync: false,
    draft: false,
    pack: '',
    category: '',
    output: ''
  };
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === '--help' || value === '-h') out.help = true;
    else if (value === '--batch') out.batch = true;
    else if (value === '--sync') out.sync = true;
    else if (value === '--draft') out.draft = true;
    else if (value === '--pack') out.pack = values[++i] ?? '';
    else if (value === '--category') out.category = values[++i] ?? '';
    else if (value === '--output') out.output = values[++i] ?? '';
  }
  if (out.pack && out.pack !== 'world' && out.pack !== 'canada') throw new Error('--pack must be world or canada');
  return out;
}

function printHelp() {
  console.log(`Usage:
  node scripts/generate-asset-pack.mjs
  node scripts/generate-asset-pack.mjs --batch [--draft] [--pack world|canada] [--category role]
  OPENAI_API_KEY=... node scripts/generate-asset-pack.mjs --sync [--draft] [--output artifacts/asset-pack/raw]

The committed app build never calls OpenAI. This script only creates raw candidate
images or Batch API JSONL for human review, then scripts/process-asset-pack.mjs
creates deterministic committed assets.`);
}
