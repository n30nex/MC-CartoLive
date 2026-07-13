#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { probeCurrentPublicTopology } from './browser-smoke-topology.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const requireFromWeb = createRequire(path.join(rootDir, 'web', 'package.json'));
const { chromium } = requireFromWeb('playwright');

const DEFAULT_BASE_URL = 'http://127.0.0.1:39476';
const DEFAULT_OUTPUT_DIR = path.join(rootDir, 'artifacts', 'browser-smoke');
const appVersion = readFileSync(path.join(rootDir, 'VERSION'), 'utf8').trim();
const RELEASE_GATE_THRESHOLDS = Object.freeze({
  listenerGrowth: 16,
  instrumentedListenerGrowth: 64,
  intervalGrowth: 3,
  timeoutGrowth: 16,
  animationFrameGrowth: 6,
  domNodeGrowth: 240,
  retainedDomNodeGrowth: 900,
  heapGrowthBytes: 48 * 1024 * 1024,
  heapGrowthRatio: 1.8
});

const viewports = [
  { name: 'desktop-1440', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true }
];

const scenarios = [
  {
    name: 'live-map',
    hash: '',
    waitFor: '.maplibregl-canvas',
    checks: [
      { selector: '.link-bar', label: 'top project bar' },
      { selector: '.top-actions', label: 'top map actions', desktopOnly: true },
      { selector: '.mobile-tabbar', label: 'mobile app tabbar', mobileOnly: true },
      { selector: '.maplibregl-ctrl-bottom-right', label: 'map controls' }
    ],
    actions: [smokeLiveMapControls]
  },
  {
    name: 'setup',
    hash: '#/setup',
    waitFor: '.setup-panel',
    checks: [
      { selector: '.link-bar', label: 'top project bar' },
      { selector: '.setup-panel', label: 'first-run setup panel' }
    ],
    actions: [smokeSetupPanel]
  },
  {
    name: 'packets',
    hash: '#/packets',
    waitFor: '.packets-panel',
    checks: [
      { selector: '.link-bar', label: 'top project bar' },
      { selector: '.packets-panel', label: 'Packets panel' },
      { selector: '.packets-summary-strip', label: 'Packets summary strip' }
    ],
    actions: [smokePacketsAnimation]
  },
  {
    name: 'chat',
    hash: '#/chat',
    waitFor: '.chat-panel',
    checks: [
      { selector: '.link-bar', label: 'top project bar' },
      { selector: '.chat-panel', label: 'Chat panel' }
    ],
    actions: [smokeChatPanel]
  },
  {
    name: 'labs',
    hash: '#/lab',
    waitFor: '.lab-panel',
    checks: [
      { selector: '.link-bar', label: 'top project bar' },
      { selector: '.lab-panel', label: 'Labs panel' },
      { selector: '.waterfall-stage-shell', label: 'Waterfall stage' },
      { selector: '.waterfall-control-surface', label: 'Waterfall controls' },
      { selector: '.waterfall-canvas', label: 'Waterfall canvas' }
    ],
    actions: [smokeLabsPanel]
  },
  {
    name: 'nodes',
    hash: '#/nodes',
    waitFor: '.node-list-panel',
    checks: [
      { selector: '.link-bar', label: 'top project bar' },
      { selector: '.node-list-panel', label: 'Node List panel' },
      { selector: '.node-list-search', label: 'Node List search' },
      { selector: '.node-list-table-wrap', label: 'Node List table' }
    ],
    actions: [smokeNodeListPanel]
  },
  {
    name: 'netgraph',
    hash: '#/netgraph',
    waitFor: '.netgraph-panel',
    checks: [
      { selector: '.link-bar', label: 'top project bar' },
      { selector: '.netgraph-panel', label: 'NetGraph panel' },
      { selector: '.netgraph-canvas', label: 'NetGraph canvas' }
    ],
    actions: [smokeNetGraphPanel]
  }
];

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args['base-url'] ?? process.env.BROWSER_SMOKE_BASE_URL ?? DEFAULT_BASE_URL);
const outputDir = path.resolve(String(args['output-dir'] ?? process.env.BROWSER_SMOKE_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR));
const headless = args.headed === undefined;
const keepOpen = args['keep-open'] !== undefined;
const skipScreenshots = args['skip-screenshots'] !== undefined;
const releaseGateOnly = args['release-gate-only'] !== undefined;
const channel = args.channel ? String(args.channel) : (process.env.PLAYWRIGHT_CHROME_CHANNEL || 'chrome');

await mkdir(outputDir, { recursive: true });

const fixtureTopology = await waitForPublicTopology(baseUrl);
const browser = await launchBrowser({ channel, headless });
const startedAt = new Date().toISOString();
const results = [];
const releaseGates = [];
let hardFailures = 0;

try {
  for (const viewport of viewports) {
    console.log(`[run] ${viewport.name} release-gate`);
    const gate = await runReleaseGate(browser, viewport);
    releaseGates.push(gate);
    if (gate.errors.length > 0) hardFailures += 1;
    const gateStatus = gate.errors.length === 0 ? 'pass' : 'fail';
    console.log(`[${gateStatus}] ${viewport.name} release-gate trace=${path.relative(rootDir, gate.trace)}`);
    for (const error of gate.errors) console.log(`  - ${error}`);

    for (const scenario of releaseGateOnly ? [] : scenarios) {
      console.log(`[run] ${viewport.name} ${scenario.name}`);
      const result = await runScenario(browser, viewport, scenario);
      results.push(result);
      if (result.errors.length > 0) hardFailures += 1;
      const status = result.errors.length === 0 ? 'pass' : 'fail';
      console.log(`[${status}] ${viewport.name} ${scenario.name}${result.screenshot ? ` screenshot=${path.relative(rootDir, result.screenshot)}` : ''}`);
      for (const error of result.errors) console.log(`  - ${error}`);
    }
  }
} finally {
  if (!keepOpen) await browser.close();
}

const summary = {
  baseUrl,
  startedAt,
  finishedAt: new Date().toISOString(),
  viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
  scenarios: scenarios.map(({ name, hash }) => ({ name, hash })),
  fixtureTopology,
  releaseGates,
  passed: hardFailures === 0,
  failures: hardFailures,
  results
};

const summaryPath = path.join(outputDir, 'browser-smoke-summary.json');
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
console.log(`[artifact] ${path.relative(rootDir, summaryPath)}`);

if (hardFailures > 0) process.exit(1);

async function runScenario(browser, viewport, scenario) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const errors = [];
  const consoleErrors = [];
  const pageErrors = [];
  let ignoredFailedResourceCount = 0;
  let ignoredFailedResourceConsoleCount = 0;

  page.on('response', (response) => {
    if (isIgnoredFailedResource(response.status(), response.url())) {
      ignoredFailedResourceCount += 1;
    }
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isIgnoredConsoleMessage(text)) return;
    if (isGenericFailedResourceConsoleMessage(text) && ignoredFailedResourceConsoleCount < ignoredFailedResourceCount) {
      ignoredFailedResourceConsoleCount += 1;
      return;
    }
    consoleErrors.push(text);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message || String(error));
  });

  try {
    await page.addInitScript(() => {
      localStorage.setItem('mc-cartolive-debug-perf', '1');
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('mc-cartolive-welcome-guide-dismissed-')) localStorage.setItem(key, '1');
      }
    }, appVersion);
    await page.addInitScript((version) => {
      localStorage.setItem(`mc-cartolive-welcome-guide-dismissed-${version}`, '1');
    }, appVersion);
    await page.goto(urlForScenario(baseUrl, scenario.hash), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await dismissWelcome(page);
    await page.waitForSelector(scenario.waitFor, { state: 'visible', timeout: 45_000 });
    await page.waitForTimeout(900);
    if (scenario.name === 'live-map') await waitForTopologyHydration(page);

    for (const check of scenario.checks) {
      if (check.desktopOnly && viewport.isMobile) continue;
      if (check.mobileOnly && !viewport.isMobile) continue;
      await assertVisibleInViewport(page, check.selector, check.label, viewport);
    }

    for (const action of scenario.actions ?? []) {
      await action(page, viewport);
    }

    await assertGlobalReleaseChecks(page, errors);

    if (consoleErrors.length > 0) errors.push(...consoleErrors.map((item) => `console error: ${item}`));
    if (pageErrors.length > 0) errors.push(...pageErrors.map((item) => `page error: ${item}`));

    const screenshot = skipScreenshots ? null : path.join(outputDir, `${viewport.name}-${scenario.name}.png`);
    if (screenshot) await page.screenshot({ path: screenshot, fullPage: false });

    return {
      viewport: viewport.name,
      scenario: scenario.name,
      url: page.url(),
      screenshot,
      errors
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return {
      viewport: viewport.name,
      scenario: scenario.name,
      url: page.url(),
      screenshot: null,
      errors
    };
  } finally {
    await context.close();
  }
}

async function runReleaseGate(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    screen: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    reducedMotion: 'reduce',
    serviceWorkers: 'allow',
    acceptDownloads: true
  });
  const page = await context.newPage();
  const trace = path.join(outputDir, `${viewport.name}-release-gate-trace.zip`);
  const screenshot = skipScreenshots ? null : path.join(outputDir, `${viewport.name}-release-gate.png`);
  const errors = [];
  const checks = [];
  const consoleErrors = [];
  const pageErrors = [];
  const downloads = [];
  const stateRequests = { count: 0 };
  const expectedNetworkErrors = { offline: false };
  let ignoredFailedResourceCount = 0;
  let ignoredFailedResourceConsoleCount = 0;
  let baselineMetrics = null;
  let postStyleMetrics = null;
  let finalMetrics = null;
  let metricDeltas = null;
  let finalMetricDeltas = null;
  let serviceWorker = null;
  let eventReset = null;
  let visibilityRecovery = null;
  let commandPalette = null;
  let liveFlow = null;
  let cdp = null;

  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  await page.addInitScript(installBrowserSmokeInstrumentation);

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(baseUrl).origin && url.pathname === '/api/v1/public/state') stateRequests.count += 1;
  });
  page.on('response', (response) => {
    if (isIgnoredFailedResource(response.status(), response.url())) ignoredFailedResourceCount += 1;
  });
  page.on('console', (message) => {
    if (message.type() !== 'error' || isIgnoredConsoleMessage(message.text())) return;
    if (expectedNetworkErrors.offline && /net::(?:ERR_INTERNET_DISCONNECTED|ERR_FAILED)/i.test(message.text())) return;
    if (isGenericFailedResourceConsoleMessage(message.text()) && ignoredFailedResourceConsoleCount < ignoredFailedResourceCount) {
      ignoredFailedResourceConsoleCount += 1;
      return;
    }
    consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message || String(error)));
  page.on('download', (download) => {
    downloads.push(download.suggestedFilename());
    void download.cancel().catch(() => undefined);
  });

  try {
    cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable').catch(() => undefined);

    await page.goto(urlForScenario(baseUrl, ''), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector('.maplibregl-canvas', { state: 'visible', timeout: 45_000 });
    await page.waitForTimeout(1_000);

    await runGateStep(errors, checks, 'first-run compact coach, primary layout, and no horizontal overflow', () => assertFirstRunLayout(page, viewport));
    const dismissGuide = page.getByRole('button', { name: /Dismiss map guide/i });
    if (await dismissGuide.isVisible().catch(() => false)) {
      await dismissGuide.click();
      await page.getByRole('region', { name: /First visit map guide/i }).waitFor({ state: 'hidden', timeout: 5_000 });
    }

    const topologyReady = await runGateStep(errors, checks, 'full node and route topology hydrates before interactive surfaces', async () => {
      await waitForTopologyHydration(page);
      return true;
    });

    eventReset = await runGateStep(errors, checks, 'public cursor reset semantics for zero and ahead cursors', () => smokePublicEventReset(page));

    serviceWorker = await runGateStep(errors, checks, 'service-worker registration/update, no-cache metadata, and bounded versioned caches', () => smokeServiceWorkerSafety(page, context));

    if (topologyReady) {
      commandPalette = await runGateStep(errors, checks, 'Ctrl/Cmd+K command palette focus trap/restore and retired playback controls stay absent', () => smokeCommandPalette(page, viewport));
    }
    await recoverReleaseGateUI(page);

    const styleDrawer = await runGateStep(errors, checks, 'style library opens as an accessible modal', () => openStyleChangeSurface(page));
    if (styleDrawer) {
      await runGateStep(errors, checks, 'first 20 style changes warm lazy map paths with one live map surface', () => cycleMapStyles(page, styleDrawer, 20));
      await page.waitForTimeout(1_500);
      baselineMetrics = await runGateStep(errors, checks, 'post-warmup browser metrics captured with the style surface still mounted', () => collectReleaseGateMetrics(page, cdp, true));

      await runGateStep(errors, checks, 'second 20 style changes exercise accumulation with the same live style surface', () => cycleMapStyles(page, styleDrawer, 20));
      await page.waitForTimeout(1_500);
      postStyleMetrics = await runGateStep(errors, checks, 'post-style browser metrics captured with the same style surface mounted', () => collectReleaseGateMetrics(page, cdp, true));
      if (baselineMetrics && postStyleMetrics) {
        metricDeltas = await runGateStep(errors, checks, 'second-batch listener, DOM-node, and JS-heap growth plateaus', async () => assertReleaseGateMetricGrowth(baselineMetrics, postStyleMetrics));
      }
      await page.keyboard.press('Escape');
      await styleDrawer.waitFor({ state: 'hidden', timeout: 5_000 });
    }
    await recoverReleaseGateUI(page);

    visibilityRecovery = await runGateStep(errors, checks, 'visibility resume rehydrates the public snapshot', () => smokeVisibilityRecovery(context, page, stateRequests));

    await runGateStep(errors, checks, 'offline banner, retained map surface, and online API recovery', () => smokeOfflineRecovery(context, page, expectedNetworkErrors));

    await runGateStep(errors, checks, 'post-interaction layout remains within the viewport', () => assertNoHorizontalOverflow(page, viewport, 'after release interactions'));
    await page.waitForTimeout(1_500);
    finalMetrics = await runGateStep(errors, checks, 'final browser metrics captured', () => collectReleaseGateMetrics(page, cdp, true));
    if (baselineMetrics && finalMetrics) {
      finalMetricDeltas = await runGateStep(errors, checks, 'recovery listener, timer, animation-frame, DOM-node, and JS-heap growth heuristics', async () => assertReleaseGateMetricGrowth(baselineMetrics, finalMetrics));
    }

    await runGateStep(errors, checks, 'single map and zero hidden export surfaces after cleanup', async () => {
      const mapCount = await page.locator('.map-wrap .maplibregl-canvas').count();
      if (mapCount !== 1) throw new Error(`expected one live MapLibre canvas after release gate, found ${mapCount}`);
      const hiddenExportSurfaces = await countHiddenExportSurfaces(page);
      if (hiddenExportSurfaces !== 0) throw new Error(`temporary export surfaces leaked after release gate: ${hiddenExportSurfaces}`);
    });
    if (topologyReady) {
      liveFlow = await runGateStep(errors, checks, 'sparse durable and seq-less fallback events visibly update the live map', () => smokeSparseLiveFlow(page));
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (consoleErrors.length > 0) errors.push(...consoleErrors.map((item) => `console error: ${item}`));
    if (pageErrors.length > 0) errors.push(...pageErrors.map((item) => `page error: ${item}`));
    if (screenshot) {
      await page.screenshot({ path: screenshot, fullPage: false }).catch((error) => {
        errors.push(`release screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    await context.tracing.stop({ path: trace }).catch((error) => {
      errors.push(`trace write failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    await cdp?.detach().catch(() => undefined);
    await context.setOffline(false).catch(() => undefined);
    await context.close();
  }

  return {
    viewport: viewport.name,
    url: page.url(),
    screenshot,
    trace,
    checks,
    eventReset,
    serviceWorker,
    visibilityRecovery,
    commandPalette,
    liveFlow,
    downloads,
    metrics: { baseline: baselineMetrics, postStyles: postStyleMetrics, final: finalMetrics, styleDeltas: metricDeltas, finalDeltas: finalMetricDeltas, thresholds: RELEASE_GATE_THRESHOLDS },
    errors
  };
}

async function runGateStep(errors, checks, label, operation) {
  try {
    const value = await operation();
    checks.push(label);
    return value;
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function recoverReleaseGateUI(page) {
  await page.evaluate(() => {
    if (window.__mcBrowserSmoke) window.__mcBrowserSmoke.timeoutCapMs = null;
  }).catch(() => undefined);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const modal = page.locator('[role="dialog"][aria-modal="true"]:visible').last();
    if (!await modal.isVisible().catch(() => false)) break;
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(100);
  }
}

async function assertFirstRunLayout(page, viewport) {
  const guide = page.getByRole('region', { name: /First visit map guide/i });
  await guide.waitFor({ state: 'visible', timeout: 12_000 });
  await assertVisibleInViewport(page, '.visitor-guide', 'compact first-run coach', viewport);
  const role = await guide.getAttribute('role');
  if (role !== 'region') throw new Error(`first-run coach must be a region, got ${role || 'no role'}`);
  if ((await guide.getAttribute('aria-modal')) === 'true') throw new Error('compact first-run coach unexpectedly blocks the map as a modal');
  const legacyOverlayCount = await page.locator('.welcome-guide, .welcome-guide-popover, [data-version-onboarding]').count();
  if (legacyOverlayCount !== 0) throw new Error(`legacy version onboarding overlay rendered: ${legacyOverlayCount}`);

  const map = page.getByRole('region', { name: /Live MeshCore Canada network map/i });
  await map.waitFor({ state: 'visible', timeout: 10_000 });
  if (await page.locator('.map-wrap[role="application"], [role="application"].map-wrap').count()) {
    throw new Error('map uses opaque application role instead of a named region');
  }

  const searchVisible = await page.locator('.panel-search').first().isVisible().catch(() => false);
  const legendVisible = await page.locator('.panel-legend').first().isVisible().catch(() => false);
  if (searchVisible && legendVisible) throw new Error('Search and Legend opened together on first run');
  await assertNoHorizontalOverflow(page, viewport, 'first-run layout');
}

async function smokePublicEventReset(page) {
  const result = await page.evaluate(async () => {
    const bootstrapResponse = await fetch('/api/v1/public/bootstrap', { headers: { accept: 'application/json' } });
    if (!bootstrapResponse.ok) throw new Error(`bootstrap HTTP ${bootstrapResponse.status}`);
    const bootstrap = await bootstrapResponse.json();
    const latest = Number(bootstrap.latestSeq ?? 0);
    const queries = [0, Math.max(1, latest + 1_000_000)];
    const responses = [];
    for (const afterSeq of queries) {
      const started = performance.now();
      const response = await fetch(`/api/v1/public/events?afterSeq=${afterSeq}&limit=25`, { headers: { accept: 'application/json' } });
      const body = await response.json().catch(() => null);
      responses.push({ afterSeq, status: response.status, elapsedMs: performance.now() - started, body });
    }
    return { latest, responses };
  });

  for (const item of result.responses) {
    if (item.status !== 200) throw new Error(`event reset afterSeq=${item.afterSeq} returned HTTP ${item.status}`);
    const body = item.body;
    if (!body || body.resetRequired !== true) throw new Error(`event reset afterSeq=${item.afterSeq} did not set resetRequired=true`);
    if (!Array.isArray(body.events) || body.events.length !== 0) throw new Error(`event reset afterSeq=${item.afterSeq} scanned history instead of returning no events`);
    if (!Number.isFinite(Number(body.oldestSeq)) || !Number.isFinite(Number(body.latestSeq))) {
      throw new Error(`event reset afterSeq=${item.afterSeq} omitted numeric sequence bounds`);
    }
    if (typeof body.nextCursor !== 'string') throw new Error(`event reset afterSeq=${item.afterSeq} omitted string nextCursor`);
    if (item.elapsedMs > 5_000) throw new Error(`event reset afterSeq=${item.afterSeq} exceeded 5s: ${item.elapsedMs.toFixed(0)}ms`);
  }
  return {
    latestSeq: result.latest,
    zeroCursorMs: Number(result.responses[0].elapsedMs.toFixed(1)),
    aheadCursorMs: Number(result.responses[1].elapsedMs.toFixed(1)),
    nextCursor: result.responses[0].body.nextCursor
  };
}

async function smokeCommandPalette(page, viewport) {
  const origin = viewport.isMobile
    ? page.locator('.mobile-tabbar').getByRole('button', { name: /^Map$/i })
    : page.locator('.command-palette-toggle').first();
  await origin.waitFor({ state: 'visible', timeout: 10_000 });
  await origin.focus();
  await page.keyboard.press('Control+K');

  const command = page.getByRole('dialog', { name: /Search commands, regions, nodes, and routes/i });
  await command.waitFor({ state: 'visible', timeout: 10_000 });
  await assertAccessibleModal(page, command, 'command palette');
  const input = command.locator('#command-palette-input');
  if (!await input.evaluate((element) => element === document.activeElement)) throw new Error('command search did not receive initial focus');
  const options = command.getByRole('option');
  const optionCount = await options.count();
  if (optionCount < 2) throw new Error(`command palette exposed too few keyboard results: ${optionCount}`);
  const retiredOptions = command.getByRole('option').filter({ hasText: /RF Replay Studio|Live timeline/i });
  if (await retiredOptions.count()) throw new Error('command palette still exposes retired Timeline/VCR or RF Replay Studio actions');
  const firstSelected = await command.getByRole('option', { selected: true }).textContent();
  await input.press('ArrowDown');
  const secondSelected = await command.getByRole('option', { selected: true }).textContent();
  if (compactText(firstSelected) === compactText(secondSelected)) throw new Error('ArrowDown did not move command selection');
  await input.press('ArrowUp');
  await page.keyboard.press('Escape');
  await command.waitFor({ state: 'hidden', timeout: 5_000 });
  if (!await origin.evaluate((element) => element === document.activeElement)) throw new Error('command palette did not restore focus to its opener');

  await page.keyboard.press('Control+K');
  await command.waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('.command-palette-backdrop').dispatchEvent('mousedown', { button: 0 });
  await command.waitFor({ state: 'hidden', timeout: 5_000 });
  await assertRetiredPlaybackControlsAbsent(page);
  await assertNoHorizontalOverflow(page, viewport, 'after command palette');
  return { keyboardNavigation: true, focusRestored: true, backdropDismissed: true, retiredPlaybackControlsAbsent: true };
}

async function openStyleChangeSurface(page) {
  await page.keyboard.press('Control+K');
  const command = page.getByRole('dialog', { name: /Search commands, regions, nodes, and routes/i });
  await command.waitFor({ state: 'visible', timeout: 10_000 });
  const input = command.locator('#command-palette-input');
  await input.fill('Map settings');
  await command.getByRole('option').filter({ hasText: 'Map settings' }).first().waitFor({ state: 'visible', timeout: 8_000 });
  await input.press('Enter');

  const drawer = page.getByRole('dialog', { name: /^Map settings$/i });
  await drawer.waitFor({ state: 'visible', timeout: 10_000 });
  await assertAccessibleModal(page, drawer, 'map settings');
  await drawer.getByRole('button', { name: /Style Library/i }).click();
  const profiles = drawer.getByRole('group', { name: /Map style profiles/i });
  await profiles.waitFor({ state: 'visible', timeout: 8_000 });
  return drawer;
}

async function cycleMapStyles(page, drawer, count) {
  const profiles = drawer.getByRole('group', { name: /Map style profiles/i });
  const dark = profiles.getByRole('button', { name: /Classic Dark/i });
  const light = profiles.getByRole('button', { name: /Classic Light/i });
  for (let index = 0; index < count; index += 1) {
    const expected = index % 2 === 0 ? 'classic-light' : 'classic-dark';
    await (index % 2 === 0 ? light : dark).click();
    await page.waitForFunction((profile) => document.querySelector('.map-wrap')?.getAttribute('data-map-style-profile') === profile, expected, { timeout: 8_000 });
    await page.waitForSelector('.maplibregl-canvas', { state: 'visible', timeout: 8_000 });
  }
  await page.waitForTimeout(800);
  const canvases = await page.locator('.map-wrap .maplibregl-canvas').count();
  if (canvases !== 1) throw new Error(`style cycling left ${canvases} MapLibre canvases mounted`);
}

async function smokeVisibilityRecovery(context, page, stateRequests) {
  const before = stateRequests.count;
  const method = 'cdp-lifecycle+resume-event';
  const lifecycle = await context.newCDPSession(page);
  await lifecycle.send('Page.setWebLifecycleState', { state: 'frozen' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await lifecycle.send('Page.setWebLifecycleState', { state: 'active' });
  await lifecycle.detach();
  await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 5_000 });
  // Chromium's experimental lifecycle command does not consistently emit the
  // DOM Page Lifecycle `resume` event in headless mode. Dispatch the standard
  // signal after the real frozen/active transition so the application path is
  // deterministic across desktop and mobile CI runners.
  await page.evaluate(() => document.dispatchEvent(new Event('resume')));
  const refreshed = await waitForCondition(() => stateRequests.count > before, 10_000, 100);
  if (!refreshed) throw new Error(`visibility resume did not request a fresh public snapshot (before=${before}, after=${stateRequests.count})`);
  return { method, stateRequestsBefore: before, stateRequestsAfter: stateRequests.count };
}

async function smokeOfflineRecovery(context, page, expectedNetworkErrors) {
  expectedNetworkErrors.offline = true;
  await context.setOffline(true);
  try {
    await page.locator('.offline-banner').waitFor({ state: 'visible', timeout: 5_000 });
    await page.waitForSelector('.maplibregl-canvas', { state: 'visible', timeout: 5_000 });
    const offlineFetchFailed = await page.evaluate(async () => {
      try {
        await fetch(`/readyz?offline-smoke=${Date.now()}`, { cache: 'no-store' });
        return false;
      } catch {
        return true;
      }
    });
    if (!offlineFetchFailed) throw new Error('offline emulation still reached the readiness endpoint');
  } finally {
    await context.setOffline(false);
  }
  await page.locator('.offline-banner').waitFor({ state: 'hidden', timeout: 8_000 });
  const ready = await page.evaluate(async () => {
    const response = await fetch(`/readyz?online-smoke=${Date.now()}`, { cache: 'no-store' });
    return response.ok;
  });
  if (!ready) throw new Error('public readiness did not recover after returning online');
  await page.waitForTimeout(150);
  expectedNetworkErrors.offline = false;
}

async function smokeServiceWorkerSafety(page, context) {
  const metadata = await page.evaluate(async () => {
    const manifestURL = document.querySelector('link[rel="manifest"]')?.href;
    const [worker, manifest] = await Promise.all([
      fetch(`/sw.js?browser-smoke=${Date.now()}`, { cache: 'no-store' }),
      manifestURL ? fetch(manifestURL, { cache: 'no-store' }) : Promise.resolve(null)
    ]);
    const workerText = await worker.text();
    return {
      workerStatus: worker.status,
      workerCacheControl: worker.headers.get('cache-control') ?? '',
      workerText,
      manifestURL: manifestURL ?? '',
      manifestStatus: manifest?.status ?? 0,
      manifestCacheControl: manifest?.headers.get('cache-control') ?? ''
    };
  });
  if (metadata.workerStatus !== 200) throw new Error(`service worker script returned HTTP ${metadata.workerStatus}`);
  if (!/no-cache/i.test(metadata.workerCacheControl) || !/must-revalidate/i.test(metadata.workerCacheControl)) {
    throw new Error(`service worker cache-control is unsafe: ${metadata.workerCacheControl || '<missing>'}`);
  }
  if (!metadata.manifestURL || metadata.manifestStatus !== 200) throw new Error(`web manifest unavailable: ${metadata.manifestStatus}`);
  if (!/no-cache/i.test(metadata.manifestCacheControl) || !/must-revalidate/i.test(metadata.manifestCacheControl)) {
    throw new Error(`manifest cache-control is unsafe: ${metadata.manifestCacheControl || '<missing>'}`);
  }
  for (const contract of ['RUNTIME_CACHE_LIMIT', 'RELEASE_ID', "event.request.mode === 'navigate'", 'networkFirst']) {
    if (!metadata.workerText.includes(contract)) throw new Error(`service worker script is missing ${contract}`);
  }

  await page.waitForTimeout(1_200);
  let registrations = await page.evaluate(async () => {
    if (!navigator.serviceWorker) return [];
    return (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
      scope: registration.scope,
      active: registration.active?.scriptURL ?? '',
      waiting: registration.waiting?.scriptURL ?? '',
      installing: registration.installing?.scriptURL ?? ''
    }));
  });
  if (registrations.length === 0) {
    const disabledState = await page.evaluate(async () => ({
      controlled: Boolean(navigator.serviceWorker?.controller),
      caches: 'caches' in window ? (await caches.keys()).filter((key) => key.startsWith('mc-cartolive')) : []
    }));
    if (disabledState.controlled) throw new Error('service worker disabled build remained controlled');
    if (disabledState.caches.length > 0) throw new Error(`service worker disabled build retained caches: ${disabledState.caches.join(', ')}`);
    return { mode: 'disabled-clean', registrations: 0, cacheNames: [], workerCacheControl: metadata.workerCacheControl, manifestCacheControl: metadata.manifestCacheControl };
  }

  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.maplibregl-canvas', { state: 'visible', timeout: 30_000 });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  }
  registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
    scope: registration.scope,
    active: registration.active?.scriptURL ?? '',
    waiting: registration.waiting?.scriptURL ?? '',
    installing: registration.installing?.scriptURL ?? ''
  })));
  if (registrations.length !== 1) throw new Error(`expected one service-worker registration, found ${registrations.length}`);
  const activeURL = new URL(registrations[0].active);
  if (activeURL.pathname !== '/sw.js') throw new Error(`unexpected service worker path: ${activeURL.pathname}`);
  if (activeURL.searchParams.get('version') !== appVersion) throw new Error(`service worker version query is not ${appVersion}: ${activeURL.search}`);
  const sha = activeURL.searchParams.get('sha') ?? '';
  if (!/^[0-9a-f]{7,12}$/i.test(sha)) throw new Error(`service worker SHA is not an immutable short Git SHA: ${sha || '<missing>'}`);
  const cacheNames = await page.evaluate(async () => (await caches.keys()).filter((key) => key.startsWith('mc-cartolive')));
  const releaseID = `${appVersion}-${sha}`;
  const invalidCache = cacheNames.find((name) => !new RegExp(`^mc-cartolive-(?:shell|runtime|snapshot)-${escapeRegExp(releaseID)}$`).test(name));
  if (invalidCache) throw new Error(`unversioned or stale service-worker cache remains: ${invalidCache}`);
  if (cacheNames.length > 3) throw new Error(`service worker opened too many release caches: ${cacheNames.length}`);

  const beforeURL = page.url();
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
  await page.waitForTimeout(1_000);
  if (page.url() !== beforeURL) throw new Error('same-build service-worker update reloaded the page without an explicit prompt');
  const workers = context.serviceWorkers().map((worker) => worker.url());
  return {
    mode: 'enabled-versioned',
    registrations: registrations.length,
    activeURL: registrations[0].active,
    cacheNames,
    workers,
    workerCacheControl: metadata.workerCacheControl,
    manifestCacheControl: metadata.manifestCacheControl
  };
}

async function assertAccessibleModal(page, dialog, label) {
  if ((await dialog.getAttribute('aria-modal')) !== 'true') throw new Error(`${label} is missing aria-modal=true`);
  await page.waitForFunction((selector) => {
    const element = document.querySelector(selector);
    return element instanceof HTMLElement && element.contains(document.activeElement);
  }, await uniqueSelector(dialog), { timeout: 3_000 });
  const result = await dialog.evaluate(async (element) => {
    const focusable = [...element.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((candidate) => candidate instanceof HTMLElement && (candidate.offsetParent !== null || candidate === document.activeElement));
    if (focusable.length < 2) return { count: focusable.length, shiftWrapped: false, tabWrapped: false };
    focusable[0].focus();
    return { count: focusable.length };
  });
  if (result.count < 2) throw new Error(`${label} has fewer than two keyboard-focusable controls`);
  await page.keyboard.press('Shift+Tab');
  const shiftWrapped = await dialog.evaluate((element) => {
    const focusable = [...element.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((candidate) => candidate instanceof HTMLElement && (candidate.offsetParent !== null || candidate === document.activeElement));
    return document.activeElement === focusable.at(-1);
  });
  if (!shiftWrapped) throw new Error(`${label} did not wrap Shift+Tab from first to last control`);
  await page.keyboard.press('Tab');
  const tabWrapped = await dialog.evaluate((element) => {
    const focusable = [...element.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((candidate) => candidate instanceof HTMLElement && (candidate.offsetParent !== null || candidate === document.activeElement));
    return document.activeElement === focusable[0];
  });
  if (!tabWrapped) throw new Error(`${label} did not wrap Tab from last to first control`);
}

async function uniqueSelector(locator) {
  return locator.evaluate((element) => {
    const token = `browser-smoke-${Math.random().toString(36).slice(2)}`;
    element.setAttribute('data-browser-smoke-dialog', token);
    return `[data-browser-smoke-dialog="${token}"]`;
  });
}

async function assertNoHorizontalOverflow(page, viewport, label) {
  const layout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  const overflow = Math.max(layout.documentWidth, layout.bodyWidth) - layout.innerWidth;
  if (overflow > 2) throw new Error(`${label} horizontally overflows by ${overflow}px: ${JSON.stringify(layout)}`);
  if (layout.innerWidth !== viewport.width) throw new Error(`${label} viewport drifted from ${viewport.width}px to ${layout.innerWidth}px`);
}

async function countHiddenExportSurfaces(page) {
  return page.evaluate(() => [...document.body.children].filter((element) => {
    if (!(element instanceof HTMLElement)) return false;
    return element.getAttribute('aria-hidden') === 'true' && element.style.left.startsWith('-100000');
  }).length);
}

async function collectReleaseGateMetrics(page, cdp, forceGC) {
  if (forceGC) await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
  const browser = await cdp.send('Performance.getMetrics');
  const values = Object.fromEntries(browser.metrics.map((metric) => [metric.name, metric.value]));
  const pageState = await page.evaluate(() => ({
    instrumentation: window.__mcBrowserSmoke.snapshot(),
    liveDomNodes: document.querySelectorAll('*').length
  }));
  return {
    jsHeapUsedBytes: Math.round(values.JSHeapUsedSize ?? 0),
    domNodes: Math.round(values.Nodes ?? 0),
    documents: Math.round(values.Documents ?? 0),
    browserEventListeners: Math.round(values.JSEventListeners ?? 0),
    liveDomNodes: pageState.liveDomNodes,
    instrumentation: pageState.instrumentation
  };
}

function assertReleaseGateMetricGrowth(baseline, final) {
  const deltas = {
    listeners: final.browserEventListeners - baseline.browserEventListeners,
    instrumentedListeners: final.instrumentation.listeners - baseline.instrumentation.listeners,
    intervals: final.instrumentation.intervals - baseline.instrumentation.intervals,
    timeouts: final.instrumentation.timeouts - baseline.instrumentation.timeouts,
    animationFrames: final.instrumentation.animationFrames - baseline.instrumentation.animationFrames,
    domNodes: final.liveDomNodes - baseline.liveDomNodes,
    retainedDomNodes: (final.domNodes - final.liveDomNodes) - (baseline.domNodes - baseline.liveDomNodes),
    jsHeapUsedBytes: final.jsHeapUsedBytes - baseline.jsHeapUsedBytes,
    jsHeapRatio: baseline.jsHeapUsedBytes > 0 ? Number((final.jsHeapUsedBytes / baseline.jsHeapUsedBytes).toFixed(3)) : 1
  };
  const failures = [];
  if (deltas.listeners > RELEASE_GATE_THRESHOLDS.listenerGrowth) failures.push(`browser listeners +${deltas.listeners}`);
  if (deltas.instrumentedListeners > RELEASE_GATE_THRESHOLDS.instrumentedListenerGrowth) failures.push(`instrumented listeners +${deltas.instrumentedListeners}`);
  if (deltas.intervals > RELEASE_GATE_THRESHOLDS.intervalGrowth) failures.push(`intervals +${deltas.intervals}`);
  if (deltas.timeouts > RELEASE_GATE_THRESHOLDS.timeoutGrowth) failures.push(`timeouts +${deltas.timeouts}`);
  if (deltas.animationFrames > RELEASE_GATE_THRESHOLDS.animationFrameGrowth) failures.push(`animation frames +${deltas.animationFrames}`);
  if (deltas.domNodes > RELEASE_GATE_THRESHOLDS.domNodeGrowth) failures.push(`live DOM nodes +${deltas.domNodes}`);
  if (deltas.retainedDomNodes > RELEASE_GATE_THRESHOLDS.retainedDomNodeGrowth) failures.push(`retained DOM nodes +${deltas.retainedDomNodes}`);
  if (deltas.jsHeapUsedBytes > RELEASE_GATE_THRESHOLDS.heapGrowthBytes && deltas.jsHeapRatio > RELEASE_GATE_THRESHOLDS.heapGrowthRatio) {
    failures.push(`JS heap +${(deltas.jsHeapUsedBytes / 1024 / 1024).toFixed(1)} MiB (${deltas.jsHeapRatio}x)`);
  }
  if (failures.length > 0) throw new Error(`release interaction growth exceeded heuristic thresholds: ${failures.join(', ')}`);
  return deltas;
}

async function waitForCondition(predicate, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

async function waitForPublicTopology(publicBaseUrl, timeoutMs = 45_000) {
  let diagnostic = 'no response';
  const ready = await waitForCondition(async () => {
    const proof = await probeCurrentPublicTopology(publicBaseUrl);
    diagnostic = proof.diagnostic;
    return proof.ready;
  }, timeoutMs, 750);
  if (!ready) throw new Error(`public fixture topology did not become current: ${diagnostic}`);
  return diagnostic;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function installBrowserSmokeInstrumentation() {
  if (window.__mcBrowserSmoke) return;
  try { window.localStorage.setItem('mc-cartolive-debug-perf', '1'); } catch {}
  const NativeWebSocket = window.WebSocket;
  const liveSockets = new Set();
  const state = {
    listeners: 0,
    listenerTypes: Object.create(null),
    timeouts: new Set(),
    intervals: new Set(),
    animationFrames: new Set(),
    timeoutCapMs: null
  };
  const listenerRecords = new WeakMap();
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nativeRemove = EventTarget.prototype.removeEventListener;
  const captureFor = (options) => typeof options === 'boolean' ? options : Boolean(options?.capture);
  const onceFor = (options) => typeof options === 'object' && options !== null && Boolean(options.once);
  const recordsFor = (target) => {
    let records = listenerRecords.get(target);
    if (!records) {
      records = [];
      listenerRecords.set(target, records);
    }
    return records;
  };
  const deactivate = (record) => {
    if (!record.active) return;
    record.active = false;
    state.listeners -= 1;
    state.listenerTypes[record.type] = Math.max(0, (state.listenerTypes[record.type] ?? 1) - 1);
  };
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (!listener) return nativeAdd.call(this, type, listener, options);
    const capture = captureFor(options);
    const records = recordsFor(this);
    if (records.some((record) => record.active && record.type === type && record.listener === listener && record.capture === capture)) return;
    const record = { type, listener, capture, active: true, wrapped: listener };
    if (onceFor(options)) {
      record.wrapped = typeof listener === 'function'
        ? function (...args) { deactivate(record); return listener.apply(this, args); }
        : { handleEvent(...args) { deactivate(record); return listener.handleEvent(...args); } };
    }
    records.push(record);
    state.listeners += 1;
    state.listenerTypes[type] = (state.listenerTypes[type] ?? 0) + 1;
    return nativeAdd.call(this, type, record.wrapped, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const capture = captureFor(options);
    const record = listenerRecords.get(this)?.find((candidate) => candidate.active && candidate.type === type && candidate.listener === listener && candidate.capture === capture);
    if (!record) return nativeRemove.call(this, type, listener, options);
    deactivate(record);
    return nativeRemove.call(this, type, record.wrapped, options);
  };

  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const nativeCancelRAF = window.cancelAnimationFrame.bind(window);
  window.setTimeout = (handler, delay = 0, ...args) => {
    let id = 0;
    const requested = Number(delay) || 0;
    const effective = Number.isFinite(state.timeoutCapMs) && requested >= state.timeoutCapMs ? state.timeoutCapMs : requested;
    const wrapped = typeof handler === 'function' ? (...callbackArgs) => {
      state.timeouts.delete(id);
      return handler(...callbackArgs);
    } : handler;
    id = nativeSetTimeout(wrapped, effective, ...args);
    state.timeouts.add(id);
    return id;
  };
  window.clearTimeout = (id) => { state.timeouts.delete(id); return nativeClearTimeout(id); };
  window.setInterval = (handler, delay = 0, ...args) => {
    const id = nativeSetInterval(handler, delay, ...args);
    state.intervals.add(id);
    return id;
  };
  window.clearInterval = (id) => { state.intervals.delete(id); return nativeClearInterval(id); };
  window.requestAnimationFrame = (callback) => {
    let id = 0;
    id = nativeRAF((timestamp) => { state.animationFrames.delete(id); callback(timestamp); });
    state.animationFrames.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => { state.animationFrames.delete(id); return nativeCancelRAF(id); };

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args) {
      const socket = Reflect.construct(target, args, target);
      liveSockets.add(socket);
      socket.addEventListener('close', () => liveSockets.delete(socket), { once: true });
      return socket;
    }
  });

  window.__mcBrowserSmoke = {
    get timeoutCapMs() { return state.timeoutCapMs; },
    set timeoutCapMs(value) { state.timeoutCapMs = Number.isFinite(value) ? Math.max(1, Number(value)) : null; },
    snapshot: () => ({
      listeners: state.listeners,
      listenerTypes: { ...state.listenerTypes },
      timeouts: state.timeouts.size,
      intervals: state.intervals.size,
      animationFrames: state.animationFrames.size
    }),
    openSocketCount: () => [...liveSockets].filter((candidate) => candidate.readyState === NativeWebSocket.OPEN).length,
    injectSocketMessages: (messages) => {
      const socket = [...liveSockets].find((candidate) => candidate.readyState === NativeWebSocket.OPEN);
      if (!socket) throw new Error('no open public WebSocket available for live-flow smoke');
      for (const message of messages) {
        socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
      }
      return messages.length;
    }
  };
}

async function smokeSparseLiveFlow(page) {
  await page.waitForFunction(() => Number(window.__mcBrowserSmoke?.openSocketCount?.() ?? 0) > 0, null, { timeout: 15_000 });
  const injected = await page.evaluate(async () => {
    const response = await fetch(`/api/v1/public/state?browserSmokeLive=${Date.now()}`, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`full state HTTP ${response.status}`);
    const state = await response.json();
    const route = state.routes?.[0];
    const source = state.recentPulses?.find((pulse) => pulse?.segments?.length) ?? (route ? {
      id: 'browser-smoke-route-source',
      payloadTypeName: route.payloadTypeNames?.[0] ?? 'PLAIN_TEXT',
      heardAt: Date.now(),
      segments: [{ routeId: route.id, from: route.from, to: route.to, distanceKm: route.distanceKm }]
    } : null);
    if (!source?.segments?.length) throw new Error('fixture has no routed topology for live-flow injection');
    const shell = document.querySelector('.app-shell');
    if (!(shell instanceof HTMLElement)) throw new Error('app shell is unavailable');
    const baselineSeq = Number(shell.dataset.liveSeq ?? 0);
    const count = 200;
    const firstSeq = baselineSeq + 1;
    const finalSeq = baselineSeq + count;
    const now = Date.now();
    if (window.__mcCartoLivePerf) {
      window.__mcCartoLivePerf.packetActiveComets = 0;
      window.__mcCartoLivePerf.packetActiveCometIDs = [];
      window.__mcCartoLivePerf.packetFrameSamplesMs = [];
      window.__mcCartoLivePerf.packetFrameP95Ms = 0;
      window.__mcCartoLivePerf.liveStateLatencySamplesMs = [];
      window.__mcCartoLivePerf.liveStateLatencyP95Ms = 0;
      window.__mcCartoLivePerf.liveStateLatencyMaxMs = 0;
      window.__mcCartoLivePerf.liveAnimationLatencySamplesMs = [];
      window.__mcCartoLivePerf.liveAnimationLatencyP95Ms = 0;
      window.__mcCartoLivePerf.liveAnimationLatencyMaxMs = 0;
      window.__mcCartoLivePerf.liveAnimationStarts = 0;
      window.__mcCartoLivePerf.liveAnimationEmergencyStarts = 0;
      window.__mcCartoLivePerf.longTasks = 0;
      window.__mcCartoLivePerf.longestTaskMs = 0;
    }
    const pulse = (id, heardAt) => ({ ...source, id, seq: undefined, heardAt, receivedAt: heardAt, displayAt: heardAt });
    const messages = Array.from({ length: count }, (_, index) => {
      const ordinal = index + 1;
      const seq = baselineSeq + ordinal;
      const fallback = ordinal % 50 === 0 && ordinal !== count;
      return {
        v: 1,
        type: 'event',
        event: 'routePulse',
        ...(fallback ? {} : { seq }),
        latestSeq: fallback ? seq - 1 : seq,
        serverTime: now,
        receivedAt: now,
        displayAt: now,
        data: pulse(`browser-smoke-live-${ordinal}`, now)
      };
    });
    const injectedCount = window.__mcBrowserSmoke.injectSocketMessages(messages);
    return { baselineSeq, firstSeq, finalSeq, finalID: `browser-smoke-live-${count}`, count: injectedCount };
  });

  const applied = await page.waitForFunction(({ finalSeq, finalID }) => {
    const shell = document.querySelector('.app-shell');
    return shell instanceof HTMLElement && Number(shell.dataset.liveSeq) === finalSeq && shell.dataset.latestPulseId === finalID;
  }, injected, { timeout: 10_000 }).then(() => true, () => false);
  if (!applied) {
    const state = await page.evaluate(() => {
      const shell = document.querySelector('.app-shell');
      return {
        liveSeq: shell instanceof HTMLElement ? shell.dataset.liveSeq : null,
        latestPulseID: shell instanceof HTMLElement ? shell.dataset.latestPulseId : null,
        openSockets: Number(window.__mcBrowserSmoke?.openSocketCount?.() ?? 0),
        activeComets: Number(window.__mcCartoLivePerf?.packetActiveComets ?? 0)
      };
    });
    throw new Error(`injected live events were not applied: expected seq=${injected.finalSeq} pulse=${injected.finalID}; observed ${JSON.stringify(state)}`);
  }
  await page.waitForFunction(({ count }) => {
    const perf = window.__mcCartoLivePerf;
    return Number(perf?.liveAnimationStarts ?? 0) >= count && Number(perf?.liveVisualQueueDepth ?? 0) === 0;
  }, injected, { timeout: 10_000 });
  const metrics = await page.evaluate(() => {
    const perf = window.__mcCartoLivePerf;
    return {
      receiveToStateP95Ms: Number(perf?.liveStateLatencyP95Ms ?? 0),
      receiveToStateMaxMs: Number(perf?.liveStateLatencyMaxMs ?? 0),
      receiveToAnimationP95Ms: Number(perf?.liveAnimationLatencyP95Ms ?? 0),
      maxVisualAgeMs: Number(perf?.liveAnimationLatencyMaxMs ?? 0),
      animationStarts: Number(perf?.liveAnimationStarts ?? 0),
      emergencyActivations: Number(perf?.liveAnimationEmergencyStarts ?? 0),
      frameP95Ms: Number(perf?.packetFrameP95Ms ?? 0),
      repeatedLongTasks: Number(perf?.longTasks ?? 0),
      longestTaskMs: Number(perf?.longestTaskMs ?? 0),
      queueOldestAgeMs: Number(perf?.liveVisualQueueOldestAgeMs ?? 0),
      routeReducerMs: Number(perf?.routeReducerMs ?? 0)
    };
  });
  if (metrics.animationStarts !== injected.count) throw new Error(`animation starts=${metrics.animationStarts}, eligible=${injected.count}`);
  if (metrics.emergencyActivations !== 0) throw new Error(`emergency visual starts=${metrics.emergencyActivations}`);
  if (metrics.receiveToStateP95Ms >= 1000) throw new Error(`receive-to-state p95=${metrics.receiveToStateP95Ms}ms`);
  if (metrics.receiveToAnimationP95Ms >= 2000) throw new Error(`receive-to-animation p95=${metrics.receiveToAnimationP95Ms}ms`);
  if (metrics.maxVisualAgeMs > 5000) throw new Error(`maximum visual age=${metrics.maxVisualAgeMs}ms`);
  if (metrics.frameP95Ms > 34) throw new Error(`animation frame p95=${metrics.frameP95Ms}ms`);
  if (metrics.repeatedLongTasks !== 0) throw new Error(`repeated long tasks=${metrics.repeatedLongTasks}, longest=${metrics.longestTaskMs}ms`);
  return { ...injected, metrics };
}

async function smokeLiveMapControls(page, viewport) {
  await assertNoNocSummary(page);
  await assertRetiredPlaybackControlsAbsent(page);
  if (viewport.isMobile) {
    await assertVisibleInViewport(page, '.mobile-control-dock', 'mobile control dock', viewport);
    return;
  }
  await smokeOpenFreeMapToggle(page, viewport);
  await smokePalettePicker(page, viewport);
  await smokeTopInfoPanels(page, viewport);
}

async function waitForTopologyHydration(page, timeout = 15_000) {
  await page.waitForFunction(() => {
    const shell = document.querySelector('.app-shell[data-topology-hydrated="true"]');
    if (!(shell instanceof HTMLElement)) return false;
    return Number(shell.dataset.topologyNodeCount) > 0 && Number(shell.dataset.topologyRouteCount) > 0;
  }, null, { timeout });
}

async function assertNoNocSummary(page) {
  const nocCount = await page.locator('.noc-summary').count();
  if (nocCount > 0) throw new Error(`NOC summary chrome should not render, found ${nocCount}`);
}

async function assertRetiredPlaybackControlsAbsent(page) {
  const retiredSelectors = '.vcr-mini-clock, .vcr-bar, .vcr-open-button, .replay-studio-toggle, .rf-replay-studio, [data-vcr-layout], [aria-label="RF Replay Studio"]';
  const retiredSurfaceCount = await page.locator(retiredSelectors).count();
  if (retiredSurfaceCount > 0) throw new Error(`retired Timeline/VCR or RF Replay Studio surfaces still render: ${retiredSurfaceCount}`);
  const retiredButtonCount = await page.locator('button').filter({ hasText: /RF Replay Studio|Live timeline|Export WebM/i }).count();
  if (retiredButtonCount > 0) throw new Error(`retired playback/export controls still render: ${retiredButtonCount}`);
}

async function smokeOpenFreeMapToggle(page, viewport) {
  const toggle = page.locator('.map-base-toggle').first();
  if (await toggle.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await toggle.click();
    await page.waitForSelector('.map-base-toggle.active', { state: 'visible', timeout: 15_000 });
    await page.waitForSelector('.map-wrap[data-map-style-profile="openfreemap-3d"]', { state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(500);
    await assertVisibleInViewport(page, '.maplibregl-canvas', 'OpenFreeMap canvas', viewport);
    return;
  }
  const settings = page.locator('.map-settings-toggle').first();
  await settings.waitFor({ state: 'visible', timeout: 12_000 });
  await settings.click({ force: true });
  await assertVisibleInViewport(page, '.map-settings-drawer', 'map settings drawer for OpenFreeMap', viewport);
  await page.locator('.map-mode-grid').getByRole('button', { name: /Studio/i }).click();
  await page.waitForSelector('.map-wrap[data-map-style-profile="openfreemap-3d"]', { state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: /Close map settings/i }).click();
  await page.waitForSelector('.map-settings-drawer', { state: 'hidden', timeout: 5_000 });
  await page.waitForTimeout(500);
  await assertVisibleInViewport(page, '.maplibregl-canvas', 'OpenFreeMap canvas', viewport);
}

async function smokePalettePicker(page, viewport) {
  const toggle = page.locator('.palette-toggle').first();
  if (!await toggle.isVisible({ timeout: 2_000 }).catch(() => false)) return;
  await toggle.click();
  await assertVisibleInViewport(page, '.palette-picker', 'palette picker', viewport);
  const options = page.locator('.palette-picker button');
  const optionCount = await options.count();
  if (optionCount < 4) throw new Error(`palette picker has too few options: ${optionCount}`);
  await options.nth(Math.min(1, optionCount - 1)).click();
  await page.waitForSelector('.palette-picker', { state: 'hidden', timeout: 5_000 });
}

async function smokeSetupPanel(page, viewport) {
  await assertVisibleInViewport(page, 'section.setup-panel[aria-label="First-run setup"]', 'first-run setup dialog', viewport);
  await activateSetupPreset(page, 'custom');
  await page.waitForFunction(() => {
    const activePreset = document.querySelector('.setup-presets button.active')?.textContent?.trim().toLowerCase();
    const snippet = document.querySelector('.setup-output pre')?.textContent ?? document.querySelector('.setup-panel pre')?.textContent ?? '';
    return activePreset === 'custom' && snippet.includes('MAP_REGION_PRESET=custom');
  }, null, { timeout: 12_000 });

  const snippet = await page.waitForFunction(() => {
    return document.querySelector('.setup-output pre')?.textContent
      ?? document.querySelector('.setup-panel pre')?.textContent
      ?? '';
  }, null, { timeout: 30_000 }).then((handle) => handle.jsonValue());
  const required = [
    'MAP_REGION_PRESET=custom',
    'PUBLIC_REGIONS=',
    'MAP_BOUNDS=-85,-180,85,180'
  ];
  for (const item of required) {
    if (!snippet?.includes(item)) throw new Error(`setup generated env is missing ${item}`);
  }
  if (/PASSWORD|SECRET|TOKEN|PRIVATE/i.test(snippet ?? '')) {
    throw new Error('setup generated env unexpectedly includes secret-oriented fields');
  }
}

async function smokePacketsAnimation(page, viewport) {
  const row = await waitForPacketRow(page, false);
  if (!row) {
    const empty = await page.locator('.packets-empty').first().textContent({ timeout: 2_000 }).catch(() => 'No packets available');
    if (!empty || !empty.toLowerCase().includes('no true path packets')) {
      throw new Error(`Packets animation smoke found no row and no clear empty state: ${compactText(empty)}`);
    }
    return;
  }

  if (!viewport.isMobile) {
    const toggle = page.locator('.map-base-toggle').first();
    if (await toggle.isVisible({ timeout: 2_000 }).catch(() => false) && !(await toggle.evaluate((button) => button.classList.contains('active')))) {
      await toggle.click();
      await page.waitForSelector('.map-base-toggle.active', { state: 'visible', timeout: 15_000 });
      await page.waitForSelector('.map-wrap[data-map-style-profile="openfreemap-3d"]', { state: 'visible', timeout: 15_000 });
      await page.waitForSelector('.map-wrap[data-map-base-mode="openfreemap"]', { state: 'visible', timeout: 15_000 });
    }
  }

  const before = await readMapViewData(page);
  await row.locator('.packet-replay-button').click();
  await page.waitForSelector('.app-shell[data-packets-mode="compactTray"]', { state: 'visible', timeout: 10_000 });
  await assertVisibleInViewport(page, 'section.packets-compact-tray[aria-label="Selected packet animation"]', 'Packets compact animation tray', viewport);
  await page.getByRole('button', { name: /Animate again/i }).waitFor({ state: 'visible', timeout: 8_000 });
  const liveFlow = await page.locator('.app-shell').getAttribute('data-live-flow');
  if (liveFlow !== 'live') throw new Error(`PacketTV animation replaced the live stream: ${liveFlow}`);
  const animated = await page.waitForFunction(() => Number(window.__mcCartoLivePerf?.packetActiveComets ?? 0) > 0, null, { timeout: 8_000 }).then(() => true, () => false);
  if (!animated) {
    const active = await page.evaluate(() => ({
      count: Number(window.__mcCartoLivePerf?.packetActiveComets ?? 0),
      ids: Array.isArray(window.__mcCartoLivePerf?.packetActiveCometIDs) ? window.__mcCartoLivePerf.packetActiveCometIDs : []
    }));
    throw new Error(`PacketTV direct animation did not start its map comet: ${JSON.stringify(active)}`);
  }

  if (!viewport.isMobile) {
    await page.waitForTimeout(2600);
    const after = await readMapViewData(page);
    if (before && after && after.baseMode === 'openfreemap' && !mapViewChanged(before, after)) {
      throw new Error(`OpenFreeMap packet animation did not move the map camera: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    }
  }
}

async function smokeChatPanel(page) {
  const hasRow = await page.locator('.chat-row').first().isVisible({ timeout: 2_000 }).catch(() => false);
  const hasEmpty = await page.locator('.chat-empty').first().isVisible({ timeout: 2_000 }).catch(() => false);
  if (!hasRow && !hasEmpty) {
    throw new Error('Chat panel has neither messages nor empty state after initial load');
  }

  const endpointCheck = await page.evaluate(async () => {
    const params = new URLSearchParams({
      from: String(Math.max(0, Date.now() - 60 * 60_000)),
      to: String(Date.now()),
      limit: '50'
    });
    const response = await fetch(`/api/v1/public/chat?${params.toString()}`, { headers: { accept: 'application/json' } });
    if (!response.ok) return `HTTP ${response.status}`;
    const body = await response.json().catch(() => null);
    if (!body || !Array.isArray(body.messages) || !Number.isFinite(Number(body.serverTime))) return `invalid chat body: ${JSON.stringify(body)}`;
    return 'ok';
  });
  if (endpointCheck !== 'ok') {
    throw new Error(`Chat endpoint smoke check failed: ${endpointCheck}`);
  }
}

async function smokeLabsPanel(page, viewport) {
  await page.waitForURL(/#\/lab\/waterfall$/, { timeout: 8_000 });
  const retired = ['synth', 'sequencer', 'organism', 'constellation', 'aurora', 'dj', 'radar', 'fireflies'];
  for (const id of retired) {
    await page.evaluate((experimentID) => { window.location.hash = `#/lab/${experimentID}`; }, id);
    await page.waitForURL(/#\/lab\/waterfall$/, { timeout: 5_000 });
    await page.waitForSelector('.lab-panel', { state: 'visible', timeout: 8_000 });
  }
  const toolbarCount = await page.locator('.lab-toolbar a').count();
  if (toolbarCount !== 0) throw new Error(`Waterfall Labs should not render retired experiment toolbar, found ${toolbarCount}`);
  await assertVisibleInViewport(page, '.waterfall-stage-shell', 'Waterfall stage', viewport);
  await assertVisibleInViewport(page, '.waterfall-control-surface', 'Waterfall controls', viewport);
  await assertVisibleInViewport(page, '.waterfall-canvas', 'Waterfall canvas', viewport);
  await assertCanvasHasPixels(page, '.waterfall-canvas', 'Waterfall canvas');
  const volume = page.locator('#lab-volume').first();
  if (await volume.count()) await setRangeInputValue(volume, 0.18);
  const waterfallVolume = page.locator('#waterfall-volume').first();
  await setRangeInputValue(waterfallVolume, 0.18);
  const density = page.locator('#waterfall-density').first();
  await setRangeInputValue(density, 1.1);
  const reducedMotion = page.locator('.waterfall-toggle-row input').first();
  await reducedMotion.check();
  await page.locator('#waterfall-window').selectOption('45');
  await page.evaluate(() => { window.location.hash = '#/lab'; });
  await page.waitForURL(/#\/lab\/waterfall$/, { timeout: 5_000 });
  await assertCanvasHasPixels(page, '.waterfall-canvas', 'Waterfall canvas after controls');
}

async function smokeNodeListPanel(page, viewport) {
  await page.waitForSelector('.node-list-panel', { state: 'visible', timeout: 12_000 });
  await assertNoNocSummary(page);
  const search = page.locator('.node-list-search input').first();
  await search.fill('repeater');
  await page.waitForTimeout(250);
  await assertVisibleInViewport(page, '.node-list-panel', 'Node List panel after search', viewport);
  const rowCount = await page.locator('.node-list-table tbody tr').count();
  if (rowCount < 1) throw new Error('Node List search returned no rows for repeater');
  await search.fill('');
  await page.locator('.node-list-toolbar select').nth(1).selectOption('recent').catch(() => {});
  await page.waitForTimeout(150);
}

async function smokeNetGraphPanel(page, viewport) {
  const search = page.locator('.netgraph-search input').first();
  await search.waitFor({ state: 'visible', timeout: 12_000 });
  await search.fill('repeater');
  await page.waitForTimeout(250);
  await assertVisibleInViewport(page, '.netgraph-canvas', 'NetGraph canvas after search', viewport);

  const canvasState = await page.locator('.netgraph-canvas').first().evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const box = canvas.getBoundingClientRect();
    return {
      cssWidth: box.width,
      cssHeight: box.height,
      width: canvas.width,
      height: canvas.height
    };
  });
  if (!canvasState || canvasState.cssWidth < 50 || canvasState.cssHeight < 50 || canvasState.width < 50 || canvasState.height < 50) {
    throw new Error(`NetGraph canvas invalid size: ${JSON.stringify(canvasState)}`);
  }

  const box = await page.locator('.netgraph-canvas').first().boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

async function assertCanvasHasPixels(page, selector, label) {
  const canvasState = await page.locator(selector).first().evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const box = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { cssWidth: box.width, cssHeight: box.height, width: canvas.width, height: canvas.height, colored: 0 };
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    const sample = ctx.getImageData(Math.floor(width * 0.2), Math.floor(height * 0.2), Math.max(1, Math.floor(width * 0.6)), Math.max(1, Math.floor(height * 0.6))).data;
    let colored = 0;
    for (let index = 0; index < sample.length; index += 16) {
      if (sample[index] > 4 || sample[index + 1] > 4 || sample[index + 2] > 4 || sample[index + 3] > 4) colored += 1;
      if (colored > 40) break;
    }
    return { cssWidth: box.width, cssHeight: box.height, width: canvas.width, height: canvas.height, colored };
  });
  if (!canvasState || canvasState.cssWidth < 50 || canvasState.cssHeight < 50 || canvasState.width < 50 || canvasState.height < 50 || canvasState.colored <= 40) {
    throw new Error(`${label} invalid or blank: ${JSON.stringify(canvasState)}`);
  }
}

async function waitForPacketRow(page, requireRow = true) {
  const row = page.locator('.packet-row').first();
  if (await waitForVisible(row, 120_000)) return row;

  const refresh = page.getByRole('button', { name: /Refresh packets/i }).first();
  if (await refresh.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await refresh.click();
    if (await waitForVisible(row, 90_000)) return row;
  }

  const twentyFourHour = page.locator('.packets-scopes').getByRole('button', { name: /^24h$/i });
  if (await twentyFourHour.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await twentyFourHour.click();
    if (await waitForVisible(row, 120_000)) return row;
  }

  if (!requireRow) return null;
  const error = await page.locator('.packets-error').first().textContent({ timeout: 1_000 }).catch(() => '');
  const empty = await page.locator('.packets-empty').first().textContent({ timeout: 1_000 }).catch(() => '');
  const panel = await page.locator('.packets-panel').first().textContent({ timeout: 1_000 }).catch(() => '');
  throw new Error(`Packets animation smoke could not load a true path row. ${compactText(error || empty || panel)}`);
}

async function activateSetupPreset(page, preset) {
  await page.waitForSelector('.setup-presets button', { state: 'visible', timeout: 12_000 });
  await page.evaluate((nextPreset) => {
    const button = Array.from(document.querySelectorAll('.setup-presets button'))
      .find((candidate) => candidate.textContent?.trim().toLowerCase() === String(nextPreset).toLowerCase());
    if (!(button instanceof HTMLButtonElement)) throw new Error(`setup preset button not found: ${nextPreset}`);
    button.click();
  }, preset);
}

async function setRangeInputValue(locator, value) {
  await locator.evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function readMapViewData(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.map-wrap');
    if (!wrap) return null;
    return {
      baseMode: wrap.getAttribute('data-map-base-mode') ?? '',
      styleProfile: wrap.getAttribute('data-map-style-profile') ?? '',
      lat: Number(wrap.getAttribute('data-map-center-lat')),
      lng: Number(wrap.getAttribute('data-map-center-lng')),
      zoom: Number(wrap.getAttribute('data-map-zoom'))
    };
  });
}

function mapViewChanged(before, after) {
  return Math.abs(after.lat - before.lat) > 0.0005
    || Math.abs(after.lng - before.lng) > 0.0005
    || Math.abs(after.zoom - before.zoom) > 0.05;
}

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

async function waitForVisible(locator, timeout) {
  return locator.waitFor({ state: 'visible', timeout }).then(() => true, () => false);
}

async function smokeTopInfoPanels(page, viewport) {
  if (viewport.isMobile) return;

  await clickTopInfoButton(page, /Changelog/i, '.link-bar-info-popover', 'latest changelog popover', viewport);
  await clickTopInfoButton(page, /Features/i, '.link-bar-info-popover', 'feature list popover', viewport);
  await clickTopInfoButton(page, /Guide/i, '.visitor-guide', 'guide panel', viewport);
}

async function clickTopInfoButton(page, name, selector, label, viewport) {
  const button = page.getByRole('button', { name }).first();
  if (!await button.isVisible({ timeout: 1000 }).catch(() => false)) return;
  await button.click();
  await assertVisibleInViewport(page, selector, label, viewport);
  const close = page.locator(selector).getByRole('button', { name: /close/i }).first();
  if (await close.isVisible({ timeout: 1000 }).catch(() => false)) await close.click();
  await page.waitForSelector(selector, { state: 'hidden', timeout: 5_000 }).catch(() => {});
}

async function assertVisibleInViewport(page, selector, label, viewport) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 30_000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} (${selector}) has no visible bounding box`);
  if (box.width < 4 || box.height < 4) throw new Error(`${label} (${selector}) is too small: ${box.width}x${box.height}`);

  const fudge = 2;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  if (box.x < -fudge || box.y < -fudge || right > viewport.width + fudge || bottom > viewport.height + fudge) {
    throw new Error(`${label} (${selector}) is clipped in ${viewport.name}: ${formatBox(box)} within ${viewport.width}x${viewport.height}`);
  }
}

async function assertGlobalReleaseChecks(page, errors) {
  const panelErrors = await page.locator('.panel-error').count();
  if (panelErrors > 0) {
    const text = await page.locator('.panel-error').first().textContent().catch(() => '');
    errors.push(`panel-error rendered: ${panelErrors} ${compactText(text)}`);
  }

  const serviceWorkerControlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)).catch(() => false);
  if (serviceWorkerControlled && process.env.VITE_ENABLE_SERVICE_WORKER !== 'true') {
    errors.push('service worker controlled page while disabled');
  }
}

async function dismissWelcome(page) {
  const start = page.getByRole('button', { name: /start watching/i });
  if (await start.isVisible({ timeout: 1000 }).catch(() => false)) {
    await start.click();
    return;
  }
  const close = page.locator('.welcome-guide-close, .visitor-guide-close').first();
  if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
    await close.click();
    return;
  }
  const visibleGuide = page.locator('.welcome-guide-popover, .visitor-guide').first();
  if (await visibleGuide.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('.welcome-guide-popover, .visitor-guide').first().evaluate((node) => {
      if (node instanceof HTMLElement) node.style.display = 'none';
    }).catch(() => {});
  }
}

async function launchBrowser({ channel, headless }) {
  try {
    return await chromium.launch({ channel, headless });
  } catch (channelError) {
    try {
      return await chromium.launch({ headless });
    } catch (fallbackError) {
      const channelMessage = channelError instanceof Error ? channelError.message : String(channelError);
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `Unable to launch Chromium for browser smoke. Tried channel "${channel}" and bundled Chromium.\n` +
        `Install a browser with: npm --prefix web exec playwright install chromium\n` +
        `Channel error: ${channelMessage}\nBundled error: ${fallbackMessage}`
      );
    }
  }
}

function urlForScenario(base, hash) {
  const url = new URL(base);
  url.hash = hash.startsWith('#') ? hash.slice(1) : hash;
  return url.toString();
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

function formatBox(box) {
  return `x=${box.x.toFixed(1)} y=${box.y.toFixed(1)} w=${box.width.toFixed(1)} h=${box.height.toFixed(1)}`;
}

function isIgnoredConsoleMessage(text) {
  return /favicon|ResizeObserver loop/i.test(text);
}

function isGenericFailedResourceConsoleMessage(text) {
  return /^Failed to load resource: the server responded with a status of \d+/i.test(text);
}

function isIgnoredFailedResource(status, url) {
  if (status !== 404) return false;
  return /^https:\/\/demotiles\.maplibre\.org\/font\/.+\.pbf(?:$|\?)/i.test(url)
    || /^https:\/\/tiles\.openfreemap\.org\/fonts\/.+\.pbf(?:$|\?)/i.test(url)
    || /\/favicon\.ico(?:$|\?)/i.test(url);
}
