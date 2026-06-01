import type { PublicRoutePulse } from '../types';
import { sampleRouteArc } from './routeArcs';

export interface ReplayChasePoint {
  lng: number;
  lat: number;
  altitudeMeters: number;
  distanceKm: number;
  progress: number;
}

export interface ReplayChasePath {
  points: ReplayChasePoint[];
  totalDistanceKm: number;
}

export interface ReplayChaseCameraFrame {
  center: ReplayChasePoint;
  subject: ReplayChasePoint;
  lookahead: ReplayChasePoint;
  bearing: number;
  pitch: number;
  zoom: number;
}

const MIN_SEGMENT_DISTANCE_KM = 0.001;
const DEFAULT_LOOKAHEAD_PROGRESS = 0.01;

export function buildPacketReplayChasePath(segments: PublicRoutePulse['segments']): ReplayChasePath {
  const pendingPoints: Omit<ReplayChasePoint, 'progress'>[] = [];
  let totalDistanceKm = 0;

  for (const segment of segments) {
    if (!isFiniteEndpoint(segment.from) || !isFiniteEndpoint(segment.to)) continue;

    const fallbackDistanceKm = routePointDistanceKm(segment.from, segment.to);
    const distanceKm = safeSegmentDistanceKm(segment.distanceKm, fallbackDistanceKm);
    if (distanceKm <= 0) {
      if (pendingPoints.length === 0) {
        pendingPoints.push({
          lng: segment.from.lng,
          lat: segment.from.lat,
          altitudeMeters: 0,
          distanceKm: 0
        });
      }
      continue;
    }

    const samples = sampleRouteArc(segment.from, segment.to, { distanceKm });
    const startIndex = pendingPoints.length > 0 ? 1 : 0;
    for (let index = startIndex; index < samples.length; index += 1) {
      const sample = samples[index];
      pendingPoints.push({
        lng: sample.lng,
        lat: sample.lat,
        altitudeMeters: sample.altitudeMeters,
        distanceKm: totalDistanceKm + sample.progress * distanceKm
      });
    }
    totalDistanceKm += distanceKm;
  }

  return {
    points: pendingPoints.map((point) => ({
      ...point,
      progress: totalDistanceKm > 0 ? clamp(point.distanceKm / totalDistanceKm, 0, 1) : 0
    })),
    totalDistanceKm
  };
}

export function pointAlongReplayChasePath(path: ReplayChasePath, progress: number): ReplayChasePoint {
  if (path.points.length === 0 || path.totalDistanceKm <= 0) return emptyReplayChasePoint();
  if (path.points.length === 1) return path.points[0];

  const targetDistanceKm = clamp(progress, 0, 1) * path.totalDistanceKm;
  let previous = path.points[0];

  for (let index = 1; index < path.points.length; index += 1) {
    const next = path.points[index];
    if (next.distanceKm >= targetDistanceKm) {
      const spanKm = next.distanceKm - previous.distanceKm;
      const localProgress = spanKm > 0 ? (targetDistanceKm - previous.distanceKm) / spanKm : 0;
      return {
        lng: interpolate(previous.lng, next.lng, localProgress),
        lat: interpolate(previous.lat, next.lat, localProgress),
        altitudeMeters: interpolate(previous.altitudeMeters, next.altitudeMeters, localProgress),
        distanceKm: targetDistanceKm,
        progress: path.totalDistanceKm > 0 ? clamp(targetDistanceKm / path.totalDistanceKm, 0, 1) : 0
      };
    }
    previous = next;
  }

  return path.points[path.points.length - 1];
}

export function replayChaseBearing(from: ReplayChasePoint, to: ReplayChasePoint): number {
  if (!isFinitePoint(from) || !isFinitePoint(to)) return 0;
  const fromLat = degToRad(from.lat);
  const toLat = degToRad(to.lat);
  const deltaLng = degToRad(normalizeDeltaLng(to.lng - from.lng));
  const y = Math.sin(deltaLng) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);
  const bearing = radToDeg(Math.atan2(y, x));
  return Number.isFinite(bearing) ? bearing : 0;
}

export function replayChaseBearingAt(path: ReplayChasePath, progress: number, lookaheadProgress = DEFAULT_LOOKAHEAD_PROGRESS): number {
  if (path.points.length <= 1 || path.totalDistanceKm <= 0) return 0;
  const currentProgress = clamp(progress, 0, 1);
  const lookahead = Math.max(0.0001, Number.isFinite(lookaheadProgress) ? lookaheadProgress : DEFAULT_LOOKAHEAD_PROGRESS);
  const nextProgress = currentProgress >= 1 ? currentProgress - lookahead : currentProgress + lookahead;
  const current = pointAlongReplayChasePath(path, currentProgress);
  const next = pointAlongReplayChasePath(path, clamp(nextProgress, 0, 1));
  return currentProgress >= 1 ? replayChaseBearing(next, current) : replayChaseBearing(current, next);
}

export function replayChaseZoomForDistance(distanceKm: number, currentZoom: number): number {
  const safeDistanceKm = Number.isFinite(distanceKm) ? distanceKm : 0;
  const safeCurrentZoom = Number.isFinite(currentZoom) ? currentZoom : 0;
  if (safeDistanceKm > 600) return clamp(safeCurrentZoom + 0.7, 5.9, 8.2);
  if (safeDistanceKm > 160) return clamp(safeCurrentZoom + 1, 7.2, 9.4);
  return clamp(safeCurrentZoom + 1.4, 9.2, 12.3);
}

export function replayChaseCameraFrame(path: ReplayChasePath, progress: number, currentZoom: number): ReplayChaseCameraFrame {
  if (path.points.length <= 1 || path.totalDistanceKm <= 0) {
    const point = emptyReplayChasePoint();
    return { center: point, subject: point, lookahead: point, bearing: 0, pitch: 62, zoom: replayChaseZoomForDistance(0, currentZoom) };
  }

  const subjectProgress = clamp(progress, 0, 1);
  const followDistanceKm = replayChaseFollowDistanceKm(path.totalDistanceKm);
  const lookaheadDistanceKm = replayChaseLookaheadDistanceKm(path.totalDistanceKm);
  const followProgress = followDistanceKm / path.totalDistanceKm;
  const lookaheadProgress = lookaheadDistanceKm / path.totalDistanceKm;
  const subject = pointAlongReplayChasePath(path, subjectProgress);
  const center = pointAlongReplayChasePath(path, Math.max(0, subjectProgress - followProgress));
  const lookahead = pointAlongReplayChasePath(path, Math.min(1, subjectProgress + lookaheadProgress));
  return {
    center,
    subject,
    lookahead,
    bearing: replayChaseBearing(center, lookahead),
    pitch: replayChasePitchForDistance(path.totalDistanceKm),
    zoom: replayChaseZoomForDistance(path.totalDistanceKm, currentZoom)
  };
}

export function replayChaseFollowDistanceKm(totalDistanceKm: number): number {
  const safeDistanceKm = Math.max(0, Number.isFinite(totalDistanceKm) ? totalDistanceKm : 0);
  if (safeDistanceKm <= 0) return 0;
  const baseDistanceKm = safeDistanceKm > 600 ? 24 : safeDistanceKm > 160 ? 9 : 2.4;
  return clamp(baseDistanceKm, Math.min(0.15, safeDistanceKm * 0.012), Math.max(0.2, safeDistanceKm * 0.08));
}

export function replayChaseLookaheadDistanceKm(totalDistanceKm: number): number {
  const safeDistanceKm = Math.max(0, Number.isFinite(totalDistanceKm) ? totalDistanceKm : 0);
  if (safeDistanceKm <= 0) return 0;
  const baseDistanceKm = safeDistanceKm > 600 ? 52 : safeDistanceKm > 160 ? 22 : 6;
  return clamp(baseDistanceKm, Math.min(0.4, safeDistanceKm * 0.02), Math.max(0.8, safeDistanceKm * 0.14));
}

export function replayChasePitchForDistance(distanceKm: number): number {
  const safeDistanceKm = Math.max(0, Number.isFinite(distanceKm) ? distanceKm : 0);
  if (safeDistanceKm > 600) return 60;
  if (safeDistanceKm > 160) return 64;
  return 68;
}

function safeSegmentDistanceKm(distanceKm: number, fallbackDistanceKm: number): number {
  if (Number.isFinite(distanceKm) && distanceKm > 0) return Math.max(MIN_SEGMENT_DISTANCE_KM, distanceKm);
  if (Number.isFinite(fallbackDistanceKm) && fallbackDistanceKm > 0) return Math.max(MIN_SEGMENT_DISTANCE_KM, fallbackDistanceKm);
  return 0;
}

function emptyReplayChasePoint(): ReplayChasePoint {
  return {
    lng: 0,
    lat: 0,
    altitudeMeters: 0,
    distanceKm: 0,
    progress: 0
  };
}

function isFiniteEndpoint(endpoint: { lat: number; lng: number }): boolean {
  return Number.isFinite(endpoint.lat) && Number.isFinite(endpoint.lng);
}

function isFinitePoint(point: ReplayChasePoint): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng);
}

function routePointDistanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const earthKm = 6371;
  const dLat = degToRad(to.lat - from.lat);
  const dLng = degToRad(normalizeDeltaLng(to.lng - from.lng));
  const lat1 = degToRad(from.lat);
  const lat2 = degToRad(to.lat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeDeltaLng(deltaLng: number): number {
  if (!Number.isFinite(deltaLng)) return 0;
  return ((((deltaLng + 180) % 360) + 360) % 360) - 180;
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function radToDeg(value: number): number {
  return (value * 180) / Math.PI;
}

function interpolate(a: number, b: number, progress: number): number {
  return a + (b - a) * progress;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
