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
    name: 'packets',
    hash: '#/packets',
    waitFor: '.packets-panel',
    checks: [
      { selector: '.link-bar', label: 'top project bar' },
      { selector: '.packets-panel', label: 'Packets panel' }
    ]
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
  await page.getByRole('button', { name: /Hide VCR controls and return live/i }).click();
  await page.waitForSelector('.vcr-bar', { state: 'hidden', timeout: 5_000 });
  await assertVisibleInViewport(page, '.vcr-mini-clock', 'mini live clock after VCR close', viewport);
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
  await locator.waitFor({ state: 'visible', timeout: 12_000 });
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
  if (await close.isVisible({ timeout: 500 }).catch(() => false)) await close.click();
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
