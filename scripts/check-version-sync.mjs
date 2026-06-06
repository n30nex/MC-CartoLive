#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = read('VERSION').trim();
const errors = [];

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  errors.push(`VERSION must be semver x.y.z, got "${version}"`);
}

const checks = [
  ['backend default APP_VERSION', 'backend/internal/app/config.go', `envString("APP_VERSION", "${version}")`],
  ['.env.example APP_VERSION', '.env.example', `APP_VERSION=${version}`],
  ['Dockerfile APP_VERSION arg', 'Dockerfile', `ARG APP_VERSION=${version}`],
  ['docker-compose APP_VERSION default', 'docker-compose.yml', `APP_VERSION: \${APP_VERSION:-${version}}`],
  ['web index title', 'web/index.html', `MC-CartoLive v${version}`],
  ['README title', 'README.md', `# MeshCore MQTT Live Map v${version}`],
  ['README image tag', 'README.md', `ghcr.io/n30nex/mc-cartolive:${version}`],
  ['README release path', 'README.md', `v${version} release path`],
  ['production image tag', 'docs/production.md', `ghcr.io/n30nex/mc-cartolive:${version}`],
  ['development live-smoke example', 'docs/development.md', `-ExpectedVersion ${version}`],
  ['changelog entry', 'CHANGELOG.md', `## ${version} -`],
  ['roadmap baseline', 'docs/roadmap.md', `Version \`${version}\``],
  ['detailed roadmap baseline', 'docs/roadmap-2.5.2-to-2.6.0.md', `Baseline audited: \`v${version}\``]
];

for (const [label, file, needle] of checks) {
  const text = read(file);
  if (!text.includes(needle)) {
    errors.push(`${label}: ${file} does not contain "${needle}"`);
  }
}

const packageJson = JSON.parse(read('web/package.json'));
if (packageJson.version !== version) {
  errors.push(`web/package.json version is ${packageJson.version}, expected ${version}`);
}

const lockJson = JSON.parse(read('web/package-lock.json'));
if (lockJson.version !== version) {
  errors.push(`web/package-lock.json version is ${lockJson.version}, expected ${version}`);
}
if (lockJson.packages?.['']?.version !== version) {
  errors.push(`web/package-lock.json root package version is ${lockJson.packages?.['']?.version}, expected ${version}`);
}

const dockerfile = read('Dockerfile');
const dockerArgCount = countOccurrences(dockerfile, `ARG APP_VERSION=${version}`);
if (dockerArgCount < 2) {
  errors.push(`Dockerfile should contain two APP_VERSION args for ${version}, found ${dockerArgCount}`);
}

if (errors.length > 0) {
  console.error(`Version sync failed for ${version}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`version sync ok: ${version}`);

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}
