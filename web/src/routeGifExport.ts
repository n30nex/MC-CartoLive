import { appBrandName } from './buildInfo';
import { packetEndpointSummary, packetRegion } from './packets';
import { payloadVisual } from './payloadVisuals';
import type { PublicPacketPath, PublicRouteSegment } from './types';

export const ROUTE_GIF_WIDTH = 1280;
export const ROUTE_GIF_HEIGHT = 720;
export const ROUTE_GIF_FRAMES = 60;
export const ROUTE_GIF_FPS = 12;

const ROUTE_PADDING = { left: 96, right: 96, top: 142, bottom: 116 };
const DEG_TO_RAD = Math.PI / 180;

export interface RouteGifPoint {
  lat: number;
  lng: number;
  label: string;
  nodeId?: string;
}

export interface ProjectedRouteGifPoint extends RouteGifPoint {
  x: number;
  y: number;
}

export interface RouteGifExportOptions {
  width?: number;
  height?: number;
  frames?: number;
  fps?: number;
  onProgress?: (progress: number) => void;
}

export function routeGifRoutePoints(packet: Pick<PublicPacketPath, 'segments'>): RouteGifPoint[] {
  const points: RouteGifPoint[] = [];
  for (const segment of packet.segments) {
    appendEndpoint(points, segment.from);
    appendEndpoint(points, segment.to);
  }
  return points;
}

export function projectRouteForGif(
  points: RouteGifPoint[],
  width = ROUTE_GIF_WIDTH,
  height = ROUTE_GIF_HEIGHT,
  padding = ROUTE_PADDING
): ProjectedRouteGifPoint[] {
  const projected = points.map((point) => ({
    ...point,
    rawX: point.lng,
    rawY: -mercatorY(point.lat)
  }));
  if (projected.length === 0) return [];

  let minX = Math.min(...projected.map((point) => point.rawX));
  let maxX = Math.max(...projected.map((point) => point.rawX));
  let minY = Math.min(...projected.map((point) => point.rawY));
  let maxY = Math.max(...projected.map((point) => point.rawY));
  if (Math.abs(maxX - minX) < 0.00001) {
    minX -= 0.01;
    maxX += 0.01;
  }
  if (Math.abs(maxY - minY) < 0.00001) {
    minY -= 0.01;
    maxY += 0.01;
  }

  const innerWidth = Math.max(1, width - padding.left - padding.right);
  const innerHeight = Math.max(1, height - padding.top - padding.bottom);
  const scale = Math.min(innerWidth / (maxX - minX), innerHeight / (maxY - minY));
  const routeWidth = (maxX - minX) * scale;
  const routeHeight = (maxY - minY) * scale;
  const offsetX = padding.left + (innerWidth - routeWidth) / 2;
  const offsetY = padding.top + (innerHeight - routeHeight) / 2;

  return projected.map((point) => ({
    lat: point.lat,
    lng: point.lng,
    label: point.label,
    nodeId: point.nodeId,
    x: offsetX + (point.rawX - minX) * scale,
    y: offsetY + (point.rawY - minY) * scale
  }));
}

export function routeGifFrameProgress(frameIndex: number, frameCount = ROUTE_GIF_FRAMES): number {
  if (frameCount <= 1) return 1;
  const leadFrames = 3;
  const tailFrames = 5;
  const raw = (frameIndex - leadFrames) / Math.max(1, frameCount - leadFrames - tailFrames - 1);
  const clamped = clamp(raw, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
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

export async function createRouteGifBlob(packet: PublicPacketPath, options: RouteGifExportOptions = {}): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('GIF export requires a browser document');
  const points = routeGifRoutePoints(packet);
  if (points.length < 2) throw new Error('Packet route needs at least two mappable endpoints');

  const width = options.width ?? ROUTE_GIF_WIDTH;
  const height = options.height ?? ROUTE_GIF_HEIGHT;
  const frames = options.frames ?? ROUTE_GIF_FRAMES;
  const fps = options.fps ?? ROUTE_GIF_FPS;
  const delay = Math.round(1000 / fps);
  const route = projectRouteForGif(points, width, height);
  const staticCanvas = createCanvas(width, height);
  const frameCanvas = createCanvas(width, height);
  const staticCtx = context2D(staticCanvas);
  const frameCtx = context2D(frameCanvas);
  const visual = payloadVisual(packet.payloadTypeName);

  drawStaticRouteFrame(staticCtx, packet, route, visual.color, width, height);

  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const gif = GIFEncoder({ initialCapacity: width * height });

  for (let frame = 0; frame < frames; frame += 1) {
    frameCtx.clearRect(0, 0, width, height);
    frameCtx.drawImage(staticCanvas, 0, 0);
    drawAnimatedPacketFrame(frameCtx, packet, route, visual.color, routeGifFrameProgress(frame, frames), frame, frames, width, height);
    const image = frameCtx.getImageData(0, 0, width, height);
    const palette = quantize(image.data, 192, { format: 'rgb565' });
    const index = applyPalette(image.data, palette, 'rgb565');
    gif.writeFrame(index, width, height, { palette, delay, repeat: 0 });
    options.onProgress?.((frame + 1) / frames);
    if (frame % 6 === 5) await yieldToBrowser();
  }

  gif.finish();
  const bytes = gif.bytes();
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Blob([body], { type: 'image/gif' });
}

export async function downloadRouteGif(packet: PublicPacketPath, options: RouteGifExportOptions = {}): Promise<void> {
  const blob = await createRouteGifBlob(packet, options);
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

function mercatorY(lat: number): number {
  const clamped = clamp(lat, -85, 85);
  const radians = clamped * DEG_TO_RAD;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function drawStaticRouteFrame(
  ctx: CanvasRenderingContext2D,
  packet: PublicPacketPath,
  route: ProjectedRouteGifPoint[],
  accent: string,
  width: number,
  height: number
): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#08111f');
  gradient.addColorStop(0.5, '#101827');
  gradient.addColorStop(1, '#050814');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, width, height);
  drawRouteGlow(ctx, route, '#0f172a', 20, 0.9);
  drawRouteGlow(ctx, route, accent, 14, 0.22);
  drawRouteLine(ctx, route, 'rgba(125, 211, 252, 0.32)', 5);
  drawRouteLine(ctx, route, 'rgba(255, 255, 255, 0.58)', 2);
  drawRouteNodes(ctx, route, accent);
  drawRouteLabels(ctx, route);
  drawHeader(ctx, packet, accent, width);
  drawFooter(ctx, packet, accent, width, height);
}

function drawAnimatedPacketFrame(
  ctx: CanvasRenderingContext2D,
  packet: PublicPacketPath,
  route: ProjectedRouteGifPoint[],
  accent: string,
  progress: number,
  frame: number,
  frames: number,
  width: number,
  height: number
): void {
  const shimmer = 0.65 + 0.35 * Math.sin((frame / Math.max(1, frames)) * Math.PI * 8);
  drawPolylineWindow(ctx, route, Math.max(0, progress - 0.18), progress, accent, 20, 0.18 + shimmer * 0.1);
  drawPolylineWindow(ctx, route, Math.max(0, progress - 0.11), progress, '#e0ffff', 9, 0.78);
  drawPolylineWindow(ctx, route, Math.max(0, progress - 0.05), progress, '#ffffff', 4, 0.9);

  const comet = pointAtProgress(route, progress);
  const behind = pointAtProgress(route, Math.max(0, progress - 0.015));
  const angle = Math.atan2(comet.y - behind.y, comet.x - behind.x);
  const glow = ctx.createRadialGradient(comet.x, comet.y, 0, comet.x, comet.y, 42);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
  glow.addColorStop(0.28, hexToRgba(accent, 0.9));
  glow.addColorStop(1, hexToRgba(accent, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(comet.x, comet.y, 42, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(comet.x, comet.y);
  ctx.rotate(angle);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-10, -10);
  ctx.lineTo(-5, 0);
  ctx.lineTo(-10, 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  drawProgressBadge(ctx, route, progress, accent, width, height);
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.075)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 180, height);
    ctx.stroke();
  }
  for (let y = 18; y <= height; y += 54) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + 80);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRouteNodes(ctx: CanvasRenderingContext2D, route: ProjectedRouteGifPoint[], accent: string): void {
  for (const [index, point] of route.entries()) {
    const endpoint = index === 0 || index === route.length - 1;
    ctx.fillStyle = endpoint ? accent : 'rgba(45, 212, 191, 0.92)';
    ctx.strokeStyle = endpoint ? '#ffffff' : 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = endpoint ? 4 : 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, endpoint ? 13 : 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawRouteLabels(ctx: CanvasRenderingContext2D, route: ProjectedRouteGifPoint[]): void {
  const labels = labelPoints(route);
  ctx.font = '700 18px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const { point, endpoint } of labels) {
    const label = truncateText(point.label, endpoint ? 28 : 18);
    const metrics = ctx.measureText(label);
    const x = clamp(point.x + 14, 14, ROUTE_GIF_WIDTH - metrics.width - 24);
    const y = clamp(point.y - (endpoint ? 23 : 18), 158, ROUTE_GIF_HEIGHT - 92);
    roundedRect(ctx, x - 8, y - 13, metrics.width + 16, 26, 8, 'rgba(3, 8, 20, 0.76)', 'rgba(125, 211, 252, 0.24)');
    ctx.fillStyle = endpoint ? '#ffffff' : '#dbeafe';
    ctx.fillText(label, x, y);
  }
}

function labelPoints(route: ProjectedRouteGifPoint[]): Array<{ point: ProjectedRouteGifPoint; endpoint: boolean }> {
  if (route.length <= 2) return route.map((point, index) => ({ point, endpoint: index === 0 || index === route.length - 1 }));
  const selected = new Map<number, { point: ProjectedRouteGifPoint; endpoint: boolean }>();
  selected.set(0, { point: route[0], endpoint: true });
  selected.set(route.length - 1, { point: route[route.length - 1], endpoint: true });
  const maxInterior = Math.min(6, route.length - 2);
  for (let index = 1; index <= maxInterior; index += 1) {
    const routeIndex = Math.round((index * (route.length - 1)) / (maxInterior + 1));
    selected.set(routeIndex, { point: route[routeIndex], endpoint: false });
  }
  return [...selected.values()];
}

function drawHeader(ctx: CanvasRenderingContext2D, packet: PublicPacketPath, accent: string, width: number): void {
  roundedRect(ctx, 34, 28, width - 68, 88, 18, 'rgba(6, 12, 26, 0.86)', hexToRgba(accent, 0.44));
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 34px Inter, system-ui, sans-serif';
  ctx.fillText(packetEndpointSummary(packet), 58, 68);
  ctx.fillStyle = '#93c5fd';
  ctx.font = '800 16px Inter, system-ui, sans-serif';
  ctx.fillText(appBrandName || 'MC-CartoLive', 58, 96);

  const payload = payloadVisual(packet.payloadTypeName);
  const chips = [
    payload.shortLabel,
    packetRegion(packet) || 'World',
    `${packet.hopCount} ${packet.hopCount === 1 ? 'hop' : 'hops'}`,
    `${packet.distanceKm.toFixed(packet.distanceKm >= 100 ? 0 : 1)} km`,
    `${packet.segmentCount} ${packet.segmentCount === 1 ? 'segment' : 'segments'}`
  ];
  let x = width - 58;
  ctx.font = '800 16px Inter, system-ui, sans-serif';
  for (const chip of chips.reverse()) {
    const chipWidth = ctx.measureText(chip).width + 26;
    x -= chipWidth;
    roundedRect(ctx, x, 48, chipWidth - 10, 34, 10, 'rgba(15, 23, 42, 0.86)', hexToRgba(accent, 0.5));
    ctx.fillStyle = chip === payload.shortLabel ? accent : '#e0f2fe';
    ctx.fillText(chip, x + 12, 70);
    x -= 8;
  }
}

function drawFooter(ctx: CanvasRenderingContext2D, packet: PublicPacketPath, accent: string, width: number, height: number): void {
  roundedRect(ctx, 34, height - 82, width - 68, 48, 16, 'rgba(6, 12, 26, 0.76)', 'rgba(148, 163, 184, 0.24)');
  ctx.fillStyle = '#bfdbfe';
  ctx.font = '800 16px Inter, system-ui, sans-serif';
  const timestamp = new Date(packet.at).toLocaleString();
  ctx.fillText(`Heard ${timestamp}`, 58, height - 52);
  ctx.fillStyle = accent;
  ctx.font = '900 17px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('True public RF path', width - 58, height - 52);
  ctx.textAlign = 'left';

  if (packet.messageText) {
    const text = `${packet.messageSender ? `${packet.messageSender}: ` : ''}${packet.messageText}`;
    roundedRect(ctx, 58, height - 136, Math.min(width - 116, ctx.measureText(text).width + 34), 36, 12, 'rgba(2, 6, 23, 0.8)', hexToRgba(accent, 0.36));
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 16px Inter, system-ui, sans-serif';
    ctx.fillText(truncateText(text, 100), 76, height - 113);
  }
}

function drawProgressBadge(ctx: CanvasRenderingContext2D, route: ProjectedRouteGifPoint[], progress: number, accent: string, width: number, height: number): void {
  const x = width - 320;
  const y = height - 146;
  roundedRect(ctx, x, y, 286, 42, 12, 'rgba(5, 10, 20, 0.86)', hexToRgba(accent, 0.52));
  ctx.fillStyle = '#dbeafe';
  ctx.font = '800 15px Inter, system-ui, sans-serif';
  ctx.fillText('Packet replay', x + 16, y + 26);
  ctx.fillStyle = accent;
  ctx.fillRect(x + 128, y + 19, 136 * progress, 5);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.26)';
  ctx.strokeRect(x + 128, y + 19, 136, 5);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(progress * 100)}%`, x + 270, y + 28);
  ctx.textAlign = 'left';
  if (progress >= 0.995) drawEndpointPulse(ctx, route, accent);
}

function drawEndpointPulse(ctx: CanvasRenderingContext2D, route: ProjectedRouteGifPoint[], accent: string): void {
  const end = route.at(-1);
  if (!end) return;
  ctx.strokeStyle = hexToRgba(accent, 0.9);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(end.x, end.y, 28, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRouteGlow(ctx: CanvasRenderingContext2D, route: ProjectedRouteGifPoint[], color: string, width: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  drawRouteLine(ctx, route, color, width);
  ctx.restore();
}

function drawRouteLine(ctx: CanvasRenderingContext2D, route: ProjectedRouteGifPoint[], color: string, width: number): void {
  if (route.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(route[0].x, route[0].y);
  for (const point of route.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
  ctx.restore();
}

function drawPolylineWindow(
  ctx: CanvasRenderingContext2D,
  route: ProjectedRouteGifPoint[],
  startProgress: number,
  endProgress: number,
  color: string,
  width: number,
  alpha: number
): void {
  if (route.length < 2 || endProgress <= startProgress) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const samples = 40;
  for (let index = 0; index <= samples; index += 1) {
    const progress = startProgress + ((endProgress - startProgress) * index) / samples;
    const point = pointAtProgress(route, progress);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}

function pointAtProgress(route: ProjectedRouteGifPoint[], progress: number): ProjectedRouteGifPoint {
  if (route.length === 0) return { x: 0, y: 0, lat: 0, lng: 0, label: '' };
  if (route.length === 1) return route[0];
  const segments = routeSegmentLengths(route);
  const total = segments.reduce((sum, segment) => sum + segment, 0);
  if (total <= 0) return route[0];
  let target = clamp(progress, 0, 1) * total;
  for (let index = 0; index < segments.length; index += 1) {
    const length = segments[index];
    if (target <= length || index === segments.length - 1) {
      const from = route[index];
      const to = route[index + 1];
      const local = length <= 0 ? 0 : target / length;
      return {
        ...to,
        x: from.x + (to.x - from.x) * local,
        y: from.y + (to.y - from.y) * local,
        lat: from.lat + (to.lat - from.lat) * local,
        lng: from.lng + (to.lng - from.lng) * local
      };
    }
    target -= length;
  }
  return route[route.length - 1];
}

function routeSegmentLengths(route: ProjectedRouteGifPoint[]): number[] {
  const lengths: number[] = [];
  for (let index = 1; index < route.length; index += 1) {
    const left = route[index - 1];
    const right = route[index];
    lengths.push(Math.hypot(right.x - left.x, right.y - left.y));
  }
  return lengths;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas is unavailable');
  return ctx;
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
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const parsed = Number.parseInt(normalized.length === 3 ? normalized.split('').map((char) => char + char).join('') : normalized, 16);
  if (!Number.isFinite(parsed)) return `rgba(125, 211, 252, ${alpha})`;
  const red = (parsed >> 16) & 255;
  const green = (parsed >> 8) & 255;
  const blue = parsed & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
