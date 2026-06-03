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
      { selector: '.top-actions', label: 'top map actions' },
      { selector: '.vcr-mini-clock', label: 'mini live clock' },
      { selector: '.maplibregl-ctrl-bottom-right', label: 'map controls' }
    ],
    actions: [smokeLiveMapControls]
  },
  {
    name: 'perf',
    hash: '#/perf',
    waitFor: '.perf-panel',
    checks: [
      { selector: '.link-bar', label: 'top project bar' },
      { selector: '.perf-panel', label: 'Perf panel' }
    ]
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
      { selector: '.packets-panel', label: 'Packets panel' }
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
    ]
  },
  {
    name: 'netgraph',
    hash: '#/netgraph',
    waitFor: '.netgraph-panel',
    checks: [
      { selector: '.link-bar', label: 'top project bar' },
      { selector: '.netgraph-panel', label: 'NetGraph panel' },
      { selector: '.netgraph-canvas', label: 'NetGraph canvas' }
    ]
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

  page.on('console', (message) => {
    if (message.type() === 'error' && !isIgnoredConsoleMessage(message.text())) {
      consoleErrors.push(message.text());
    }
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
      await assertVisibleInViewport(page, check.selector, check.label, viewport);
    }

    for (const action of scenario.actions ?? []) {
      await action(page, viewport);
    }

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
  await smokeOpenFreeMapToggle(page, viewport);
  await smokePalettePicker(page, viewport);
  await smokeMapSettings(page, viewport);
  await smokeVcr(page, viewport);
  await smokeTopInfoPanels(page, viewport);
}

async function smokeOpenFreeMapToggle(page, viewport) {
  const toggle = page.locator('.map-base-toggle').first();
  await toggle.waitFor({ state: 'visible', timeout: 12_000 });
  await toggle.click();
  await page.waitForSelector('.map-base-toggle.active', { state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(500);
  await assertVisibleInViewport(page, '.maplibregl-canvas', 'OpenFreeMap canvas', viewport);
  await toggle.click();
  await page.waitForTimeout(300);
}

async function smokePalettePicker(page, viewport) {
  const toggle = page.locator('.palette-toggle').first();
  await toggle.waitFor({ state: 'visible', timeout: 12_000 });
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
  await toggle.click();
  await assertVisibleInViewport(page, '.map-settings-drawer', 'map settings drawer', viewport);
  await page.locator('.map-settings-drawer').getByText(/Live Packet Style/i).waitFor({ state: 'visible', timeout: 5_000 });
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
    await page.waitForSelector('.vcr-hover-time', { state: 'visible', timeout: 5_000 });
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

  const replayAttempt = page.waitForFunction(() => {
    const readout = document.querySelector('.vcr-readout')?.textContent ?? '';
    const bar = document.querySelector('.vcr-bar');
    return readout.includes('REPLAY LOADING') || bar?.classList.contains('replay') || Boolean(document.querySelector('.vcr-live-clock-icon.spinning'));
  }, null, { timeout: 10_000 });
  await page.getByRole('button', { name: /Replay from selected time/i }).click();
  await replayAttempt;
  await page.waitForFunction(() => {
    const readout = document.querySelector('.vcr-readout')?.textContent ?? '';
    return !readout.includes('REPLAY LOADING');
  }, null, { timeout: 20_000 }).catch(() => {});
  const readoutText = await page.locator('.vcr-readout').first().textContent();
  if (/NO REPLAY EVENTS|REPLAY ERROR/i.test(readoutText ?? '')) {
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
    'MAP_BOUNDS=-45,110,-10,155'
  ];
  for (const item of required) {
    if (!snippet?.includes(item)) throw new Error(`setup generated env is missing ${item}`);
  }
  if (/PASSWORD|SECRET|TOKEN|PRIVATE/i.test(snippet ?? '')) {
    throw new Error('setup generated env unexpectedly includes secret-oriented fields');
  }
}

async function smokePacketsReplay(page, viewport) {
  const row = await waitForPacketRow(page);
  await row.locator('.packet-row-main').click();
  await page.waitForSelector('.packet-row.selected', { state: 'visible', timeout: 8_000 });
  await page.waitForSelector('.packet-detail:not(.empty)', { state: 'visible', timeout: 8_000 });

  if (!viewport.isMobile) {
    const toggle = page.locator('.map-base-toggle').first();
    if (await toggle.isVisible({ timeout: 2_000 }).catch(() => false) && !(await toggle.evaluate((button) => button.classList.contains('active')))) {
      await toggle.click();
      await page.waitForSelector('.map-base-toggle.active', { state: 'visible', timeout: 15_000 });
      await page.waitForSelector('.map-wrap[data-map-base-mode="openfreemap"]', { state: 'visible', timeout: 15_000 });
    }
  }

  const before = await readMapViewData(page);
  await page.locator('.packet-detail .packet-detail-actions').getByRole('button', { name: /^Replay$/i }).click();
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

async function waitForPacketRow(page) {
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
        const routePulse = routePulses.at(-1);
        diagnostics.push(`${item.label}: ${routePulses.length} routed pulses / ${events.length} events`);
        if (routePulse) return { timestamp: routePulse.at, scopeLabel: item.label };
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
    input.value = String(Math.round(nextValue));
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
  await clickTopInfoButton(page, /Guide/i, '.guide-overlay', 'guide overlay', viewport);
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

async function dismissWelcome(page) {
  const start = page.getByRole('button', { name: /start watching/i });
  if (await start.isVisible({ timeout: 1000 }).catch(() => false)) {
    await start.click();
    return;
  }
  const close = page.locator('.welcome-guide-close').first();
  if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
    await close.click();
    return;
  }
  const visibleGuide = page.locator('.welcome-guide-popover, .guide-overlay').first();
  if (await visibleGuide.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('.welcome-guide-popover, .guide-overlay').first().evaluate((node) => {
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
  return /favicon|ResizeObserver loop|Failed to load resource: the server responded with a status of 404/i.test(text);
}
