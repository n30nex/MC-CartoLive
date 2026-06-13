#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const requireFromWeb = createRequire(path.join(rootDir, 'web', 'package.json'));
const { chromium } = requireFromWeb('playwright');

const DEFAULT_BASE_URL = 'http://127.0.0.1:39476';
const DEFAULT_OUTPUT_DIR = path.join(rootDir, 'artifacts', 'browser-smoke');
const appVersion = readFileSync(path.join(rootDir, 'VERSION'), 'utf8').trim();

const viewports = [
  { name: 'desktop-1920', width: 1920, height: 1080, isMobile: false, hasTouch: false },
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
      { selector: '.vcr-mini-clock', label: 'mini live clock', desktopOnly: true },
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
    actions: [smokePacketsReplay]
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
const channel = args.channel ? String(args.channel) : (process.env.PLAYWRIGHT_CHROME_CHANNEL || 'chrome');

await mkdir(outputDir, { recursive: true });

const browser = await launchBrowser({ channel, headless });
const startedAt = new Date().toISOString();
const results = [];
let hardFailures = 0;

try {
  for (const viewport of viewports) {
    for (const scenario of scenarios) {
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
  viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
  scenarios: scenarios.map(({ name, hash }) => ({ name, hash })),
  passed: hardFailures === 0,
  failures: hardFailures,
  results
};

console.log(JSON.stringify(summary, null, 2));

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

    for (const check of scenario.checks) {
      if (check.desktopOnly && viewport.isMobile) continue;
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

async function smokeLiveMapControls(page, viewport) {
  await assertNoNocSummary(page);
  if (viewport.isMobile) {
    await assertVisibleInViewport(page, '.mobile-control-dock', 'mobile control dock', viewport);
    return;
  }
  await smokeOpenFreeMapToggle(page, viewport);
  await smokePalettePicker(page, viewport);
  await smokeMapSettings(page, viewport);
  if (!viewport.isMobile) await smokeVcr(page, viewport);
  await smokeTopInfoPanels(page, viewport);
}

async function assertNoNocSummary(page) {
  const nocCount = await page.locator('.noc-summary').count();
  if (nocCount > 0) throw new Error(`NOC summary chrome should not render, found ${nocCount}`);
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
  await page.locator('.map-mode-grid').getByRole('button', { name: /^3D\b/i }).click();
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

async function smokeMapSettings(page, viewport) {
  const toggle = page.locator('.map-settings-toggle').first();
  await toggle.waitFor({ state: 'visible', timeout: 12_000 });
  await toggle.click({ force: true });
  await assertVisibleInViewport(page, '.map-settings-drawer', 'map settings drawer', viewport);
  await page.locator('.map-settings-drawer').getByRole('heading', { name: /^Settings$/i }).waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('.map-settings-drawer').getByRole('button', { name: /Clean Live/i }).waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('.map-settings-drawer').getByRole('button', { name: /^3D\b/i }).first().waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('.map-settings-drawer').getByRole('button', { name: /Low Bandwidth/i }).waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('.map-settings-drawer').getByText(/3D And RF/i).waitFor({ state: 'visible', timeout: 5_000 });
  await page.getByRole('button', { name: /Close map settings/i }).click();
  await page.waitForSelector('.map-settings-drawer', { state: 'hidden', timeout: 5_000 });
}

async function smokeVcr(page, viewport) {
  await page.locator('.vcr-mini-clock').first().click();
  await assertVisibleInViewport(page, '.vcr-bar', 'VCR controls', viewport);
  await assertVisibleInViewport(page, '.vcr-timeline-shell', 'VCR timeline', viewport);

  const timeline = page.locator('.vcr-timeline-shell').first();
  const box = await timeline.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await page.waitForFunction(() => {
      const element = document.querySelector('.vcr-hover-time');
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
    }, null, { timeout: 5_000 });
    await assertVisibleInViewport(page, '.vcr-hover-time', 'VCR hover timestamp', viewport);
  }

  await page.getByRole('button', { name: /Change replay speed/i }).click();
  await smokeVcrScrubReplay(page);
  await page.getByRole('button', { name: /Hide VCR controls and return live/i }).click();
  await page.waitForSelector('.vcr-bar', { state: 'hidden', timeout: 5_000 });
  await assertVisibleInViewport(page, '.vcr-mini-clock', 'mini live clock after VCR close', viewport);
}

async function smokeVcrScrubReplay(page) {
  const replayTarget = await findRecentRoutePulseReplayTarget(page);
  if (!replayTarget?.timestamp) {
    throw new Error(`VCR replay smoke could not find a recent routePulse history event. ${compactText(replayTarget?.diagnostic)}`);
  }
  if (replayTarget.scopeLabel !== '1h') {
    await page.locator('.vcr-scope').getByRole('button', { name: new RegExp(`^${replayTarget.scopeLabel}$`, 'i') }).click();
    await page.waitForTimeout(250);
  }

  await setRangeInputValue(page.locator('input.vcr-timeline').first(), replayTarget.timestamp);
  await page.waitForSelector('.vcr-bar.paused', { state: 'visible', timeout: 8_000 });

  await page.getByRole('button', { name: /Replay from selected time/i }).click();
  const replayStarted = await page.waitForFunction(() => {
    const readout = document.querySelector('.vcr-readout')?.textContent ?? '';
    const bar = document.querySelector('.vcr-bar');
    const readoutText = readout.trim();
    return readout.includes('REPLAY LOADING') ||
      /^REPLAY (?!PAUSED)/i.test(readoutText) ||
      bar?.classList.contains('replay') ||
      Boolean(document.querySelector('.vcr-live-clock-icon.spinning')) ||
      /NO REPLAY EVENTS|REPLAY EMPTY|REPLAY ERROR|REPLAY RETRY/i.test(readout);
  }, null, { timeout: 15_000 }).then(() => true, () => false);
  const readoutAfterStart = await page.locator('.vcr-readout').first().textContent().catch(() => '');
  if (!replayStarted && /REPLAY PAUSED/i.test(readoutAfterStart ?? '')) {
    throw new Error(`VCR replay did not leave paused state: ${compactText(readoutAfterStart)}`);
  }
  await page.waitForFunction(() => {
    const readout = document.querySelector('.vcr-readout')?.textContent ?? '';
    return !readout.includes('REPLAY LOADING');
  }, null, { timeout: 20_000 }).catch(() => {});
  const readoutText = await page.locator('.vcr-readout').first().textContent();
  if (/NO REPLAY EVENTS|REPLAY EMPTY|REPLAY ERROR|REPLAY RETRY/i.test(readoutText ?? '')) {
    throw new Error(`VCR replay did not produce replayable route events: ${compactText(readoutText)}`);
  }
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

async function smokePacketsReplay(page, viewport) {
  const row = await waitForPacketRow(page, false);
  if (!row) {
    const empty = await page.locator('.packets-empty').first().textContent({ timeout: 2_000 }).catch(() => 'No packets available');
    if (!empty || !empty.toLowerCase().includes('no true path packets')) {
      throw new Error(`Packets replay smoke found no row and no clear empty state: ${compactText(empty)}`);
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
  await assertVisibleInViewport(page, 'section.packets-compact-tray[aria-label="Selected packet replay"]', 'Packets compact replay tray', viewport);
  await page.getByRole('button', { name: /Replay again/i }).waitFor({ state: 'visible', timeout: 8_000 });
  await page.getByRole('button', { name: /Resume live/i }).waitFor({ state: 'visible', timeout: 8_000 });

  if (!viewport.isMobile) {
    await page.waitForTimeout(2600);
    const after = await readMapViewData(page);
    if (before && after && after.baseMode === 'openfreemap' && !mapViewChanged(before, after)) {
      throw new Error(`OpenFreeMap packet replay did not move the map camera: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
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
  throw new Error(`Packets replay smoke could not load a true path row. ${compactText(error || empty || panel)}`);
}

async function findRecentRoutePulseReplayTarget(page) {
  return page.evaluate(async () => {
    const now = Date.now();
    const diagnostics = [];
    const windows = [
      { label: '1h', from: now - 60 * 60_000 },
      { label: '6h', from: now - 6 * 60 * 60_000 },
      { label: '24h', from: now - 24 * 60 * 60_000 }
    ];
    for (const item of windows) {
      const params = new URLSearchParams({
        from: String(Math.max(0, Math.round(item.from))),
        to: String(Math.round(now)),
        limit: '250'
      });
      try {
        const response = await fetch(`/api/v1/public/history?${params.toString()}`, { headers: { accept: 'application/json' } });
        if (!response.ok) {
          diagnostics.push(`${item.label}: HTTP ${response.status}`);
          continue;
        }
        const body = await response.json();
        const events = Array.isArray(body.events) ? body.events : [];
        const routePulses = events.filter((event) => event?.type === 'routePulse' && Number.isFinite(event.at));
        const routePulse = routePulses[0];
        diagnostics.push(`${item.label}: ${routePulses.length} routed pulses / ${events.length} events`);
        if (routePulse) return { timestamp: Math.max(0, routePulse.at - 1), scopeLabel: item.label };
      } catch (error) {
        diagnostics.push(`${item.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { diagnostic: diagnostics.join('; ') };
  });
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
