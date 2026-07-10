#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = read('VERSION').trim();
const errors = [];

if (!/^\d+\.\d+\.\d+$/.test(version)) errors.push(`VERSION must be semver x.y.z, got "${version}"`);

requireText('Docker frontend version', 'Dockerfile', `ARG APP_VERSION=${version}`);
requireText('Docker immutable backend version symbol', 'Dockerfile', 'meshcore-canada-live-map/backend/internal/app.BuildVersion=');
requireText('Docker immutable Git symbol', 'Dockerfile', 'meshcore-canada-live-map/backend/internal/app.BuildGitSHA=');
requireText('Docker immutable build-time symbol', 'Dockerfile', 'meshcore-canada-live-map/backend/internal/app.BuildTime=');
requireText('development Compose version', 'docker-compose.yml', `APP_VERSION: \${APP_VERSION:-${version}}`);
requireText('README title', 'README.md', `# MeshCore MQTT Live Map v${version}`);
requireText('README image', 'README.md', `ghcr.io/n30nex/mc-cartolive:${version}`);
requireText('release notes', `docs/${version}/release_notes.md`, `# MC-CartoLive ${version} Release Notes`);
requireText('validation checklist', `docs/${version}/validation_checklist.md`, `# MC-CartoLive ${version} Validation Checklist`);
requireText('changelog entry', 'CHANGELOG.md', `## ${version} -`);
requireText('roadmap baseline', 'docs/roadmap.md', `Version \`${version}\``);
requireText('Go patch baseline', 'backend/go.mod', 'go 1.25.12');

const packageJson = JSON.parse(read('web/package.json'));
const lockJson = JSON.parse(read('web/package-lock.json'));
if (packageJson.version !== version) errors.push(`web/package.json version is ${packageJson.version}, expected ${version}`);
if (lockJson.version !== version) errors.push(`web/package-lock.json version is ${lockJson.version}, expected ${version}`);
if (lockJson.packages?.['']?.version !== version) {
  errors.push(`web/package-lock.json root version is ${lockJson.packages?.['']?.version}, expected ${version}`);
}

const schema = JSON.parse(read('docs/public-api.openapi.json'));
if (schema.info?.version !== version) errors.push(`OpenAPI info.version is ${schema.info?.version}, expected ${version}`);

const dockerfile = read('Dockerfile');
if ((dockerfile.match(new RegExp(`ARG APP_VERSION=${escapeRegExp(version)}`, 'g')) ?? []).length !== 3) {
  errors.push('Dockerfile must source the release version in exactly three stages');
}
for (const base of ['node:22-alpine@sha256:', 'golang:1.25.12-alpine@sha256:', 'alpine:3.22@sha256:']) {
  if (!dockerfile.includes(base)) errors.push(`Docker base image is not digest-pinned: ${base}`);
}
for (const forbidden of ['VITE_OPENWEATHERMAP_API_KEY', 'ENV APP_VERSION=', 'ENV GIT_SHA=', 'ENV BUILD_TIME=']) {
  if (dockerfile.includes(forbidden)) errors.push(`Dockerfile contains forbidden release/secret runtime path: ${forbidden}`);
}

const envExample = read('.env.example');
for (const identity of ['APP_VERSION', 'GIT_SHA', 'BUILD_TIME', 'VITE_GIT_SHA', 'VITE_BUILD_TIME']) {
  if (new RegExp(`^${identity}=`, 'm').test(envExample)) errors.push(`.env.example must not override compiled ${identity}`);
}

const productionCompose = read('docker-compose.production.yml');
if (/^\s+build:/m.test(productionCompose)) errors.push('production Compose must not build');
if (!productionCompose.includes('MC_CARTOLIVE_IMAGE:?')) errors.push('production Compose must require MC_CARTOLIVE_IMAGE');
if (!productionCompose.includes('127.0.0.1:39476:8080')) errors.push('production diagnostics must bind to loopback');
for (const identity of ['APP_VERSION:', 'GIT_SHA:', 'BUILD_TIME:', 'VITE_GIT_SHA:', 'VITE_BUILD_TIME:']) {
  if (productionCompose.includes(identity)) errors.push(`production Compose must not override compiled ${identity.slice(0, -1)}`);
}

const publishWorkflow = read('.github/workflows/docker-publish.yml');
if (publishWorkflow.includes('docker/build-push-action@')) errors.push('tag workflow must promote a candidate, never rebuild');
if (!publishWorkflow.includes('imagetools create')) errors.push('tag workflow must promote by manifest digest');
if (!publishWorkflow.includes('candidate-manifest.json') || !publishWorkflow.includes('test "$digest" = "$EVIDENCE_DIGEST"')) {
  errors.push('tag workflow must bind the mutable candidate tag to immutable candidate evidence');
}
if (!publishWorkflow.includes('git cat-file -t') || !publishWorkflow.includes('org.opencontainers.image.revision')) {
  errors.push('tag workflow must require an annotated tag and exact OCI revision');
}

const deployScript = read('scripts/deploy.sh');
if (!deployScript.includes('[ -n "$EXPECTED_GIT_SHA" ] || die')) errors.push('deploy must require an expected merge SHA');
if (!deployScript.includes('org.opencontainers.image.revision') || !deployScript.includes('trap on_exit EXIT')) {
  errors.push('deploy must verify immutable image identity and install the fail-safe EXIT trap');
}

for (const workflow of readdirSync(join(root, '.github', 'workflows')).filter((name) => name.endsWith('.yml'))) {
  const text = read(join('.github', 'workflows', workflow));
  for (const match of text.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)) {
    const spec = match[1];
    if (spec.startsWith('./')) continue;
    const ref = spec.split('@')[1] ?? '';
    if (!/^[0-9a-f]{40}$/.test(ref)) errors.push(`${workflow} action is not pinned to a full commit SHA: ${spec}`);
  }
}

if (errors.length > 0) {
  console.error(`Version/release contract failed for ${version}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`version/release contract ok: ${version}`);

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function requireText(label, file, needle) {
  if (!read(file).includes(needle)) errors.push(`${label}: ${file} does not contain "${needle}"`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
