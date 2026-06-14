#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { buildAssetPackManifest, PACKS } from './asset-pack-manifest.mjs';

const root = new URL('..', import.meta.url);
const records = buildAssetPackManifest();
const errors = [];
const ids = new Set();

for (const record of records) {
  validateRecordShape(record);
  validateImageRequest(record);
  for (const target of record.targetFiles ?? []) {
    validateTarget(record, target);
  }
}

for (const pack of PACKS) {
  const manifestPath = `web/public/brand/${pack}/manifest.json`;
  if (!exists(manifestPath)) {
    errors.push(`${manifestPath} is missing`);
    continue;
  }
  try {
    const manifest = JSON.parse(read(manifestPath, 'utf8'));
    const icons = manifest.icons ?? [];
    for (const expected of [`/brand/${pack}/app-icon-192.png`, `/brand/${pack}/app-icon-512.png`]) {
      if (!icons.some((icon) => icon.src === expected)) errors.push(`${manifestPath} does not reference ${expected}`);
    }
  } catch (error) {
    errors.push(`${manifestPath} is not valid JSON: ${error.message}`);
  }
}

if (errors.length) {
  console.error(`Asset pack check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`asset pack ok: ${records.length} records, ${records.reduce((sum, record) => sum + record.targetFiles.length, 0)} targets`);

function validateRecordShape(record) {
  for (const key of ['id', 'pack', 'category', 'prompt', 'size', 'quality', 'format', 'postprocess', 'targetFiles', 'acceptance']) {
    if (!(key in record)) errors.push(`${record.id ?? '<missing id>'} missing ${key}`);
  }
  if (ids.has(record.id)) errors.push(`duplicate asset id ${record.id}`);
  ids.add(record.id);
  if (!PACKS.includes(record.pack)) errors.push(`${record.id} has invalid pack ${record.pack}`);
  if (!Array.isArray(record.targetFiles) || record.targetFiles.length === 0) errors.push(`${record.id} has no targetFiles`);
  if (!Array.isArray(record.acceptance) || record.acceptance.length === 0) errors.push(`${record.id} has no acceptance criteria`);
  if (String(record.prompt).match(/\b(?:password|secret|private key|packet hash|raw payload)\s*[:=]/i)) {
    errors.push(`${record.id} prompt appears to include private-looking material`);
  }
}

function validateImageRequest(record) {
  if (record.format === 'json') return;
  if (record.model !== 'gpt-image-2') errors.push(`${record.id} must use gpt-image-2`);
  if (!['low', 'medium', 'high', 'auto'].includes(record.quality)) errors.push(`${record.id} has invalid quality ${record.quality}`);
  if (!['png', 'jpeg', 'webp'].includes(record.format)) errors.push(`${record.id} has invalid format ${record.format}`);
  if (record.background === 'transparent') errors.push(`${record.id} requests transparent background, unsupported for gpt-image-2`);
  const match = String(record.size).match(/^(\d+)x(\d+)$/);
  if (!match) {
    errors.push(`${record.id} size must be WIDTHxHEIGHT`);
    return;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (width % 16 !== 0 || height % 16 !== 0) errors.push(`${record.id} size edges must be multiples of 16`);
  if (Math.max(width, height) > 3840) errors.push(`${record.id} edge exceeds 3840px`);
  if (Math.max(width, height) / Math.min(width, height) > 3) errors.push(`${record.id} aspect ratio exceeds 3:1`);
  if (pixels < 655360 || pixels > 8294400) errors.push(`${record.id} pixel count outside gpt-image-2 limits`);
}

function validateTarget(record, target) {
  if (target.includes('..')) errors.push(`${record.id} target escapes path: ${target}`);
  if (!target.startsWith('web/src/assets/v3/') && !target.startsWith('web/public/brand/') && !target.startsWith('web/public/labs/waterfall/')) {
    errors.push(`${record.id} target should stay in v3/public asset paths: ${target}`);
  }
  if (!exists(target)) {
    errors.push(`${record.id} target missing: ${target}`);
    return;
  }
  if (record.format === 'json' || target.endsWith('.json')) return;
  const buffer = read(target);
  if (target.endsWith('.png')) validatePng(record.id, target, buffer);
}

function validatePng(id, target, buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) {
    errors.push(`${id} target is not a PNG: ${target}`);
    return;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) errors.push(`${id} target has invalid dimensions: ${target}`);
  if (buffer.length < 200) errors.push(`${id} target is suspiciously small: ${target}`);
}

function exists(path) {
  return existsSync(new URL(path.replace(/\\/g, '/'), root));
}

function read(path, encoding = null) {
  return readFileSync(new URL(path.replace(/\\/g, '/'), root), encoding ?? undefined);
}
