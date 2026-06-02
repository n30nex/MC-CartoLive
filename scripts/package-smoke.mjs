#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const args = parseArgs(process.argv.slice(2));
const version = String(args.version ?? process.env.PACKAGE_SMOKE_VERSION ?? (await readVersion()));
const image = String(args.image ?? process.env.PACKAGE_SMOKE_IMAGE ?? `ghcr.io/n30nex/mc-cartolive:${version}`);
const mode = String(args.mode ?? process.env.PACKAGE_SMOKE_MODE ?? 'all');
const shouldPull = args.pull !== undefined || process.env.PACKAGE_SMOKE_PULL === '1';
const keepContainers = args.keep !== undefined || process.env.PACKAGE_SMOKE_KEEP === '1';
const privacy = args.privacy !== '0' && process.env.PACKAGE_SMOKE_PRIVACY !== '0';
const timeoutMs = Number(args['timeout-ms'] ?? process.env.PACKAGE_SMOKE_TIMEOUT_MS ?? 120_000);

const scenarios = [
  {
    name: 'synthetic',
    container: 'mc-cartolive-package-smoke-synthetic',
    port: Number(args['synthetic-port'] ?? process.env.PACKAGE_SMOKE_SYNTHETIC_PORT ?? 18082),
    preset: 'world',
    minPackets: 1,
    minNodes: 1,
    minRoutes: 1,
    env: {
      MQTT_ENABLED: 'false',
      PUBLIC_MODE: 'true',
      MAP_REGION_PRESET: 'world',
      PUBLIC_BASE_URL: null,
      FIXTURE_REPLAY_PATH: '/app/examples/fixtures/synthetic-live.ndjson'
    }
  },
  {
    name: 'world',
    container: 'mc-cartolive-package-smoke-world',
    port: Number(args['world-port'] ?? process.env.PACKAGE_SMOKE_WORLD_PORT ?? 18083),
    preset: 'world',
    minPackets: 1,
    minNodes: 1,
    minRoutes: 1,
    requirePacketRegion: true,
    env: {
      MQTT_ENABLED: 'false',
      PUBLIC_MODE: 'true',
      MAP_REGION_PRESET: 'world',
      DEFAULT_REGION: 'r1',
      PUBLIC_BASE_URL: null,
      FIXTURE_REPLAY_PATH: '/app/examples/fixtures/worldwide-r1.ndjson'
    }
  }
].filter((scenario) => mode === 'all' || scenario.name === mode);

if (scenarios.length === 0) {
  throw new Error(`Unknown package smoke mode "${mode}". Use all, synthetic, or world.`);
}

if (shouldPull) {
  run('docker', ['pull', image], { stdio: 'inherit' });
}

const results = [];
for (const scenario of scenarios) {
  results.push(await runScenario(scenario));
}

console.log(JSON.stringify({
  image,
  version,
  mode,
  privacy,
  passed: true,
  results
}, null, 2));
console.log(`package smoke ok: ${image}`);

async function runScenario(scenario) {
  const baseUrl = `http://127.0.0.1:${scenario.port}`;
  cleanup(scenario.container);
  const envArgs = [];
  for (const [key, value] of Object.entries(scenario.env)) {
    envArgs.push('-e', `${key}=${value ?? baseUrl}`);
  }
  const runArgs = [
    'run',
    '-d',
    '--name',
    scenario.container,
    '-p',
    `${scenario.port}:8080`,
    ...envArgs,
    image
  ];
  try {
    const containerID = run('docker', runArgs).stdout.trim();
    await waitForReady(baseUrl, timeoutMs);
    const health = await getJSON(`${baseUrl}/healthz`);
    const ready = await getJSON(`${baseUrl}/readyz`);
    assert(health.ok === true, `${scenario.name}: /healthz ok was not true`);
    assert(ready.ready === true, `${scenario.name}: /readyz ready was not true`);
    assert(String(health.version) === version, `${scenario.name}: version ${health.version} did not match ${version}`);
    assert(String(ready.version) === version, `${scenario.name}: ready version ${ready.version} did not match ${version}`);
    assert(String(ready.mapRegionPreset ?? health.mapRegionPreset) === scenario.preset, `${scenario.name}: mapRegionPreset mismatch`);

    const state = await waitForPublicState(baseUrl, scenario, timeoutMs);
    assert(String(state.map?.regionPreset ?? '') === scenario.preset, `${scenario.name}: public state map preset mismatch`);

    const now = Date.now();
    const from = now - 10 * 60 * 1000;
    const history = await getJSON(`${baseUrl}/api/v1/public/history?from=${from}&to=${now}&limit=25`);
    const packets = await waitForPublicPackets(`${baseUrl}/api/v1/public/packets?from=${from}&to=${now}&limit=25`, timeoutMs);
    const chat = await getJSON(`${baseUrl}/api/v1/public/chat?from=${from}&to=${now}&limit=25`);
    assert(history.window && history.window.to >= history.window.from, `${scenario.name}: invalid history window`);
    assert(packets.window && packets.window.to >= packets.window.from, `${scenario.name}: invalid packets window`);
    assert(chat.window && chat.window.to >= chat.window.from, `${scenario.name}: invalid chat window`);
    assert((packets.packets ?? []).length > 0, `${scenario.name}: no packet paths returned`);
    if (scenario.requirePacketRegion) {
      assert(Boolean(packets.packets[0]?.region || packets.packets[0]?.iata), `${scenario.name}: packet path missing region/iata`);
    }

    if (privacy) {
      run(process.execPath, [path.join(rootDir, 'scripts', 'check-public-privacy.mjs'), baseUrl], { stdio: 'inherit' });
    }

    console.log(`[pass] package ${scenario.name} image=${image} container=${containerID.slice(0, 12)} packets=${state.stats.packets} nodes=${state.stats.activeNodes} routes=${state.stats.activeRoutes}`);
    return {
      name: scenario.name,
      baseUrl,
      version: health.version,
      gitSha: health.gitSha,
      buildTime: health.buildTime,
      packets: state.stats.packets,
      nodes: state.stats.activeNodes,
      routes: state.stats.activeRoutes,
      packetPaths: packets.packets.length,
      historyEvents: history.events?.length ?? 0,
      chatMessages: chat.messages?.length ?? 0,
      mapRegionPreset: state.map?.regionPreset
    };
  } catch (error) {
    printContainerLogs(scenario.container);
    throw error;
  } finally {
    if (!keepContainers) cleanup(scenario.container);
  }
}

async function waitForPublicState(baseUrl, scenario, timeout) {
  const deadline = Date.now() + timeout;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await getJSON(`${baseUrl}/api/v1/public/state`);
    if (
      Number(lastState.stats?.packets ?? 0) >= scenario.minPackets &&
      Number(lastState.stats?.activeNodes ?? 0) >= scenario.minNodes &&
      Number(lastState.stats?.activeRoutes ?? 0) >= scenario.minRoutes
    ) {
      return lastState;
    }
    await sleep(1000);
  }
  throw new Error(
    `${scenario.name}: public state did not reach minimum counts; last counts ` +
    `packets=${lastState?.stats?.packets ?? 'n/a'} nodes=${lastState?.stats?.activeNodes ?? 'n/a'} routes=${lastState?.stats?.activeRoutes ?? 'n/a'}`
  );
}

async function waitForPublicPackets(url, timeout) {
  const deadline = Date.now() + timeout;
  let lastPackets = null;
  while (Date.now() < deadline) {
    lastPackets = await getJSON(url);
    if ((lastPackets.packets ?? []).length > 0) return lastPackets;
    await sleep(1000);
  }
  throw new Error(`${url} did not return packet paths; last count=${lastPackets?.packets?.length ?? 'n/a'}`);
}

async function waitForReady(baseUrl, timeout) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const ready = await getJSON(`${baseUrl}/readyz`);
      if (ready.ready === true) return ready;
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/readyz${lastError ? `: ${lastError.message}` : ''}`);
}

async function getJSON(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(parsed, { headers: { accept: 'application/json' }, timeout: 10_000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
          reject(new Error(`${url} returned ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`${url} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error(`${url} timed out`));
    });
    request.on('error', reject);
    request.end();
  });
}

function cleanup(container) {
  spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8', stdio: 'ignore' });
}

function printContainerLogs(container) {
  const result = spawnSync('docker', ['logs', '--tail', '180', container], { encoding: 'utf8' });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    env: process.env
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${commandArgs.join(' ')} failed with ${result.status}${details ? `\n${details}` : ''}`);
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readVersion() {
  return (await readFile(path.join(rootDir, 'VERSION'), 'utf8')).trim();
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = rawArgs[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
