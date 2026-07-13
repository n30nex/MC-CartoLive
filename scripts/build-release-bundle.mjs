#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = read('VERSION').trim();
const worldImage = String(process.env.RELEASE_WORLD_IMAGE ?? '').trim();
const canadaImage = String(process.env.RELEASE_CANADA_IMAGE ?? '').trim();
const gitSha = String(process.env.RELEASE_GIT_SHA ?? '').trim();
const buildTime = String(process.env.RELEASE_BUILD_TIME ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')).trim();
const outputRoot = resolve(root, process.env.RELEASE_OUTPUT_DIR ?? 'artifacts/release');

assert(/^\d+\.\d+\.\d+$/.test(version), `invalid VERSION: ${version}`);
assert(/^[0-9a-f]{40}$/.test(gitSha), `RELEASE_GIT_SHA must be a full Git SHA: ${gitSha}`);
assert(!Number.isNaN(Date.parse(buildTime)), `RELEASE_BUILD_TIME must be RFC3339: ${buildTime}`);
const worldImageMatch = /^([a-zA-Z0-9._:/-]+)@(sha256:[0-9a-f]{64})$/.exec(worldImage);
const canadaImageMatch = /^([a-zA-Z0-9._:/-]+)@(sha256:[0-9a-f]{64})$/.exec(canadaImage);
assert(worldImageMatch, 'RELEASE_WORLD_IMAGE must be an immutable image@sha256:digest reference');
assert(canadaImageMatch, 'RELEASE_CANADA_IMAGE must be an immutable image@sha256:digest reference');
assert(worldImageMatch[1] === canadaImageMatch[1], 'world and Canada images must share a repository');
assert(worldImageMatch[2] !== canadaImageMatch[2], 'world and Canada image digests must be distinct');

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
  ['scripts/runtime-health-check.sh', 'scripts/runtime-health-check.sh'],
  ['scripts/release-verification.mjs', 'scripts/release-verification.mjs'],
  ['scripts/verify-backup-copy.sh', 'scripts/verify-backup-copy.sh'],
  ['scripts/check-public-privacy.mjs', 'scripts/check-public-privacy.mjs'],
  ['scripts/public-privacy-retry.mjs', 'scripts/public-privacy-retry.mjs'],
  ['scripts/public-privacy-websocket.mjs', 'scripts/public-privacy-websocket.mjs'],
  ['scripts/websocket-flow-probe.mjs', 'scripts/websocket-flow-probe.mjs'],
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
  [`docs/${version}/upgrade-and-rollback.md`, 'docs/upgrade-and-rollback.md'],
  [`docs/${version}/release_notes.md`, 'docs/release-notes.md'],
  [`docs/${version}/security-and-operations.md`, 'docs/security-and-operations.md'],
  [`docs/${version}/storage-and-stability.md`, 'docs/storage-and-stability.md'],
  [`docs/${version}/validation_checklist.md`, 'docs/validation-checklist.md'],
  [`docs/${version}/release-verification.md`, 'docs/release-verification.md'],
  ['docs/privacy.md', 'docs/privacy.md'],
  ['docs/public-api.openapi.json', 'docs/public-api.openapi.json']
];
for (const [source, target] of files) {
  const targetPath = join(stage, target);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(join(root, source), targetPath);
}

const manifest = {
  manifestVersion: 2,
  application: 'MC-CartoLive',
  version,
  tag: `v${version}`,
  gitSha,
  buildTime,
  images: {
    world: {
      repository: worldImageMatch[1],
      digest: worldImageMatch[2],
      reference: worldImage,
      assetPack: 'world',
      tags: [version, version.split('.').slice(0, 2).join('.'), `sha-${gitSha}`, 'latest'],
      platforms: ['linux/amd64', 'linux/arm64']
    },
    canada: {
      repository: canadaImageMatch[1],
      digest: canadaImageMatch[2],
      reference: canadaImage,
      assetPack: 'canada',
      tags: [`${version}-canada`, `${version.split('.').slice(0, 2).join('.')}-canada`, `sha-${gitSha}-canada`, 'latest-canada'],
      platforms: ['linux/amd64', 'linux/arm64']
    }
  },
  database: {
    schemaVersion,
    deploymentPolicy: 'preserve_database_default',
    retentionDays: 7,
    publicEventRetentionHours: 24,
    historicalDataRecovery: true,
    historicalDataRecoveryMethod: 'operator_block_volume_backup'
  },
  releaseIdentity: 'compiled_immutable',
  operations: {
    postReleaseAudit: {
      phases: ['5m'],
      systemdTimer: 'mc-cartolive-release-audit.timer',
      privacySafeAggregateEvidence: true,
      integritySource: 'consistent_sqlite_backup'
    },
    publication: {
      minimumCanarySeconds: 300,
      minimumAcceptedMessages: 1000,
      releaseVerificationRequired: true
    }
  },
  hostPrerequisites: {
    standardDigestDeploy: [
      'verified_offhost_backup_copy',
      'redundant_local_backup_removed',
      'minimum_9_gib_and_20_percent_free',
      'separate_audit_snapshot_filesystem'
    ],
    destructiveFreshDatabase: {
      nodeMinMajor: 18,
      purpose: 'credential_free_public_privacy_and_websocket_hello_gate'
    }
  },
  publicApi: 'docs/public-api.openapi.json',
  attestations: {
    images: {
      world: `oci://${worldImage}`,
      canada: `oci://${canadaImage}`
    },
    releaseAssets: `https://github.com/n30nex/MC-CartoLive/attestations`
  }
};
const manifestJSON = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync(join(outputRoot, 'release-manifest.json'), manifestJSON);
writeFileSync(join(stage, 'release-manifest.json'), manifestJSON);
writeFileSync(join(stage, 'README.txt'), `MC-CartoLive ${version} deployment bundle

This package deploys the prebuilt image by immutable digest. It does not build
on the target host. Read docs/upgrade-and-rollback.md before running anything.

The hosted ${version} cutover preserves and transactionally migrates the existing
SQLite database. Take and verify an off-root-disk backup before deployment and
omit all destructive fresh-database flags. The destructive mode remains an
explicit operator tool but is not the hosted ${version} procedure.

World image: ${worldImage}
Canada hosted image: ${canadaImage}
Git SHA: ${gitSha}
Schema: ${schemaVersion}

Before cutover, mount a separate filesystem at
/mnt/mc-cartolive-audit-snapshots, then install and enable
deploy/systemd/mc-cartolive-release-audit.timer. Hourly checks avoid SQLite;
the five-minute gate runs integrity against a consistent temporary backup. It
records privacy-safe final evidence without exporting
database rows or runtime secrets. See docs/storage-and-stability.md.

Node.js 18 or newer is staged on the hosted system for the bundled
credential-free public privacy and WebSocket-hello validation. The deploy does
not install packages.
`);

console.log(JSON.stringify({ version, images: { world: worldImage, canada: canadaImage }, gitSha, schemaVersion, stage, manifest: join(outputRoot, 'release-manifest.json') }, null, 2));

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
