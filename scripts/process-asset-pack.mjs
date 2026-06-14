#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { buildAssetPackManifest, PACK_PROFILE } from './asset-pack-manifest.mjs';

const root = new URL('..', import.meta.url);
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const records = buildAssetPackManifest();
const CRC_TABLE = makeCRCTable();

for (const record of records) {
  for (const target of record.targetFiles) {
    const path = fileURL(target);
    const dims = dimensionsFor(record, target);
    if (dryRun) {
      console.log(`${record.id} -> ${target} ${dims.width}x${dims.height}`);
      continue;
    }
    mkdirSync(dirname(fileURLToPath(path)), { recursive: true });
    if (record.category === 'pwa') {
      writeFileSync(path, JSON.stringify(pwaManifest(record.pack), null, 2) + '\n');
      continue;
    }
    const image = renderRecord(record, target, dims.width, dims.height);
    writeFileSync(path, encodePNG(image.width, image.height, image.data));
  }
}

if (!dryRun) {
  console.log(`processed ${records.length} asset records`);
}

function renderRecord(record, target, width, height) {
  const profile = colorProfile(record.pack);
  const image = createImage(width, height);
  switch (record.category) {
    case 'brand':
      if (target.includes('social-card') || target.includes('release-hero')) renderHero(image, profile, record.pack);
      else if (target.includes('empty-state')) renderWorkspace(image, profile, 'empty-state');
      else if (target.includes('offline')) renderBrandIcon(image, profile, record.pack, 'offline');
      else if (target.includes('loading')) renderBrandIcon(image, profile, record.pack, 'loading');
      else if (target.includes('logo-wide')) renderLogoWide(image, profile, record.pack);
      else renderBrandIcon(image, profile, record.pack, 'app');
      break;
    case 'role':
      renderRoleIcon(image, profile, roleFromTarget(target));
      break;
    case 'packet':
      renderPacketDot(image, profile, packetFromTarget(target));
      break;
    case 'effect':
      renderEffect(image, profile, effectFromTarget(target));
      break;
    case 'waterfall':
      renderWaterfall(image, profile, target.includes('mist'));
      break;
    case 'map':
      renderMapThumbnail(image, profile, mapFromTarget(target));
      break;
    case 'workspace':
      renderWorkspace(image, profile, workspaceFromTarget(target));
      break;
    default:
      renderHero(image, profile, record.pack);
  }
  return image;
}

function renderBrandIcon(image, profile, pack, mode) {
  fillGradient(image, profile, true);
  const { width, height } = image;
  const cx = width / 2;
  const cy = height / 2;
  const s = Math.min(width, height);
  vignette(image, profile.bg, 0.54);
  drawCircle(image, cx, cy, s * 0.39, profile.accent, 0.16);
  drawRing(image, cx, cy, s * 0.34, s * 0.026, profile.accent, 0.92);
  drawArc(image, cx, cy, s * 0.24, Math.PI * 1.08, Math.PI * 1.92, s * 0.035, '#eaf6ff', 0.94);
  drawLine(image, cx, cy + s * 0.06, cx, cy + s * 0.26, s * 0.045, '#eaf6ff', 0.96);
  drawLine(image, cx, cy + s * 0.06, cx - s * 0.17, cy + s * 0.31, s * 0.04, '#eaf6ff', 0.96);
  drawLine(image, cx, cy + s * 0.06, cx + s * 0.17, cy + s * 0.31, s * 0.04, '#eaf6ff', 0.96);
  drawLine(image, cx - s * 0.17, cy + s * 0.31, cx + s * 0.17, cy + s * 0.31, s * 0.035, profile.accent, 0.92);
  drawRing(image, cx, cy + s * 0.02, s * 0.075, s * 0.03, '#f8fbff', 0.98);
  if (pack === 'canada') {
    drawPolygon(image, mapleSignal(cx + s * 0.18, cy - s * 0.21, s * 0.13), profile.red, 0.9);
    drawRing(image, cx + s * 0.18, cy - s * 0.21, s * 0.12, s * 0.012, profile.secondary, 0.75);
  } else {
    drawStar(image, cx + s * 0.18, cy - s * 0.21, s * 0.12, profile.secondary, 0.78);
  }
  if (mode === 'offline') {
    drawLine(image, cx - s * 0.24, cy - s * 0.24, cx + s * 0.24, cy + s * 0.24, s * 0.055, profile.red, 0.94);
  }
  if (mode === 'loading') {
    drawArc(image, cx, cy, s * 0.44, -Math.PI * 0.2, Math.PI * 0.68, s * 0.03, profile.warm, 0.88);
  }
}

function renderLogoWide(image, profile, pack) {
  fillGradient(image, profile, true);
  const s = image.height;
  const mark = imageView(image, 0, 0, s, s);
  renderBrandIcon(mark, profile, pack, 'app');
  mark.flush();
  for (let i = 0; i < 7; i++) {
    const x = s * 1.04 + i * s * 0.18;
    const h = s * (0.16 + (i % 3) * 0.08);
    drawLine(image, x, image.height * 0.64, x, image.height * 0.64 - h, s * 0.026, i % 2 ? profile.secondary : profile.accent, 0.85);
  }
  drawLine(image, s * 1.02, image.height * 0.76, image.width - s * 0.16, image.height * 0.76, s * 0.018, profile.accent, 0.38);
  drawRouteNetwork(image, profile, 0.2, 10);
}

function renderHero(image, profile, pack) {
  fillGradient(image, profile, false);
  drawMapMesh(image, profile, 26, 0.18);
  const cx = image.width * 0.55;
  const cy = image.height * 0.52;
  drawCircle(image, cx, cy, Math.min(image.width, image.height) * 0.34, profile.accent, 0.08);
  for (let i = 0; i < 18; i++) {
    const y = image.height * (0.2 + i * 0.035);
    drawLine(image, image.width * 0.08, y, image.width * 0.94, y + Math.sin(i) * 18, 1.2, i % 3 === 0 ? profile.secondary : profile.accent, 0.12);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = Math.min(image.width, image.height) * (0.12 + (i % 4) * 0.06);
    const x = cx + Math.cos(a) * r * 1.7;
    const y = cy + Math.sin(a) * r;
    drawCircle(image, x, y, 7 + (i % 4) * 3, i % 2 ? profile.green : profile.warm, 0.88);
    drawLine(image, cx, cy, x, y, 2.2, i % 2 ? profile.green : profile.accent, 0.26);
  }
  const mark = imageView(image, image.width * 0.06, image.height * 0.14, image.height * 0.28, image.height * 0.28);
  renderBrandIcon(mark, profile, pack, 'app');
  mark.flush();
  vignette(image, profile.bg, 0.42);
}

function renderRoleIcon(image, profile, role) {
  clear(image);
  const s = Math.min(image.width, image.height);
  const cx = image.width / 2;
  const cy = image.height / 2;
  const color = roleColor(profile, role);
  drawCircle(image, cx, cy, s * 0.42, color, 0.18);
  drawRing(image, cx, cy, s * 0.36, s * 0.035, color, 0.62);
  const lw = s * 0.065;
  if (role === 'repeater' || role === 'solar-repeater' || role === 'antenna-tower') {
    drawPolygon(image, [[cx, cy - s * 0.35], [cx + s * 0.24, cy], [cx, cy + s * 0.35], [cx - s * 0.24, cy]], color, 0.96);
    drawLine(image, cx, cy - s * 0.16, cx, cy + s * 0.2, lw, '#f8fbff', 0.92);
    drawLine(image, cx, cy - s * 0.16, cx - s * 0.15, cy + s * 0.22, lw * 0.72, '#f8fbff', 0.92);
    drawLine(image, cx, cy - s * 0.16, cx + s * 0.15, cy + s * 0.22, lw * 0.72, '#f8fbff', 0.92);
    if (role === 'solar-repeater') drawLine(image, cx + s * 0.08, cy + s * 0.08, cx + s * 0.28, cy + s * 0.18, lw, profile.blue, 0.88);
  } else if (role === 'companion' || role === 'mobile-companion') {
    drawPolygon(image, [[cx, cy - s * 0.33], [cx + s * 0.31, cy + s * 0.24], [cx - s * 0.31, cy + s * 0.24]], color, 0.96);
    drawRoundedRect(image, cx - s * 0.105, cy - s * 0.14, s * 0.21, s * 0.38, s * 0.045, '#f8fbff', 0.9);
    drawCircle(image, cx, cy + s * 0.17, s * 0.018, color, 1);
  } else if (role === 'room') {
    drawRoundedRect(image, cx - s * 0.29, cy - s * 0.29, s * 0.58, s * 0.58, s * 0.075, color, 0.96);
    for (let i = 0; i < 3; i++) drawLine(image, cx - s * 0.16, cy - s * 0.1 + i * s * 0.1, cx + s * 0.16, cy - s * 0.1 + i * s * 0.1, lw * 0.7, '#f8fbff', 0.85);
  } else if (role === 'observer') {
    drawCircle(image, cx, cy, s * 0.29, color, 0.96);
    drawRing(image, cx, cy, s * 0.18, lw * 0.6, '#f8fbff', 0.92);
    drawArc(image, cx, cy, s * 0.34, -Math.PI * 0.72, Math.PI * 0.08, lw * 0.55, '#f8fbff', 0.86);
  } else if (role === 'gateway' || role === 'mqtt-bridge') {
    drawPolygon(image, hexagon(cx, cy, s * 0.31), color, 0.96);
    drawCircle(image, cx - s * 0.12, cy, s * 0.05, '#f8fbff', 0.92);
    drawCircle(image, cx + s * 0.12, cy, s * 0.05, '#f8fbff', 0.92);
    drawLine(image, cx - s * 0.07, cy, cx + s * 0.07, cy, lw * 0.7, '#f8fbff', 0.9);
  } else if (role === 'sensor') {
    drawPolygon(image, pentagon(cx, cy, s * 0.33), color, 0.96);
    drawLine(image, cx, cy - s * 0.15, cx, cy + s * 0.15, lw, '#f8fbff', 0.88);
    drawCircle(image, cx, cy - s * 0.2, s * 0.035, '#f8fbff', 0.88);
  } else {
    drawCircle(image, cx, cy, s * 0.3, color, 0.92);
    drawRing(image, cx, cy, s * 0.16, lw * 0.65, '#f8fbff', 0.84);
  }
}

function renderPacketDot(image, profile, payload) {
  clear(image);
  const color = packetColor(profile, payload);
  const s = Math.min(image.width, image.height);
  const cx = image.width / 2;
  const cy = image.height / 2;
  drawCircle(image, cx, cy, s * 0.44, color, 0.2);
  drawRing(image, cx, cy, s * 0.34, s * 0.05, color, 0.9);
  drawCircle(image, cx, cy, s * 0.18, color, 0.95);
  if (payload === 'TRACE' || payload === 'RETURNED_PATH') {
    drawLine(image, cx - s * 0.18, cy + s * 0.1, cx, cy - s * 0.16, s * 0.055, '#f8fbff', 0.82);
    drawLine(image, cx, cy - s * 0.16, cx + s * 0.18, cy + s * 0.1, s * 0.055, '#f8fbff', 0.82);
  } else if (payload === 'ACK') {
    drawLine(image, cx - s * 0.16, cy, cx - s * 0.03, cy + s * 0.13, s * 0.055, '#f8fbff', 0.82);
    drawLine(image, cx - s * 0.03, cy + s * 0.13, cx + s * 0.18, cy - s * 0.14, s * 0.055, '#f8fbff', 0.82);
  } else if (payload === 'CONTROL') {
    drawRing(image, cx, cy, s * 0.12, s * 0.04, '#f8fbff', 0.72);
  }
}

function renderEffect(image, profile, effect) {
  clear(image);
  const cx = image.width / 2;
  const cy = image.height / 2;
  const s = Math.min(image.width, image.height);
  if (effect.includes('trail-noise')) {
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const n = noise(x * 0.07, y * 0.05, 4);
        if (n > 0.58) blendPixel(image, x, y, profile.accent, (n - 0.58) * 0.34);
      }
    }
    return;
  }
  if (effect.includes('route-glow')) {
    for (let i = 0; i < 9; i++) drawLine(image, 8, cy + (i - 4) * 4, image.width - 8, cy + Math.sin(i) * 8, s * (0.05 + i * 0.012), i % 2 ? profile.secondary : profile.accent, 0.08);
    drawLine(image, 14, cy, image.width - 14, cy, s * 0.055, profile.accent, 0.82);
    return;
  }
  if (effect.includes('pulse-ring')) {
    for (let i = 0; i < 4; i++) drawRing(image, cx, cy, s * (0.16 + i * 0.09), s * 0.022, i % 2 ? profile.secondary : profile.accent, 0.72 - i * 0.12);
    return;
  }
  if (effect.includes('observer-aura') || effect.includes('cluster-glow')) {
    drawCircle(image, cx, cy, s * 0.45, profile.warm, 0.12);
    drawRing(image, cx, cy, s * 0.31, s * 0.025, profile.warm, 0.54);
    drawRing(image, cx, cy, s * 0.42, s * 0.016, profile.accent, 0.28);
    return;
  }
  if (effect.includes('message-spark')) {
    drawStar(image, cx, cy, s * 0.38, profile.secondary, 0.88);
    drawCircle(image, cx, cy, s * 0.12, '#f8fbff', 0.8);
    return;
  }
  drawCircle(image, cx, cy, s * 0.42, profile.accent, 0.16);
  drawCircle(image, cx, cy, s * 0.22, profile.accent, 0.62);
  drawCircle(image, cx + s * 0.08, cy - s * 0.06, s * 0.08, '#f8fbff', 0.78);
}

function renderWaterfall(image, profile, mist) {
  if (mist) clear(image);
  else fillGradient(image, profile, false);
  const w = image.width;
  const h = image.height;
  if (!mist) {
    for (let i = 0; i < 90; i++) {
      const x = (i / 89) * w;
      const ridge = h * (0.18 + 0.12 * noise(i, 0, 3));
      drawLine(image, x, ridge, w * 0.5, h * 0.72, 2.2, profile.accent, 0.09);
    }
    drawMapMesh(image, profile, 30, 0.1);
  }
  for (let i = 0; i < 150; i++) {
    const x = w * (0.2 + noise(i, 3, 2) * 0.6);
    const y1 = h * (mist ? noise(i, 9, 2) : 0.12);
    const y2 = h * (0.7 + noise(i, 12, 2) * 0.22);
    const col = i % 5 === 0 ? profile.warm : i % 3 === 0 ? profile.secondary : profile.accent;
    drawLine(image, x, y1, x + Math.sin(i) * 26, y2, 1 + (i % 4), col, mist ? 0.12 : 0.24);
  }
  for (let i = 0; i < 120; i++) {
    const x = noise(i, 15, 3) * w;
    const y = h * (0.62 + noise(i, 17, 2) * 0.26);
    drawCircle(image, x, y, 1 + noise(i, 19, 1) * 4, i % 4 ? profile.accent : profile.secondary, mist ? 0.14 : 0.36);
  }
  if (!mist) vignette(image, profile.bg, 0.5);
}

function renderMapThumbnail(image, profile, style) {
  const light = style.includes('light');
  fillSolid(image, light ? '#e8f1f7' : profile.bg);
  const local = light ? { ...profile, bg: '#e8f1f7', accent: '#2563eb', secondary: '#0f766e' } : profile;
  drawMapMesh(image, local, 16, light ? 0.25 : 0.18);
  if (style.includes('3d') || style.includes('topo') || style.includes('terrain')) {
    for (let i = 0; i < 8; i++) drawArc(image, image.width * 0.5, image.height * 0.68, image.width * (0.1 + i * 0.05), Math.PI * 1.1, Math.PI * 1.9, 1.4, i % 2 ? local.secondary : local.accent, 0.25);
  }
  if (style.includes('weather')) {
    for (let i = 0; i < 8; i++) drawCircle(image, image.width * (0.2 + i * 0.08), image.height * (0.22 + (i % 3) * 0.08), 28, '#ffffff', light ? 0.18 : 0.1);
  }
  for (let i = 0; i < 9; i++) drawCircle(image, image.width * (0.18 + noise(i, 1, 2) * 0.64), image.height * (0.18 + noise(i, 2, 2) * 0.62), 5, i % 3 ? local.green : local.warm, 0.9);
  vignette(image, light ? '#cbd5e1' : profile.bg, 0.18);
}

function renderWorkspace(image, profile, workspace) {
  fillGradient(image, profile, false);
  drawRouteNetwork(image, profile, 0.28, 12);
  const cardColor = workspace.includes('setup') ? profile.green : workspace.includes('chat') ? profile.secondary : workspace.includes('propagation') ? profile.warm : profile.accent;
  for (let i = 0; i < 4; i++) {
    const x = image.width * (0.08 + i * 0.21);
    const y = image.height * (0.18 + (i % 2) * 0.22);
    drawRoundedRect(image, x, y, image.width * 0.17, image.height * 0.18, 8, '#0f172a', 0.52);
    drawLine(image, x + 18, y + 24, x + image.width * 0.15, y + 24, 2, cardColor, 0.65);
    drawCircle(image, x + 24, y + image.height * 0.11, 7, cardColor, 0.82);
  }
  if (workspace.includes('waterfall')) renderWaterfall(image, profile, false);
  if (workspace.includes('netgraph')) drawMapMesh(image, profile, 22, 0.28);
  if (workspace.includes('empty')) drawCircle(image, image.width * 0.5, image.height * 0.52, Math.min(image.width, image.height) * 0.19, cardColor, 0.16);
  vignette(image, profile.bg, 0.36);
}

function fillGradient(image, profile, compact) {
  const w = image.width;
  const h = image.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / Math.max(1, w - 1);
      const ny = y / Math.max(1, h - 1);
      const r1 = 1 - Math.min(1, Math.hypot(nx - 0.24, ny - 0.22) * 2.2);
      const r2 = 1 - Math.min(1, Math.hypot(nx - 0.76, ny - 0.62) * 1.7);
      const n = noise(x * 0.018, y * 0.018, 3);
      let color = mixHex(profile.bg, '#101827', compact ? 0.18 : 0.35);
      color = mixHex(color, profile.accent, Math.max(0, r1) * (compact ? 0.16 : 0.22));
      color = mixHex(color, profile.secondary, Math.max(0, r2) * (compact ? 0.12 : 0.18));
      color = mixHex(color, '#ffffff', n * 0.018);
      setPixel(image, x, y, color, 1);
    }
  }
}

function fillSolid(image, color) {
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) setPixel(image, x, y, color, 1);
}

function clear(image) {
  image.data.fill(0);
}

function drawMapMesh(image, profile, count, alpha) {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: image.width * (0.08 + noise(i, 11, 2) * 0.84),
      y: image.height * (0.08 + noise(i, 23, 2) * 0.84)
    });
  }
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d < Math.min(image.width, image.height) * 0.26) drawLine(image, points[i].x, points[i].y, points[j].x, points[j].y, 1, profile.accent, alpha * (1 - d / (Math.min(image.width, image.height) * 0.26)));
    }
    drawCircle(image, points[i].x, points[i].y, Math.max(2, Math.min(image.width, image.height) * 0.008), i % 3 ? profile.green : profile.warm, 0.8);
  }
}

function drawRouteNetwork(image, profile, alpha, count) {
  for (let i = 0; i < count; i++) {
    const x1 = image.width * noise(i, 2, 2);
    const y1 = image.height * noise(i, 3, 2);
    const x2 = image.width * noise(i, 4, 2);
    const y2 = image.height * noise(i, 5, 2);
    drawLine(image, x1, y1, x2, y2, 1.4 + (i % 3), i % 4 === 0 ? profile.warm : i % 2 ? profile.secondary : profile.accent, alpha);
  }
}

function drawCircle(image, cx, cy, radius, color, alpha) {
  const x0 = Math.floor(cx - radius - 1);
  const x1 = Math.ceil(cx + radius + 1);
  const y0 = Math.floor(cy - radius - 1);
  const y1 = Math.ceil(cy + radius + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= radius) blendPixel(image, x, y, color, alpha * Math.max(0, 1 - (d / radius) ** 2));
    }
  }
}

function drawRing(image, cx, cy, radius, width, color, alpha) {
  const x0 = Math.floor(cx - radius - width - 1);
  const x1 = Math.ceil(cx + radius + width + 1);
  const y0 = Math.floor(cy - radius - width - 1);
  const y1 = Math.ceil(cy + radius + width + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius);
      if (d <= width) blendPixel(image, x, y, color, alpha * (1 - d / width));
    }
  }
}

function drawArc(image, cx, cy, radius, start, end, width, color, alpha) {
  const steps = Math.max(8, Math.ceil(Math.abs(end - start) * radius / 8));
  let px = cx + Math.cos(start) * radius;
  let py = cy + Math.sin(start) * radius;
  for (let i = 1; i <= steps; i++) {
    const a = start + (end - start) * (i / steps);
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    drawLine(image, px, py, x, y, width, color, alpha);
    px = x;
    py = y;
  }
}

function drawLine(image, x1, y1, x2, y2, width, color, alpha) {
  const pad = width + 2;
  const minX = Math.floor(Math.min(x1, x2) - pad);
  const maxX = Math.ceil(Math.max(x1, x2) + pad);
  const minY = Math.floor(Math.min(y1, y2) - pad);
  const maxY = Math.ceil(Math.max(y1, y2) + pad);
  const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x + 0.5 - x1) * (x2 - x1) + (y + 0.5 - y1) * (y2 - y1)) / len2));
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      if (d <= width) blendPixel(image, x, y, color, alpha * (1 - d / width));
    }
  }
}

function drawRoundedRect(image, x, y, w, h, r, color, alpha) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.ceil(x + w);
  const y1 = Math.ceil(y + h);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = Math.max(x - px, 0, px - (x + w));
      const dy = Math.max(y - py, 0, py - (y + h));
      const inside = px >= x + r && px <= x + w - r || py >= y + r && py <= y + h - r || Math.hypot(dx + r, dy + r) <= r;
      if (inside) blendPixel(image, px, py, color, alpha);
    }
  }
}

function drawPolygon(image, points, color, alpha) {
  const minX = Math.floor(Math.min(...points.map((p) => p[0])));
  const maxX = Math.ceil(Math.max(...points.map((p) => p[0])));
  const minY = Math.floor(Math.min(...points.map((p) => p[1])));
  const maxY = Math.ceil(Math.max(...points.map((p) => p[1])));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, points)) blendPixel(image, x, y, color, alpha);
    }
  }
}

function drawStar(image, cx, cy, radius, color, alpha) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.42;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  drawPolygon(image, points, color, alpha);
}

function mapleSignal(cx, cy, radius) {
  const angles = [-90, -52, -58, -22, -25, 4, -5, 36, -35, 36, 5, 4, 25, -22, 58, -58, 52].map((d) => (d * Math.PI) / 180);
  return angles.map((a, i) => {
    const r = radius * (i % 2 === 0 ? 1 : 0.52);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0], yi = points[i][1];
    const xj = points[j][0], yj = points[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pentagon(cx, cy, r) {
  return Array.from({ length: 5 }, (_, i) => [cx + Math.cos(-Math.PI / 2 + i * Math.PI * 0.4) * r, cy + Math.sin(-Math.PI / 2 + i * Math.PI * 0.4) * r]);
}

function hexagon(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => [cx + Math.cos(Math.PI / 6 + i * Math.PI / 3) * r, cy + Math.sin(Math.PI / 6 + i * Math.PI / 3) * r]);
}

function vignette(image, color, alpha) {
  const cx = image.width / 2;
  const cy = image.height / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxD;
      if (d > 0.34) blendPixel(image, x, y, color, alpha * ((d - 0.34) / 0.66) ** 1.4);
    }
  }
}

function createImage(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

function imageView(parent, x, y, width, height) {
  const view = createImage(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const originalSetPixel = setPixel;
  view.flush = () => {
    for (let py = 0; py < view.height; py++) {
      for (let px = 0; px < view.width; px++) {
        const i = (py * view.width + px) * 4;
        blendPixel(parent, Math.round(x) + px, Math.round(y) + py, [view.data[i], view.data[i + 1], view.data[i + 2]], view.data[i + 3] / 255);
      }
    }
  };
  const proxy = new Proxy(view, {
    get(target, prop) {
      if (prop === 'data') return target.data;
      return target[prop];
    }
  });
  queueMicrotask(() => void originalSetPixel);
  return proxy;
}

function setPixel(image, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const [r, g, b] = Array.isArray(color) ? color : hexToRgb(color);
  const i = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  image.data[i] = r;
  image.data[i + 1] = g;
  image.data[i + 2] = b;
  image.data[i + 3] = Math.round(clamp01(alpha) * 255);
}

function blendPixel(image, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height || alpha <= 0) return;
  const [r, g, b] = Array.isArray(color) ? color : hexToRgb(color);
  const i = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  const a = clamp01(alpha);
  const da = image.data[i + 3] / 255;
  const outA = a + da * (1 - a);
  if (outA <= 0) return;
  image.data[i] = Math.round((r * a + image.data[i] * da * (1 - a)) / outA);
  image.data[i + 1] = Math.round((g * a + image.data[i + 1] * da * (1 - a)) / outA);
  image.data[i + 2] = Math.round((b * a + image.data[i + 2] * da * (1 - a)) / outA);
  image.data[i + 3] = Math.round(outA * 255);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return out;
}

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function makeCRCTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function dimensionsFor(record, target) {
  const explicit = basename(target).match(/(\d+)x(\d+)/);
  if (explicit) return { width: Number(explicit[1]), height: Number(explicit[2]) };
  if (target.includes('favicon-32')) return { width: 32, height: 32 };
  if (target.includes('apple-touch-icon')) return { width: 180, height: 180 };
  if (target.includes('app-icon-192')) return { width: 192, height: 192 };
  if (target.includes('app-icon-512')) return { width: 512, height: 512 };
  if (target.includes('-64') || target.includes('_64')) return { width: 64, height: 64 };
  if (target.includes('-128')) return { width: 128, height: 128 };
  if (target.includes('-256')) return { width: 256, height: 256 };
  if (target.includes('waterfall')) return { width: 2048, height: 1152 };
  if (record.category === 'pwa') return { width: 1, height: 1 };
  return { width: 512, height: 512 };
}

function pwaManifest(pack) {
  const profile = PACK_PROFILE[pack];
  return {
    name: profile.label,
    short_name: profile.shortLabel,
    description: pack === 'canada' ? 'Canada MeshCore MQTT Live Map' : 'MeshCore MQTT Live Map',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#05070b',
    background_color: '#05070b',
    icons: [
      { src: `/brand/${pack}/app-icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: `/brand/${pack}/app-icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  };
}

function fileURL(path) {
  return new URL(path.replace(/\\/g, '/'), root);
}

function colorProfile(pack) {
  if (pack === 'canada') {
    return {
      bg: '#050b12',
      surface: '#0b1520',
      accent: '#20d5c3',
      secondary: '#e11d48',
      red: '#ef3340',
      warm: '#f59e0b',
      green: '#34d399',
      blue: '#60a5fa'
    };
  }
  return {
    bg: '#05070b',
    surface: '#0d1422',
    accent: '#22d3ee',
    secondary: '#a78bfa',
    red: '#ef4444',
    warm: '#f59e0b',
    green: '#22c55e',
    blue: '#3b82f6'
  };
}

function roleColor(profile, role) {
  if (role.includes('repeater') || role.includes('antenna')) return profile.green;
  if (role.includes('companion') || role.includes('mobile')) return profile.blue;
  if (role.includes('room')) return profile.secondary;
  if (role.includes('observer')) return profile.warm;
  if (role.includes('gateway') || role.includes('mqtt')) return profile.accent;
  if (role.includes('sensor')) return '#84cc16';
  return '#94a3b8';
}

function packetColor(profile, payload) {
  const colors = {
    ADVERT: '#2dd4bf',
    PLAIN_TEXT: '#38bdf8',
    GROUP_TEXT: '#a78bfa',
    GROUP_DATA: '#c084fc',
    TRACE: '#f59e0b',
    RETURNED_PATH: '#facc15',
    REQUEST: '#67e8f9',
    RESPONSE: '#fde047',
    ACK: '#a3e635',
    CONTROL: '#fb7185',
    OTHER: '#cbd5e1'
  };
  return colors[payload] ?? profile.accent;
}

function roleFromTarget(target) {
  return basename(target).replace(/-64\.png$/, '');
}

function packetFromTarget(target) {
  const stem = basename(target).replace('.png', '').replace(/^dot_/, '').replace(/_64$/, '');
  const map = {
    adv: 'ADVERT',
    txt: 'PLAIN_TEXT',
    grp: 'GROUP_TEXT',
    data: 'GROUP_DATA',
    trc: 'TRACE',
    ret: 'RETURNED_PATH',
    req: 'REQUEST',
    rsp: 'RESPONSE',
    ack: 'ACK',
    ctl: 'CONTROL',
    oth: 'OTHER'
  };
  return map[stem] ?? 'OTHER';
}

function effectFromTarget(target) {
  return basename(target).replace('.png', '');
}

function mapFromTarget(target) {
  return basename(target).replace('-320x180.png', '');
}

function workspaceFromTarget(target) {
  return basename(target).replace('-480x270.png', '');
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const m = ca.map((v, i) => Math.round(v + (cb[i] - v) * clamp01(t)));
  return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function noise(x, y, salt) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
