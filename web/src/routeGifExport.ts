import { appBrandName } from './buildInfo';
import { activeAssetPack } from './assets/v3/assetPacks';
import { clamp } from './lib/clamp';
import { hexToRgba } from './lib/color';
import { packetEndpointSummary, packetRegion } from './packets';
import { payloadVisual } from './payloadVisuals';
import type { PublicPacketPath, PublicRoutePulse, PublicRouteSegment } from './types';

export const ROUTE_GIF_WIDTH = 1280;
export const ROUTE_GIF_HEIGHT = 720;
export const ROUTE_GIF_FRAMES = 60;
export const ROUTE_GIF_FPS = 12;

export interface RouteGifPoint {
  lat: number;
  lng: number;
  label: string;
  nodeId?: string;
}

export interface RouteGifHopDetail {
  index: number;
  from: string;
  to: string;
  distance: string;
}

export interface RouteGifCaptureFrameRequest {
  frameIndex: number;
  frameCount: number;
  progress: number;
  width: number;
  height: number;
}

export type RouteGifCaptureFrame = (request: RouteGifCaptureFrameRequest) => ImageData | Promise<ImageData>;

export interface RouteGifExportOptions {
  width?: number;
  height?: number;
  frames?: number;
  fps?: number;
  onProgress?: (progress: number) => void;
}

export interface RouteMapGifExportRequest {
  token: number;
  packet: PublicPacketPath;
  pulse: PublicRoutePulse;
  settleMs: number;
  travelDurationMs: number;
  onProgress: (progress: number) => void;
  onComplete: (blob: Blob) => void;
  onError: (error: unknown) => void;
}

export function routeGifRoutePoints(packet: Pick<PublicPacketPath, 'segments'>): RouteGifPoint[] {
  const points: RouteGifPoint[] = [];
  for (const segment of packet.segments) {
    appendEndpoint(points, segment.from);
    appendEndpoint(points, segment.to);
  }
  return points;
}

export function routeGifHopDetails(packet: Pick<PublicPacketPath, 'segments'>): RouteGifHopDetail[] {
  return packet.segments.map((segment, index) => ({
    index: index + 1,
    from: segment.from.label || segment.from.pathHash3 || 'Node',
    to: segment.to.label || segment.to.pathHash3 || 'Node',
    distance: `${segment.distanceKm.toFixed(segment.distanceKm >= 100 ? 0 : 1)} km`
  }));
}

export function routeGifFrameProgress(frameIndex: number, frameCount = ROUTE_GIF_FRAMES): number {
  if (frameCount <= 1) return 1;
  const leadFrames = 2;
  const tailFrames = 3;
  const raw = (frameIndex - leadFrames) / Math.max(1, frameCount - leadFrames - tailFrames - 1);
  const clamped = clamp(raw, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

export function routeGifAnimationDurationMs(frames = ROUTE_GIF_FRAMES, fps = ROUTE_GIF_FPS): number {
  return Math.round((Math.max(1, frames - 1) * 1000) / Math.max(1, fps));
}

export function routeGifFilename(packet: PublicPacketPath): string {
  const region = packetRegion(packet) || 'mesh';
  const summary = packetEndpointSummary(packet);
  const safe = `${region}-${summary}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `mc-cartolive-${safe || 'route'}-${new Date(packet.at).toISOString().slice(0, 10)}.gif`;
}

export async function createRouteMapGifBlob(
  packet: PublicPacketPath,
  captureFrame: RouteGifCaptureFrame,
  options: RouteGifExportOptions = {}
): Promise<Blob> {
  if (routeGifRoutePoints(packet).length < 2) throw new Error('Packet route needs at least two mappable endpoints');

  const width = options.width ?? ROUTE_GIF_WIDTH;
  const height = options.height ?? ROUTE_GIF_HEIGHT;
  const frames = options.frames ?? ROUTE_GIF_FRAMES;
  const fps = options.fps ?? ROUTE_GIF_FPS;
  const delay = Math.round(1000 / fps);
  const capturedFrames: ImageData[] = [];

  for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
    const progress = routeGifFrameProgress(frameIndex, frames);
    const image = await captureFrame({ frameIndex, frameCount: frames, progress, width, height });
    if (image.width !== width || image.height !== height) {
      throw new Error(`Captured map frame size ${image.width}x${image.height} does not match GIF size ${width}x${height}`);
    }
    capturedFrames.push(image);
    options.onProgress?.(((frameIndex + 1) / frames) * 0.7);
    if (frameIndex % 8 === 7) await yieldToBrowser();
  }

  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const gif = GIFEncoder({ initialCapacity: width * height });

  for (let frameIndex = 0; frameIndex < capturedFrames.length; frameIndex += 1) {
    const image = capturedFrames[frameIndex];
    const palette = quantize(image.data, 192, { format: 'rgb565' });
    const index = applyPalette(image.data, palette, 'rgb565');
    gif.writeFrame(index, width, height, { palette, delay, repeat: 0 });
    options.onProgress?.(0.7 + ((frameIndex + 1) / frames) * 0.3);
    if (frameIndex % 4 === 3) await yieldToBrowser();
  }

  gif.finish();
  const bytes = gif.bytes();
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Blob([body], { type: 'image/gif' });
}

export function downloadRouteGifBlob(packet: PublicPacketPath, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = routeGifFilename(packet);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function drawRouteMapGifOverlay(
  ctx: CanvasRenderingContext2D,
  packet: PublicPacketPath,
  progress: number,
  width: number,
  height: number
): void {
  const visual = payloadVisual(packet.payloadTypeName);
  const accent = visual.color || '#22d3ee';
  const title = packetEndpointSummary(packet);
  const hops = routeGifHopDetails(packet);
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.shadowColor = hexToRgba(accent, 0.45);
  ctx.shadowBlur = 20;

  const headerWidth = Math.min(width - 40, Math.max(520, Math.min(860, title.length * 16 + 290)));
  roundedRect(ctx, 20, 18, headerWidth, 86, 18, 'rgba(3, 7, 18, 0.78)', hexToRgba(accent, 0.42));
  drawCachedImage(ctx, activeAssetPack.brand.appIcon, 34, 33, 44, 44, 0.88);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 26px Inter, system-ui, sans-serif';
  ctx.fillText(truncateText(title, 58), 92, 52);
  ctx.fillStyle = '#bae6fd';
  ctx.font = '800 14px Inter, system-ui, sans-serif';
  ctx.fillText(`${appBrandName || activeAssetPack.label} actual map replay`, 92, 82);

  const chips = [
    visual.shortLabel,
    packetRegion(packet) || 'World',
    `${packet.hopCount} ${packet.hopCount === 1 ? 'hop' : 'hops'}`,
    `${packet.distanceKm.toFixed(packet.distanceKm >= 100 ? 0 : 1)} km`,
    `${packet.segmentCount} ${packet.segmentCount === 1 ? 'segment' : 'segments'}`
  ];
  let chipX = width - 28;
  ctx.font = '800 14px Inter, system-ui, sans-serif';
  for (const chip of chips.reverse()) {
    const hasIcon = chip === visual.shortLabel;
    const chipWidth = ctx.measureText(chip).width + (hasIcon ? 46 : 24);
    chipX -= chipWidth;
    roundedRect(ctx, chipX, 24, chipWidth - 8, 30, 9, 'rgba(2, 6, 23, 0.82)', hexToRgba(accent, 0.38));
    ctx.fillStyle = hasIcon ? accent : '#e0f2fe';
    if (hasIcon) drawCachedImage(ctx, visual.icon, chipX + 8, 30, 18, 18, 0.94);
    ctx.fillText(chip, chipX + (hasIcon ? 32 : 11), 39);
    chipX -= 8;
  }

  const hopPanelHeight = hops.length > Math.max(4, Math.floor((width - 96) / 104)) ? 136 : 92;
  const hopPanelY = height - hopPanelHeight - 22;
  roundedRect(ctx, 20, hopPanelY, width - 40, hopPanelHeight, 16, 'rgba(3, 7, 18, 0.72)', 'rgba(148, 163, 184, 0.24)');
  ctx.fillStyle = '#bfdbfe';
  ctx.font = '800 14px Inter, system-ui, sans-serif';
  ctx.fillText(`Heard ${new Date(packet.at).toLocaleString()}`, 42, hopPanelY + 22);
  ctx.fillStyle = accent;
  ctx.textAlign = 'right';
  ctx.fillText('True public RF path', width - 42, hopPanelY + 22);
  ctx.textAlign = 'left';

  const barWidth = Math.min(360, width - 80);
  const barX = Math.max(40, width - barWidth - 40);
  const barY = hopPanelY + 36;
  roundedRect(ctx, barX, barY, barWidth, 18, 9, 'rgba(2, 6, 23, 0.7)', 'rgba(255, 255, 255, 0.18)');
  ctx.fillStyle = hexToRgba(accent, 0.9);
  roundedRect(ctx, barX + 4, barY + 4, Math.max(8, (barWidth - 8) * progress), 10, 5, hexToRgba(accent, 0.95));

  drawRouteHopStrip(ctx, hops, 42, hopPanelY + 52, width - 84, hopPanelHeight - 64, accent);

  if (packet.messageText) {
    const message = `${packet.messageSender ? `${packet.messageSender}: ` : ''}${packet.messageText}`;
    const messageWidth = Math.min(width - 80, ctx.measureText(message).width + 34);
    const messageY = Math.max(118, hopPanelY - 44);
    roundedRect(ctx, 40, messageY, messageWidth, 34, 12, 'rgba(2, 6, 23, 0.72)', hexToRgba(accent, 0.34));
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 14px Inter, system-ui, sans-serif';
    ctx.fillText(truncateText(message, 96), 58, messageY + 17);
  }

  ctx.restore();
}

const routeGifImageCache = new Map<string, HTMLImageElement>();

function drawCachedImage(ctx: CanvasRenderingContext2D, src: string, x: number, y: number, width: number, height: number, alpha = 1) {
  if (typeof Image !== 'function' || !src) return;
  let image = routeGifImageCache.get(src);
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.src = src;
    routeGifImageCache.set(src, image);
  }
  if (!image.complete || image.naturalWidth === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, x, y, width, height);
  ctx.restore();
}

function drawRouteHopStrip(
  ctx: CanvasRenderingContext2D,
  hops: RouteGifHopDetail[],
  x: number,
  y: number,
  width: number,
  height: number,
  accent: string
): void {
  if (hops.length === 0 || width <= 0 || height <= 0) return;
  const maxPerRow = Math.max(4, Math.min(14, Math.floor(width / 104)));
  const rows = hops.length > maxPerRow ? 2 : 1;
  const capacity = maxPerRow * rows;
  const visible = hops.length > capacity ? [...hops.slice(0, capacity - 1), hops[hops.length - 1]] : hops;
  const perRow = Math.ceil(visible.length / rows);
  const cellWidth = width / perRow;
  const cellHeight = rows === 1 ? Math.min(42, height) : Math.min(38, height / 2 - 4);

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = '800 10px Inter, system-ui, sans-serif';
  for (let itemIndex = 0; itemIndex < visible.length; itemIndex += 1) {
    const hop = visible[itemIndex];
    const row = Math.floor(itemIndex / perRow);
    const column = itemIndex % perRow;
    const cellX = x + column * cellWidth;
    const cellY = y + row * (cellHeight + 8);
    const innerWidth = Math.max(76, cellWidth - 8);
    const skipped = hops.length > capacity && itemIndex === visible.length - 1;
    const skippedCount = skipped ? Math.max(1, hop.index - (visible[itemIndex - 1]?.index ?? 0) - 1) : 0;
    const label = skipped ? `... ${skippedCount} hops to ${hop.to}` : `${hop.from} -> ${hop.to}`;

    roundedRect(ctx, cellX, cellY, innerWidth, cellHeight, 10, 'rgba(15, 23, 42, 0.72)', hexToRgba(accent, 0.26));
    ctx.fillStyle = hexToRgba(accent, 0.95);
    ctx.beginPath();
    ctx.arc(cellX + 16, cellY + cellHeight / 2, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#020617';
    ctx.font = '900 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(hop.index), cellX + 16, cellY + cellHeight / 2 + 0.5);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 10px Inter, system-ui, sans-serif';
    ctx.fillText(truncateText(label, Math.max(14, Math.floor(innerWidth / 7.8))), cellX + 34, cellY + cellHeight / 2 - 6);
    ctx.fillStyle = '#93c5fd';
    ctx.font = '800 9px Inter, system-ui, sans-serif';
    ctx.fillText(hop.distance, cellX + 34, cellY + cellHeight / 2 + 9);
  }
  ctx.restore();
}

function appendEndpoint(points: RouteGifPoint[], endpoint: PublicRouteSegment['from']): void {
  if (!Number.isFinite(endpoint.lat) || !Number.isFinite(endpoint.lng)) return;
  const previous = points.at(-1);
  if (previous && sameEndpoint(previous, endpoint)) return;
  points.push({
    lat: endpoint.lat,
    lng: endpoint.lng,
    label: endpoint.label || endpoint.pathHash3 || 'Node',
    nodeId: endpoint.nodeId
  });
}

function sameEndpoint(left: RouteGifPoint, right: PublicRouteSegment['from']): boolean {
  if (left.nodeId && right.nodeId && left.nodeId === right.nodeId) return true;
  return Math.abs(left.lat - right.lat) < 0.000001 && Math.abs(left.lng - right.lng) < 0.000001;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function truncateText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
