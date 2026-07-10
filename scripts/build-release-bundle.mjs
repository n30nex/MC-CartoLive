#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = read('VERSION').trim();
const image = String(process.env.RELEASE_IMAGE ?? '').trim();
const gitSha = String(process.env.RELEASE_GIT_SHA ?? '').trim();
const buildTime = String(process.env.RELEASE_BUILD_TIME ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')).trim();
const outputRoot = resolve(root, process.env.RELEASE_OUTPUT_DIR ?? 'artifacts/release');

assert(/^\d+\.\d+\.\d+$/.test(version), `invalid VERSION: ${version}`);
assert(/^[0-9a-f]{40}$/.test(gitSha), `RELEASE_GIT_SHA must be a full Git SHA: ${gitSha}`);
assert(!Number.isNaN(Date.parse(buildTime)), `RELEASE_BUILD_TIME must be RFC3339: ${buildTime}`);
const imageMatch = /^([a-zA-Z0-9._:/-]+)@(sha256:[0-9a-f]{64})$/.exec(image);
assert(imageMatch, 'RELEASE_IMAGE must be an immutable image@sha256:digest reference');

const schemaSource = read('backend/internal/store/db.go');
const schemaMatch = /(?:const\s+SchemaVersion|SchemaVersion\s*=)\s*(\d+)/.exec(schemaSource);
assert(schemaMatch, 'could not read SchemaVersion from backend/internal/store/db.go');
const schemaVersion = Number(schemaMatch[1]);

const packageName = `mc-cartolive-${version}`;
const stage = join(outputRoot, 'stage', packageName);
rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const files = [
  ['docker-compose.production.yml', 'docker-compose.production.yml'],
  ['.env.example', '.env.example'],
  ['VERSION', 'VERSION'],
  ['scripts/deploy.sh', 'scripts/deploy.sh'],
  ['scripts/mc-cartolive-watchdog.sh', 'scripts/mc-cartolive-watchdog.sh'],
  ['scripts/post-release-audit.sh', 'scripts/post-release-audit.sh'],
  ['scripts/check-public-privacy.mjs', 'scripts/check-public-privacy.mjs'],
  ['scripts/live-smoke.ps1', 'scripts/live-smoke.ps1'],
  ['scripts/package-smoke.mjs', 'scripts/package-smoke.mjs'],
  ['scripts/soak-check.sh', 'scripts/soak-check.sh'],
  ['scripts/soak-check.ps1', 'scripts/soak-check.ps1'],
  ['deploy/systemd/mc-cartolive-watchdog.default', 'deploy/systemd/mc-cartolive-watchdog.default'],
  ['deploy/systemd/mc-cartolive-watchdog.service', 'deploy/systemd/mc-cartolive-watchdog.service'],
  ['deploy/systemd/mc-cartolive-watchdog.timer', 'deploy/systemd/mc-cartolive-watchdog.timer'],
  ['deploy/systemd/mc-cartolive-release-audit.default', 'deploy/systemd/mc-cartolive-release-audit.default'],
  ['deploy/systemd/mc-cartolive-release-audit.service', 'deploy/systemd/mc-cartolive-release-audit.service'],
  ['deploy/systemd/mc-cartolive-release-audit.timer', 'deploy/systemd/mc-cartolive-release-audit.timer'],
  ['deploy/cloudflare-cidrs.txt', 'deploy/cloudflare-cidrs.txt'],
  ['docs/3.2.0/upgrade-and-rollback.md', 'docs/upgrade-and-rollback.md'],
  ['docs/3.2.0/release_notes.md', 'docs/release-notes.md'],
  ['docs/3.2.0/security-and-operations.md', 'docs/security-and-operations.md'],
  ['docs/3.2.0/storage-and-fresh-start.md', 'docs/storage-and-fresh-start.md'],
  ['docs/3.2.0/validation_checklist.md', 'docs/validation-checklist.md'],
  ['docs/privacy.md', 'docs/privacy.md'],
  ['docs/public-api.openapi.json', 'docs/public-api.openapi.json']
];
for (const [source, target] of files) {
  const targetPath = join(stage, target);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(join(root, source), targetPath);
}

const manifest = {
  manifestVersion: 1,
  application: 'MC-CartoLive',
  version,
  tag: `v${version}`,
  gitSha,
  buildTime,
  image: {
    repository: imageMatch[1],
    digest: imageMatch[2],
    reference: image,
    platforms: ['linux/amd64', 'linux/arm64']
  },
  database: {
    schemaVersion,
    productionCutover: 'preserve_database',
    retentionDays: 7,
    publicEventRetentionHours: 24,
    historicalDataRecovery: true,
    historicalDataRecoveryMethod: 'operator_block_volume_backup'
  },
  releaseIdentity: 'compiled_immutable',
  operations: {
    postReleaseAudit: {
      phases: ['24h', 'day8', 'day14'],
      systemdTimer: 'mc-cartolive-release-audit.timer',
      privacySafeAggregateEvidence: true
    }
  },
  hostPrerequisites: {
    standardDigestDeploy: [],
    destructiveFreshDatabase: {
      nodeMinMajor: 18,
      purpose: 'credential_free_public_privacy_and_websocket_hello_gate'
    }
  },
  publicApi: 'docs/public-api.openapi.json',
  attestations: {
    image: `oci://${image}`,
    releaseAssets: `https://github.com/n30nex/MC-CartoLive/attestations`
  }
};
const manifestJSON = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync(join(outputRoot, 'release-manifest.json'), manifestJSON);
writeFileSync(join(stage, 'release-manifest.json'), manifestJSON);
writeFileSync(join(stage, 'README.txt'), `MC-CartoLive ${version} deployment bundle

This package deploys the prebuilt image by immutable digest. It does not build
on the target host. Read docs/upgrade-and-rollback.md before running anything.

The hosted 3.2.0 cutover preserves and transactionally migrates the existing
SQLite database. Take and verify an off-root-disk backup before deployment and
omit all destructive fresh-database flags. The destructive mode remains an
explicit operator tool but is not the hosted 3.2.0 procedure.

Image: ${image}
Git SHA: ${gitSha}
Schema: ${schemaVersion}

Before cutover, install and enable deploy/systemd/mc-cartolive-release-audit.timer.
It records privacy-safe 24-hour, day-8, and day-14 evidence without exporting
database rows or runtime secrets. See docs/storage-and-fresh-start.md.

Node.js 18 or newer is staged on the hosted system for the bundled
credential-free public privacy and WebSocket-hello validation. The deploy does
not install packages.
`);

console.log(JSON.stringify({ version, image, gitSha, schemaVersion, stage, manifest: join(outputRoot, 'release-manifest.json') }, null, 2));

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
