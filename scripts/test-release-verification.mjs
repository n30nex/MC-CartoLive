#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const temp = mkdtempSync(path.join(os.tmpdir(), 'mc-cartolive-release-verification-'));
const input = path.join(temp, 'input.json');
const output = path.join(temp, 'output.json');
const sha = 'a'.repeat(40);
const world = `sha256:${'b'.repeat(64)}`;
const canada = `sha256:${'c'.repeat(64)}`;

const valid = {
  formatVersion: 1,
  release: { version, gitSha: sha, candidateRunId: 41, candidateRunAttempt: 2, worldDigest: world, canadaDigest: canada, deployedAt: '2026-07-12T12:00:00Z' },
  performance: {
    releaseBranch: { workflowRunId: 31, gitSha: 'd'.repeat(40), profile: 'full', canonicalReleaseProof: true, passed: true },
    mergedMain: { workflowRunId: 32, gitSha: sha, profile: 'full', canonicalReleaseProof: true, passed: true },
  },
  browser: { workflowRunId: 33, receiveToStateP95Ms: 400, receiveToAnimationP95Ms: 1200, maxVisualAgeMs: 2100, eligibleAnimations: 2000, animationStarts: 2000, animationLoss: 0, emergencyActivations: 0, frameP95Ms: 22, repeatedLongTasks: 0 },
  canary: {
    '5m': checkpoint('2026-07-12T12:05:00Z', 1200),
  },
  audit: { phase: '5m', passed: true, resultSha256: 'e'.repeat(64), snapshotIntegrityCheck: 'ok', snapshotForeignKeyCheck: 'ok', snapshotSha256: 'f'.repeat(64), backupVerificationSha256: 'a'.repeat(64), schemaVersion: 32000, freeGiB: 10.5, freePercent: 24 },
};

try {
  writeFileSync(input, JSON.stringify(valid));
  const result = run([
    '--input', input, '--output', output,
    '--expect-version', version, '--expect-git-sha', sha,
    '--expect-candidate-run-id', '41', '--expect-candidate-run-attempt', '2',
    '--expect-world-digest', world, '--expect-canada-digest', canada,
    '--expect-deployed-at', valid.release.deployedAt,
    '--expect-premerge-performance-run-id', '31', '--expect-premerge-performance-sha', 'd'.repeat(40), '--expect-main-performance-run-id', '32', '--expect-browser-run-id', '33',
  ]);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const canonical = JSON.parse(readFileSync(output, 'utf8'));
  if (canonical.audit.schemaVersion !== 32000) throw new Error('canonical output lost schema version');

  const invalid = structuredClone(valid);
  invalid.canary['5m'].acceptedDelta = 999;
  writeFileSync(input, JSON.stringify(invalid));
  const rejected = run(['--input', input]);
  if (rejected.status === 0 || !rejected.stderr.includes('acceptedDelta must be at least 1000')) {
    throw new Error('sub-threshold five-minute canary was not rejected');
  }
  console.log('release verification contracts passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function checkpoint(completedAt, delta) {
  return { completedAt, passed: true, acceptedDelta: delta, processedDelta: delta, publicEventDelta: delta, writeFailures: 0, deadlineFailures: 0, primaryDrops: 0, derivedDrops: 0, animationLoss: 0, emergencyActivations: 0, restarts: 0, oomKills: 0 };
}

function run(arguments_) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'release-verification.mjs'), ...arguments_], { cwd: root, encoding: 'utf8' });
}
