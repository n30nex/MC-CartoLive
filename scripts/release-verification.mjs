#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(String(args.input ?? 'release-verification.json'));
const outputPath = args.output ? path.resolve(String(args.output)) : '';
const document = JSON.parse(readFileSync(inputPath, 'utf8'));
const errors = [];

const expect = {
  version: String(args['expect-version'] ?? readFileSync(path.join(root, 'VERSION'), 'utf8').trim()),
  gitSha: optional(args['expect-git-sha']),
  candidateRunId: optionalInteger(args['expect-candidate-run-id']),
  candidateRunAttempt: optionalInteger(args['expect-candidate-run-attempt']),
  worldDigest: optional(args['expect-world-digest']),
  canadaDigest: optional(args['expect-canada-digest']),
  deployedAt: optional(args['expect-deployed-at']),
  premergePerformanceRunId: optionalInteger(args['expect-premerge-performance-run-id']),
  premergePerformanceSha: optional(args['expect-premerge-performance-sha']),
  mainPerformanceRunId: optionalInteger(args['expect-main-performance-run-id']),
  browserRunId: optionalInteger(args['expect-browser-run-id']),
};

check(document && typeof document === 'object' && !Array.isArray(document), 'document must be an object');
check(document.formatVersion === 1, 'formatVersion must be 1');

const release = objectAt(document, 'release');
check(release.version === expect.version, `release.version must be ${expect.version}`);
check(/^[0-9a-f]{40}$/.test(release.gitSha ?? ''), 'release.gitSha must be a full lowercase Git SHA');
check(integer(release.candidateRunId) > 0, 'release.candidateRunId must be a positive integer');
check(integer(release.candidateRunAttempt) > 0, 'release.candidateRunAttempt must be a positive integer');
checkDigest(release.worldDigest, 'release.worldDigest');
checkDigest(release.canadaDigest, 'release.canadaDigest');
check(release.worldDigest !== release.canadaDigest, 'world and Canada digests must differ');
checkRFC3339(release.deployedAt, 'release.deployedAt');

const performance = objectAt(document, 'performance');
validatePerformanceProof(objectAt(performance, 'releaseBranch'), 'performance.releaseBranch', release.gitSha, false);
validatePerformanceProof(objectAt(performance, 'mergedMain'), 'performance.mergedMain', release.gitSha, true);

const browser = objectAt(document, 'browser');
check(integer(browser.workflowRunId) > 0, 'browser.workflowRunId must be a positive integer');
check(number(browser.receiveToStateP95Ms) >= 0 && number(browser.receiveToStateP95Ms) < 1000, 'browser.receiveToStateP95Ms must be below 1000');
check(number(browser.receiveToAnimationP95Ms) >= 0 && number(browser.receiveToAnimationP95Ms) < 2000, 'browser.receiveToAnimationP95Ms must be below 2000');
check(number(browser.maxVisualAgeMs) >= 0 && number(browser.maxVisualAgeMs) <= 5000, 'browser.maxVisualAgeMs must be at most 5000');
check(integer(browser.eligibleAnimations) >= 0, 'browser.eligibleAnimations must be a non-negative integer');
check(integer(browser.animationStarts) === integer(browser.eligibleAnimations), 'browser.animationStarts must equal eligibleAnimations');
check(integer(browser.animationLoss) === 0, 'browser.animationLoss must be zero');
check(integer(browser.emergencyActivations) === 0, 'browser.emergencyActivations must be zero');
check(number(browser.frameP95Ms) >= 0 && number(browser.frameP95Ms) <= 34, 'browser.frameP95Ms must be at most 34');
check(integer(browser.repeatedLongTasks) === 0, 'browser.repeatedLongTasks must be zero');

const canary = objectAt(document, 'canary');
for (const [name, minimumAgeSeconds] of [['5m', 300]]) {
  const checkpoint = objectAt(canary, name);
  check(checkpoint.passed === true, `canary.${name}.passed must be true`);
  checkRFC3339(checkpoint.completedAt, `canary.${name}.completedAt`);
  const ageSeconds = (Date.parse(checkpoint.completedAt) - Date.parse(release.deployedAt)) / 1000;
  check(ageSeconds >= minimumAgeSeconds, `canary.${name} must be completed at least ${minimumAgeSeconds} seconds after deployment`);
  for (const counter of ['acceptedDelta', 'processedDelta', 'publicEventDelta']) {
    check(integer(checkpoint[counter]) >= 0, `canary.${name}.${counter} must be a non-negative integer`);
  }
  for (const counter of ['writeFailures', 'deadlineFailures', 'primaryDrops', 'derivedDrops', 'animationLoss', 'emergencyActivations', 'restarts', 'oomKills']) {
    check(integer(checkpoint[counter]) === 0, `canary.${name}.${counter} must be zero`);
  }
}
check(integer(canary['5m']?.acceptedDelta) >= 1000, 'canary.5m.acceptedDelta must be at least 1000');
check(integer(canary['5m']?.processedDelta) >= 1000, 'canary.5m.processedDelta must be at least 1000');

const audit = objectAt(document, 'audit');
check(audit.phase === '5m', 'audit.phase must be 5m');
check(audit.passed === true, 'audit.passed must be true');
checkSha256(audit.resultSha256, 'audit.resultSha256');
check(audit.snapshotIntegrityCheck === 'ok', 'audit.snapshotIntegrityCheck must be ok');
check(audit.snapshotForeignKeyCheck === 'ok', 'audit.snapshotForeignKeyCheck must be ok');
checkSha256(audit.snapshotSha256, 'audit.snapshotSha256');
checkSha256(audit.backupVerificationSha256, 'audit.backupVerificationSha256');
check(integer(audit.schemaVersion) === 32000, 'audit.schemaVersion must remain 32000');
check(number(audit.freeGiB) >= 9, 'audit.freeGiB must be at least 9');
check(number(audit.freePercent) >= 20, 'audit.freePercent must be at least 20');

matchExpected(release.gitSha, expect.gitSha, 'release.gitSha');
matchExpected(integer(release.candidateRunId), expect.candidateRunId, 'release.candidateRunId');
matchExpected(integer(release.candidateRunAttempt), expect.candidateRunAttempt, 'release.candidateRunAttempt');
matchExpected(release.worldDigest, expect.worldDigest, 'release.worldDigest');
matchExpected(release.canadaDigest, expect.canadaDigest, 'release.canadaDigest');
matchExpected(release.deployedAt, expect.deployedAt, 'release.deployedAt');
matchExpected(integer(performance.releaseBranch?.workflowRunId), expect.premergePerformanceRunId, 'performance.releaseBranch.workflowRunId');
matchExpected(performance.releaseBranch?.gitSha, expect.premergePerformanceSha, 'performance.releaseBranch.gitSha');
matchExpected(integer(performance.mergedMain?.workflowRunId), expect.mainPerformanceRunId, 'performance.mergedMain.workflowRunId');
matchExpected(integer(browser.workflowRunId), expect.browserRunId, 'browser.workflowRunId');

if (errors.length > 0) {
  for (const error of errors) console.error(`release verification: ${error}`);
  process.exit(1);
}

const canonical = `${JSON.stringify(document, null, 2)}\n`;
if (outputPath) writeFileSync(outputPath, canonical);
console.log(JSON.stringify({ passed: true, input: inputPath, output: outputPath || null, version: release.version, gitSha: release.gitSha }, null, 2));

function validatePerformanceProof(proof, name, mergedSha, requireMergedSha) {
  check(integer(proof.workflowRunId) > 0, `${name}.workflowRunId must be a positive integer`);
  check(/^[0-9a-f]{40}$/.test(proof.gitSha ?? ''), `${name}.gitSha must be a full lowercase Git SHA`);
  check(proof.profile === 'full', `${name}.profile must be full`);
  check(proof.canonicalReleaseProof === true, `${name}.canonicalReleaseProof must be true`);
  check(proof.passed === true, `${name}.passed must be true`);
  if (requireMergedSha) check(proof.gitSha === mergedSha, `${name}.gitSha must match the merged main SHA`);
}

function objectAt(parent, key) {
  const value = parent?.[key];
  check(value && typeof value === 'object' && !Array.isArray(value), `${key} must be an object`);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function matchExpected(actual, expected, name) {
  if (expected !== undefined) check(actual === expected, `${name} does not match trusted workflow evidence`);
}

function checkDigest(value, name) {
  check(/^sha256:[0-9a-f]{64}$/.test(value ?? ''), `${name} must be a sha256 digest`);
}

function checkSha256(value, name) {
  check(/^[0-9a-f]{64}$/.test(value ?? ''), `${name} must be a lowercase SHA-256 value`);
}

function checkRFC3339(value, name) {
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value ?? '') && !Number.isNaN(Date.parse(value)), `${name} must be RFC3339 UTC without fractional seconds`);
}

function integer(value) {
  return Number.isInteger(Number(value)) ? Number(value) : Number.NaN;
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : Number.NaN;
}

function optional(value) {
  return value === undefined ? undefined : String(value);
}

function optionalInteger(value) {
  return value === undefined ? undefined : integer(value);
}

function check(condition, message) {
  if (!condition) errors.push(message);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument ${token}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${token}`);
    parsed[name] = value;
    index += 1;
  }
  return parsed;
}
