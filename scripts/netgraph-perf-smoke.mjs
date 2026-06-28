#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const requireFromWeb = createRequire(path.join(rootDir, 'web', 'package.json'));
const { chromium } = requireFromWeb('playwright');

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args['base-url'] ?? process.env.NETGRAPH_PERF_BASE_URL ?? 'http://127.0.0.1:39476');
const outputDir = path.resolve(String(args['output-dir'] ?? process.env.NETGRAPH_PERF_OUTPUT_DIR ?? path.join(rootDir, 'artifacts', 'netgraph-perf')));
const headed = args.headed !== undefined;
const screenshot = args.screenshot !== undefined;
const timeoutMs = Number(args['timeout-ms'] ?? process.env.NETGRAPH_PERF_TIMEOUT_MS ?? 60_000);
const channel = args.channel ? String(args.channel) : (process.env.PLAYWRIGHT_CHROME_CHANNEL || 'chrome');

if (screenshot) await mkdir(outputDir, { recursive: true });

const browser = await launchBrowser({ channel, headless: !headed });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message || String(error)));
  await page.addInitScript(() => {
    localStorage.setItem('mc-cartolive-debug-perf', '1');
  });
  const startedAt = Date.now();
  await page.goto(`${baseUrl.replace(/\/$/, '')}/#/netgraph`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForSelector('.netgraph-canvas', { state: 'visible', timeout: timeoutMs });
  await page.waitForFunction(() => {
    const perf = window.__mcCartoLivePerf;
    return Boolean(perf && (perf.netGraphWorkerTransforms + perf.netGraphWorkerFallbacks) > 0 && perf.netGraphDrawMs >= 0);
  }, null, { timeout: timeoutMs });
  await page.waitForTimeout(600);
  const canvas = await page.locator('.netgraph-canvas').first().evaluate((item) => {
    if (!(item instanceof HTMLCanvasElement)) return null;
    const box = item.getBoundingClientRect();
    const ctx = item.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { cssWidth: box.width, cssHeight: box.height, width: item.width, height: item.height, colored: 0 };
    const sampleWidth = Math.min(item.width, 240);
    const sampleHeight = Math.min(item.height, 160);
    const pixels = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
    let colored = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] || pixels[index + 1] || pixels[index + 2]) colored += 1;
    }
    return { cssWidth: box.width, cssHeight: box.height, width: item.width, height: item.height, colored };
  });
  if (!canvas || canvas.cssWidth < 100 || canvas.cssHeight < 100 || canvas.colored <= 100) {
    throw new Error(`NetGraph canvas invalid or blank: ${JSON.stringify(canvas)}`);
  }
  const perf = await page.evaluate(() => window.__mcCartoLivePerf ?? null);
  const summary = {
    baseUrl,
    passed: errors.length === 0,
    firstReadyMs: Date.now() - startedAt,
    canvas,
    perf,
    errors
  };
  if (screenshot) {
    summary.screenshot = path.join(outputDir, 'netgraph-perf.png');
    await page.screenshot({ path: summary.screenshot, fullPage: false });
  }
  console.log(JSON.stringify(summary, null, 2));
  if (errors.length > 0) process.exit(1);
  console.log('netgraph perf smoke ok');
} finally {
  await browser.close();
}

async function launchBrowser({ channel, headless }) {
  try {
    return await chromium.launch({ channel, headless });
  } catch (error) {
    if (!channel) throw error;
    return await chromium.launch({ headless });
  }
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
