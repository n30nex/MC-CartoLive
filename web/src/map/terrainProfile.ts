import type maplibregl from 'maplibre-gl';
import type { PublicRoutePulse } from '../types';
import { sampleRouteArc, routeEndpointDistanceKm } from './routeArcs';

export interface LOSResult {
  clear: boolean;
  confidence: number;
  minClearanceMeters: number;
  maxObstructionMeters: number;
  fresnelRadiusMeters: number;
  frequencyGHz: number;
}

const FRESNEL_FREQ = 0.915;
const SAMPLES = 24;
const FRESNEL_FACTOR = 0.6;

export function computeLineOfSight(
  segment: Pick<PublicRoutePulse['segments'][number], 'from' | 'to' | 'distanceKm'>,
  map: maplibregl.Map,
  freq = FRESNEL_FREQ
): LOSResult {
  const distKm = Number.isFinite(segment.distanceKm) && segment.distanceKm > 0 ? segment.distanceKm : routeEndpointDistanceKm(segment.from, segment.to);
  if (distKm <= 0.01) return { clear: true, confidence: 1, minClearanceMeters: 0, maxObstructionMeters: 0, fresnelRadiusMeters: 0, frequencyGHz: freq };

  const arc = sampleRouteArc(segment.from, segment.to, { distanceKm: distKm, minSamples: SAMPLES, maxSamples: SAMPLES });
  const elevs = arc.map((s) => { try { const e = map.queryTerrainElevation([s.lng, s.lat]); return typeof e === 'number' ? e : 0; } catch { return 0; } });
  const mid = arc[Math.floor(arc.length / 2)] ?? arc[0];
  const fRad = fresnel(distKm * (mid?.progress ?? 0.5), freq);

  let minClear = Infinity, maxObst = 0, blocked = 0;
  for (let i = 0; i < arc.length; i++) {
    const a = arc[i], te = elevs[i] ?? 0;
    const de = distKm * Math.min(a.progress, 1 - a.progress);
    const fr = fresnel(de * 2, freq) * FRESNEL_FACTOR;
    const cl = a.altitudeMeters - te - fr;
    if (cl < minClear) minClear = cl;
    if (cl < 0) { maxObst = Math.max(maxObst, -cl); blocked++; }
  }
  const clear = blocked === 0;
  const confidence = clear ? clamp(0.6 + 0.4 * Math.min(1, minClear / Math.max(1, fRad * 3)), 0, 1) : clamp(1 - blocked / arc.length, 0, 1);
  return { clear, confidence, minClearanceMeters: minClear === Infinity ? 0 : minClear, maxObstructionMeters: maxObst, fresnelRadiusMeters: fRad, frequencyGHz: freq };
}

export function routeLOSColor(los: LOSResult): { color: string; opacity: number } {
  if (los.clear) { if (los.confidence > 0.85) return { color: '#22c55e', opacity: 0.68 }; if (los.confidence > 0.6) return { color: '#84cc16', opacity: 0.58 }; return { color: '#eab308', opacity: 0.48 }; }
  if (los.confidence > 0.5) return { color: '#f97316', opacity: 0.44 };
  return { color: '#ef4444', opacity: 0.32 };
}

function fresnel(d: number, f: number): number { return d <= 0 || f <= 0 ? 0 : Math.sqrt((0.3 / f * d * 1000) / 2); }
function clamp(v: number, a: number, b: number): number { return Math.max(a, Math.min(b, v)); }
