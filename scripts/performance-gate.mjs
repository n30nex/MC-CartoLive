#!/usr/bin/env node

import { createWriteStream, promises as fs } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(repoRoot, 'backend');
const artifactDir = path.join(repoRoot, 'artifacts', 'performance-gate');
const profileName = argumentValue('--profile') ?? process.env.PERF_PROFILE ?? 'full';
if (!['full', 'smoke'].includes(profileName)) {
  throw new Error(`unsupported profile ${JSON.stringify(profileName)}; use full or smoke`);
}
if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('the 3.2.0 performance gate is GitHub-Actions-only; dispatch the Release performance gate workflow');
}

const defaults = profileName === 'full'
  ? {
      sustainedRate: 20,
      sustainedSeconds: 30 * 60,
      burstRate: 100,
      burstSeconds: 60,
      apiRows: 5_000_000,
      apiPathRows: 10_000,
      apiEvents: 20_000,
      apiSamples: 200,
      wsClients: 250,
      wsSeconds: 30 * 60,
      wsQuietSeconds: 70,
      wsIsolationEvents: 1000,
      wsIsolationRate: 100,
      wsIsolationBytes: 4096,
    }
  : {
      sustainedRate: 20,
      sustainedSeconds: 8,
      burstRate: 100,
      burstSeconds: 3,
      apiRows: 50_000,
      apiPathRows: 1000,
      apiEvents: 2000,
      apiSamples: 20,
      wsClients: 25,
      wsSeconds: 15,
      wsQuietSeconds: 3,
      wsIsolationEvents: 400,
      wsIsolationRate: 100,
      wsIsolationBytes: 8192,
    };

const config = {
  sustainedRate: envNumber('PERF_SUSTAIN_RATE', defaults.sustainedRate),
  sustainedSeconds: envNumber('PERF_SUSTAIN_SECONDS', defaults.sustainedSeconds),
  burstRate: envNumber('PERF_BURST_RATE', defaults.burstRate),
  burstSeconds: envNumber('PERF_BURST_SECONDS', defaults.burstSeconds),
  apiRows: envNumber('PERF_API_ROWS', defaults.apiRows),
  apiPathRows: envNumber('PERF_API_PATH_ROWS', defaults.apiPathRows),
  apiEvents: envNumber('PERF_API_EVENTS', defaults.apiEvents),
  apiSamples: envNumber('PERF_API_SAMPLES', defaults.apiSamples),
  wsClients: envNumber('PERF_WS_CLIENTS', defaults.wsClients),
  wsSeconds: envNumber('PERF_WS_SECONDS', defaults.wsSeconds),
  wsQuietSeconds: envNumber('PERF_WS_QUIET_SECONDS', defaults.wsQuietSeconds),
  wsIsolationEvents: envNumber('PERF_WS_ISOLATION_EVENTS', defaults.wsIsolationEvents),
  wsIsolationRate: envNumber('PERF_WS_ISOLATION_RATE', defaults.wsIsolationRate),
  wsIsolationBytes: envNumber('PERF_WS_ISOLATION_BYTES', defaults.wsIsolationBytes),
  mqttQueueCapacity: envNumber('PERF_MQTT_QUEUE_CAPACITY', 4096),
  derivedQueueCapacity: envNumber('PERF_DERIVED_QUEUE_CAPACITY', 8192),
  metricSampleMs: envNumber('PERF_METRIC_SAMPLE_MS', 250),
  memoryLimitBytes: envNumber('PERF_MEMORY_LIMIT_BYTES', 600 * 1024 * 1024),
};

const canonicalFullConfig = {
  ...defaults,
  mqttQueueCapacity: 4096,
  derivedQueueCapacity: 8192,
  metricSampleMs: 250,
  memoryLimitBytes: 600 * 1024 * 1024,
};
const fullConfigDeviations = profileName === 'full'
  ? Object.entries(canonicalFullConfig)
      .filter(([key, value]) => config[key] !== value)
      .map(([key, value]) => `${key}=${config[key]} (required ${value})`)
  : [];

const report = {
  version: '3.2.0',
  profile: profileName,
  canonicalReleaseProof: profileName === 'full' && fullConfigDeviations.length === 0,
  startedAt: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, node: process.version },
  github: {
    sha: process.env.GITHUB_SHA ?? '',
    ref: process.env.GITHUB_REF ?? '',
    runId: process.env.GITHUB_RUN_ID ?? '',
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? '',
  },
  config,
  thresholds: {
    queueOldestP99Ms: '< 2000',
    queueOccupancyMax: '< 0.75',
    memorySysP95Bytes: `< ${config.memoryLimitBytes}`,
    goroutineGrowth: '<= 0',
    cachedStateOriginP95Ms: '< 50',
    publicPathP95Ms: '< 300',
    retainedResumeP95Ms: '< 100',
    cursorResetP95Ms: '< 50',
    bootstrapGzipBytes: '<= 153600',
    stateGzipBytes: '<= 409600',
  },
  phases: {},
  failures: [],
};

let tempRoot;
let binaries;
let httpAgent;

try {
  await fs.mkdir(artifactDir, { recursive: true });
  if (fullConfigDeviations.length > 0) {
    throw new Error(`full release proof requires the locked configuration: ${fullConfigDeviations.join(', ')}`);
  }
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-cartolive-perf-'));
  binaries = await prepareBinaries(tempRoot);
  httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8 });

  await capturePhase('sustainedIngest', () => runIngestPhase(
    'sustained',
    config.sustainedRate,
    config.sustainedSeconds,
  ));
  await capturePhase('burstIngest', () => runIngestPhase(
    'burst',
    config.burstRate,
    config.burstSeconds,
  ));
  await capturePhase('api', runAPIPhase);
  await capturePhase('websocket', runWebSocketPhase);
} catch (error) {
  report.failures.push(`gate setup: ${errorMessage(error)}`);
} finally {
  httpAgent?.destroy();
  report.finishedAt = new Date().toISOString();
  report.passed = report.failures.length === 0;
  await writeReport();
  if (tempRoot && process.env.PERF_KEEP_TEMP !== '1') {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  } else if (tempRoot) {
    report.tempRoot = tempRoot;
    await writeReport();
  }
}

console.log(JSON.stringify({
  passed: report.passed,
  profile: report.profile,
  report: path.join(artifactDir, 'report.json'),
  failures: report.failures,
}, null, 2));
if (!report.passed) process.exitCode = 1;

async function capturePhase(name, run) {
  try {
    const phase = await run();
    report.phases[name] = phase;
    for (const failure of phase.failures ?? []) {
      report.failures.push(`${name}: ${failure}`);
    }
  } catch (error) {
    const message = errorMessage(error);
    report.phases[name] = { passed: false, failures: [message] };
    report.failures.push(`${name}: ${message}`);
  }
  await writeReport();
}

async function runIngestPhase(label, rate, durationSeconds) {
  const expected = Math.round(rate * durationSeconds);
  const phaseDir = path.join(tempRoot, `ingest-${label}`);
  await fs.mkdir(phaseDir, { recursive: true });
  const fixturePath = path.join(phaseDir, 'fixture.ndjson');
  const dbPath = path.join(phaseDir, 'ingest.db');
  await createPacketFixture(fixturePath, expected);
  const publicPort = await freePort();
  const metricsPort = await freePort();
  const app = spawnApp(label, appEnvironment({
    dbPath,
    publicPort,
    metricsPort,
    fixturePath,
    fixtureRate: rate,
    fixtureStartDelayMs: 3000,
  }));
  const samples = [];
  const wallStarted = Date.now();
  let finalMetrics;
  let firstAcceptedAt = 0;
  let completedAt = 0;
  try {
    await waitForHTTP(`http://127.0.0.1:${metricsPort}/metrics`, 60_000, app);
    const deadline = wallStarted + 3000 + durationSeconds * 1600 + 120_000;
    while (Date.now() < deadline) {
      ensureRunning(app);
      const metrics = await fetchMetrics(metricsPort);
      const at = Date.now();
      samples.push({ at, ...metrics });
      const accepted = metric(metrics, 'meshcore_mqtt_messages_accepted_total');
      const processed = metric(metrics, 'meshcore_mqtt_messages_processed_total');
      const derivedDepth = metric(metrics, 'meshcore_derived_queue_depth');
      if (accepted > 0 && firstAcceptedAt === 0) firstAcceptedAt = at;
      if (accepted >= expected && processed >= expected && derivedDepth === 0) {
        completedAt = at;
        finalMetrics = metrics;
        break;
      }
      await sleep(config.metricSampleMs);
    }
    if (!finalMetrics) {
      finalMetrics = await fetchMetrics(metricsPort).catch(() => ({}));
    }
  } finally {
    await stopApp(app);
  }

  const dbStats = await runJSONTool(binaries.perfseed, [
    '-mode', 'count', '-db', dbPath,
  ]);
  const oldest = samples.map((sample) => metric(sample, 'meshcore_mqtt_queue_oldest_item_age_ms'));
  const occupancies = samples.map((sample) => metric(sample, 'meshcore_mqtt_queue_depth') / config.mqttQueueCapacity);
  const memory = samples.map((sample) => metric(sample, 'meshcore_memory_sys_bytes'));
  const baselineGoroutines = median(samples
    .filter((sample) => metric(sample, 'meshcore_mqtt_messages_accepted_total') === 0)
    .map((sample) => metric(sample, 'meshcore_goroutines')));
  const finalGoroutines = metric(finalMetrics, 'meshcore_goroutines');
  const activeSeconds = firstAcceptedAt > 0 && completedAt >= firstAcceptedAt
    ? (completedAt - firstAcceptedAt) / 1000
    : 0;
  const achievedRate = activeSeconds > 0 ? expected / activeSeconds : 0;
  const result = {
    passed: false,
    configuredRatePerSecond: rate,
    configuredDurationSeconds: durationSeconds,
    expectedMessages: expected,
    wallDurationSeconds: (Date.now() - wallStarted) / 1000,
    activeDurationSeconds: activeSeconds,
    achievedRatePerSecond: achievedRate,
    acceptedMessages: metric(finalMetrics, 'meshcore_mqtt_messages_accepted_total'),
    processedMessages: metric(finalMetrics, 'meshcore_mqtt_messages_processed_total'),
    primaryDrops: metric(finalMetrics, 'meshcore_mqtt_messages_dropped_total'),
    derivedDrops: metric(finalMetrics, 'meshcore_derived_dropped_total'),
    duplicateSuppressions: metric(finalMetrics, 'meshcore_ingest_duplicate_suppressions_total'),
    queueOldestP99Ms: percentile(oldest, 0.99),
    queueOccupancyMax: Math.max(0, ...occupancies),
    memorySysP95Bytes: percentile(memory, 0.95),
    goroutinesBaseline: baselineGoroutines,
    goroutinesFinal: finalGoroutines,
    goroutineGrowth: finalGoroutines - baselineGoroutines,
    storeWriteFailures: metric(finalMetrics, 'meshcore_store_write_failures_total'),
    storeBusyErrors: metric(finalMetrics, 'meshcore_store_write_busy_errors_total'),
    storeFullErrors: metric(finalMetrics, 'meshcore_store_write_full_errors_total'),
    database: dbStats,
    sampleCount: samples.length,
    failures: [],
  };
  check(result, result.acceptedMessages === expected, `accepted=${result.acceptedMessages}, want ${expected}`);
  check(result, result.processedMessages === expected, `processed=${result.processedMessages}, want ${expected}`);
  check(result, result.primaryDrops === 0, `primary queue drops=${result.primaryDrops}`);
  check(result, result.derivedDrops === 0, `derived queue drops=${result.derivedDrops}`);
  check(result, result.duplicateSuppressions === 0, `retry duplicate suppressions=${result.duplicateSuppressions}`);
  check(result, dbStats.observationRows === expected, `observation rows=${dbStats.observationRows}, want ${expected}`);
  check(result, dbStats.nonEmptyIngestIds === expected, `non-empty ingest IDs=${dbStats.nonEmptyIngestIds}, want ${expected}`);
  check(result, dbStats.uniqueIngestIds === expected, `unique ingest IDs=${dbStats.uniqueIngestIds}, want ${expected}`);
  check(result, result.queueOldestP99Ms < 2000, `queue oldest p99=${result.queueOldestP99Ms}ms, must be <2000ms`);
  check(result, result.queueOccupancyMax < 0.75, `queue occupancy max=${result.queueOccupancyMax}, must be <0.75`);
  check(result, result.memorySysP95Bytes < config.memoryLimitBytes, `memory sys p95=${result.memorySysP95Bytes}, limit=${config.memoryLimitBytes}`);
  check(result, result.goroutineGrowth <= 0, `goroutines grew by ${result.goroutineGrowth}`);
  check(result, result.storeWriteFailures === 0, `store write failures=${result.storeWriteFailures}`);
  check(result, result.storeBusyErrors === 0, `store busy errors=${result.storeBusyErrors}`);
  check(result, result.storeFullErrors === 0, `store full errors=${result.storeFullErrors}`);
  check(result, achievedRate >= rate * 0.95, `achieved rate=${achievedRate.toFixed(2)}/s, need >=${(rate * 0.95).toFixed(2)}/s`);
  result.passed = result.failures.length === 0;
  return result;
}

async function runAPIPhase() {
  const phaseDir = path.join(tempRoot, 'api');
  await fs.mkdir(phaseDir, { recursive: true });
  const dbPath = path.join(phaseDir, 'api.db');
  const seed = await runJSONTool(binaries.perfseed, [
    '-mode', 'seed',
    '-fresh',
    '-db', dbPath,
    '-observations', String(config.apiRows),
    '-paths', String(config.apiPathRows),
    '-events', String(config.apiEvents),
  ], 90 * 60_000);
  const publicPort = await freePort();
  const metricsPort = await freePort();
  const app = spawnApp('api', appEnvironment({ dbPath, publicPort, metricsPort }));
  const baseURL = `http://127.0.0.1:${publicPort}`;
  const allResponses = [];
  let ipSequence = 1;
  try {
    await waitForHTTP(`${baseURL}/healthz`, 120_000, app);
    await waitUntil(async () => {
      ensureRunning(app);
      const response = await request(`${baseURL}/api/v1/public/state`, apiHeaders(ipSequence++));
      allResponses.push(response);
      return response.status === 200;
    }, 120_000, 500);

    // Warm all measured paths before collecting origin latency.
    for (let i = 0; i < 5; i++) {
      for (const route of ['/api/v1/public/state', '/api/v1/public/bootstrap', '/api/v1/public/events?afterSeq=0']) {
        const response = await request(baseURL + route, apiHeaders(ipSequence++));
        allResponses.push(response);
      }
    }

    const resetProbe = await request(`${baseURL}/api/v1/public/events?afterSeq=0`, apiHeaders(ipSequence++));
    allResponses.push(resetProbe);
    const resetJSON = decodeJSON(resetProbe);
    const oldestSeq = Number(resetJSON.oldestSeq ?? 0);
    const latestSeq = Number(resetJSON.latestSeq ?? 0);
    const now = Date.now();
    const routes = {
      cachedState: '/api/v1/public/state',
      publicPath: `/api/v1/public/packets?from=${now - 3_600_000}&to=${now}&limit=100`,
      retainedResume: `/api/v1/public/events?afterSeq=${Math.max(oldestSeq, 1)}&limit=100`,
      cursorReset: '/api/v1/public/events?afterSeq=0',
    };
    const timings = Object.fromEntries(Object.keys(routes).map((key) => [key, []]));
    for (let i = 0; i < config.apiSamples; i++) {
      for (const [name, route] of Object.entries(routes)) {
        const response = await request(baseURL + route, apiHeaders(ipSequence++));
        allResponses.push(response);
        timings[name].push(response.durationMs);
        if (response.status !== 200) {
          throw new Error(`${name} returned HTTP ${response.status}`);
        }
      }
    }
    const bootstrap = await request(`${baseURL}/api/v1/public/bootstrap`, apiHeaders(ipSequence++));
    const state = await request(`${baseURL}/api/v1/public/state`, apiHeaders(ipSequence++));
    allResponses.push(bootstrap, state);
    const bootstrapGzipBytes = gzipSize(bootstrap);
    const stateGzipBytes = gzipSize(state);
    const result = {
      passed: false,
      seeded: seed,
      oldestSeq,
      latestSeq,
      resetRequired: resetJSON.resetRequired === true,
      samplesPerRoute: config.apiSamples,
      cachedStateOriginP95Ms: percentile(timings.cachedState, 0.95),
      publicPathP95Ms: percentile(timings.publicPath, 0.95),
      retainedResumeP95Ms: percentile(timings.retainedResume, 0.95),
      cursorResetP95Ms: percentile(timings.cursorReset, 0.95),
      bootstrapGzipBytes,
      stateGzipBytes,
      responseCount: allResponses.length,
      serverErrors: allResponses.filter((response) => response.status >= 500).length,
      failures: [],
    };
    check(result, seed.observationRows >= config.apiRows, `seeded observations=${seed.observationRows}, need >=${config.apiRows}`);
    check(result, resetProbe.status === 200 && result.resetRequired, `afterSeq=0 reset contract failed: HTTP ${resetProbe.status}`);
    check(result, oldestSeq > 0 && latestSeq >= oldestSeq, `invalid retained event bounds ${oldestSeq}..${latestSeq}`);
    check(result, result.cachedStateOriginP95Ms < 50, `cached state p95=${result.cachedStateOriginP95Ms}ms, must be <50ms`);
    check(result, result.publicPathP95Ms < 300, `public path p95=${result.publicPathP95Ms}ms, must be <300ms`);
    check(result, result.retainedResumeP95Ms < 100, `retained resume p95=${result.retainedResumeP95Ms}ms, must be <100ms`);
    check(result, result.cursorResetP95Ms < 50, `cursor reset p95=${result.cursorResetP95Ms}ms, must be <50ms`);
    check(result, result.serverErrors === 0, `HTTP 5xx responses=${result.serverErrors}`);
    check(result, bootstrap.status === 200 && bootstrapGzipBytes <= 150 * 1024, `bootstrap gzip=${bootstrapGzipBytes} bytes, limit=${150 * 1024}`);
    check(result, state.status === 200 && stateGzipBytes <= 400 * 1024, `state gzip=${stateGzipBytes} bytes, limit=${400 * 1024}`);
    result.passed = result.failures.length === 0;
    return result;
  } finally {
    await stopApp(app);
  }
}

async function runWebSocketPhase() {
  const { value, exitCode, stderr } = await runJSONToolAllowFailure(binaries.perfws, [
    '-clients', String(config.wsClients),
    '-duration', `${config.wsSeconds}s`,
    '-quiet', `${config.wsQuietSeconds}s`,
    '-queue', '64',
    '-isolation-events', String(config.wsIsolationEvents),
    '-isolation-rate', String(config.wsIsolationRate),
    '-isolation-bytes', String(config.wsIsolationBytes),
  ], (config.wsSeconds + 120) * 1000);
  if (!value) throw new Error(`perfws exited ${exitCode}: ${stderr}`);
  value.exitCode = exitCode;
  value.failures ??= [];
  if (exitCode !== 0 && value.failures.length === 0) {
    value.failures.push(`perfws exited ${exitCode}: ${stderr}`);
  }
  value.passed = exitCode === 0 && value.failures.length === 0;
  return value;
}

function appEnvironment({ dbPath, publicPort, metricsPort, fixturePath = '', fixtureRate = 0, fixtureStartDelayMs = 0 }) {
  return {
    ...process.env,
    LISTEN_ADDR: `127.0.0.1:${publicPort}`,
    METRICS_LISTEN_ADDR: `127.0.0.1:${metricsPort}`,
    PUBLIC_BASE_URL: `http://127.0.0.1:${publicPort}`,
    DATA_DIR: path.dirname(dbPath),
    DB_PATH: dbPath,
    CONFIG_YAML: path.join(path.dirname(dbPath), 'no-operator-config.yaml'),
    MQTT_ENABLED: 'false',
    PUBLIC_MODE: 'true',
    MAP_REGION_PRESET: 'canada',
    PUBLIC_REGIONS: 'YYZ',
    DATA_RETENTION_DAYS: '7',
    PUBLIC_EVENT_RETENTION_HOURS: '24',
    MQTT_INGEST_QUEUE_SIZE: String(config.mqttQueueCapacity),
    DERIVED_INGEST_QUEUE_SIZE: String(config.derivedQueueCapacity),
    PUBLIC_PACKET_PATH_BACKFILL_ENABLED: 'false',
    PUBLIC_CACHE_REFRESH_SECONDS: '10',
    PROPAGATION_ENABLED: 'false',
    RECENT_PACKET_LIMIT: '200',
    RECENT_EDGE_EVENT_LIMIT: '200',
    TRUST_PROXY_HEADERS: 'true',
    TRUSTED_PROXY_CIDRS: '127.0.0.0/8,::1/128',
    LOG_LEVEL: 'warn',
    FIXTURE_REPLAY_PATH: fixturePath,
    FIXTURE_REPLAY_RATE_PER_SECOND: String(fixtureRate),
    FIXTURE_REPLAY_START_DELAY_MS: String(fixtureStartDelayMs),
  };
}

async function prepareBinaries(root) {
  const extension = process.platform === 'win32' ? '.exe' : '';
  const binDir = path.join(root, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  const definitions = {
    app: { env: 'PERF_APP_BIN', pkg: './cmd/app' },
    perfseed: { env: 'PERF_SEED_BIN', pkg: './cmd/perfseed' },
    perfws: { env: 'PERF_WS_BIN', pkg: './cmd/perfws' },
  };
  const result = {};
  for (const [name, definition] of Object.entries(definitions)) {
    if (process.env[definition.env]) {
      result[name] = path.resolve(process.env[definition.env]);
      continue;
    }
    const output = path.join(binDir, name + extension);
    const built = await runProcess('go', ['build', '-trimpath', '-o', output, definition.pkg], {
      cwd: backendDir,
      timeoutMs: 10 * 60_000,
    });
    if (built.exitCode !== 0) throw new Error(`build ${definition.pkg}: ${built.stderr}`);
    result[name] = output;
  }
  return result;
}

function spawnApp(label, env) {
  const logPath = path.join(artifactDir, `${label}.log`);
  const logStream = createWriteStream(logPath, { flags: 'w' });
  const child = spawn(binaries.app, [], {
    cwd: backendDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let tail = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      logStream.write(chunk);
      tail = (tail + chunk.toString('utf8')).slice(-12_000);
    });
  }
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  return { child, exited, logStream, logPath, get tail() { return tail; } };
}

async function stopApp(app) {
  if (app.child.exitCode === null && app.child.signalCode === null) {
    app.child.kill('SIGTERM');
    await Promise.race([app.exited, sleep(10_000)]);
  }
  if (app.child.exitCode === null && app.child.signalCode === null) {
    app.child.kill('SIGKILL');
    await Promise.race([app.exited, sleep(5_000)]);
  }
  await new Promise((resolve) => app.logStream.end(resolve));
}

function ensureRunning(app) {
  if (app.child.exitCode !== null || app.child.signalCode !== null) {
    throw new Error(`application exited early; log=${app.logPath}\n${app.tail}`);
  }
}

async function createPacketFixture(destination, count) {
  const fixture = await fs.readFile(path.join(repoRoot, 'examples', 'fixtures', 'synthetic-live.ndjson'), 'utf8');
  const packet = fixture.split(/\r?\n/).find((line) => line.includes('/packets"'));
  if (!packet) throw new Error('synthetic fixture has no packet line');
  await fs.writeFile(destination, `${packet}\n`.repeat(count), 'utf8');
}

async function fetchMetrics(port) {
  const response = await request(`http://127.0.0.1:${port}/metrics`, { Accept: 'text/plain' });
  if (response.status !== 200) throw new Error(`metrics returned HTTP ${response.status}`);
  const text = response.body.toString('utf8');
  const metrics = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+([-+0-9.eE]+)$/.exec(line.trim());
    if (match) metrics[match[1]] = Number(match[2]);
  }
  return metrics;
}

function metric(sample, name) {
  const value = Number(sample?.[name] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function apiHeaders(sequence) {
  const third = Math.floor(sequence / 250) % 250;
  const fourth = (sequence % 250) + 1;
  return {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Forwarded-For': `203.0.${third}.${fourth}`,
  };
}

async function request(url, headers = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const req = http.get(url, { headers, agent: httpAgent }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks),
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timeout after ${timeoutMs}ms: ${url}`)));
    req.on('error', reject);
  });
}

function decodeJSON(response) {
  const body = response.headers['content-encoding'] === 'gzip'
    ? gunzipSync(response.body)
    : response.body;
  return JSON.parse(body.toString('utf8'));
}

function gzipSize(response) {
  return response.headers['content-encoding'] === 'gzip'
    ? response.body.length
    : gzipSync(response.body, { level: 6 }).length;
}

async function waitForHTTP(url, timeoutMs, app) {
  await waitUntil(async () => {
    ensureRunning(app);
    const response = await request(url, {}, 2000).catch(() => null);
    return response?.status === 200;
  }, timeoutMs, 100);
}

async function waitUntil(predicate, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw lastError ?? new Error(`condition timed out after ${timeoutMs}ms`);
}

async function runJSONTool(executable, args, timeoutMs = 10 * 60_000) {
  const result = await runProcess(executable, args, { cwd: backendDir, timeoutMs });
  if (result.exitCode !== 0) {
    throw new Error(`${path.basename(executable)} exited ${result.exitCode}: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

async function runJSONToolAllowFailure(executable, args, timeoutMs) {
  const result = await runProcess(executable, args, { cwd: backendDir, timeoutMs });
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    value = null;
  }
  return { value, exitCode: result.exitCode, stderr: result.stderr };
}

async function runProcess(command, args, { cwd, env = process.env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('exit', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: exitCode ?? (signal ? 1 : 0),
        signal,
        stdout: Buffer.concat(stdout).toString('utf8').trim(),
        stderr: Buffer.concat(stderr).toString('utf8').trim(),
      });
    });
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error('failed to allocate loopback port');
  return port;
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return Number(sorted[index].toFixed(3));
}

function median(values) {
  return percentile(values, 0.5);
}

function check(result, condition, failure) {
  if (!condition) result.failures.push(failure);
}

async function writeReport() {
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function errorMessage(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
