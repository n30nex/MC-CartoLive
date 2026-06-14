import { normalizePayloadType, payloadVisual } from './payloadVisuals';
import { activeAssetPack } from './assets/v3/assetPacks';
import type { AppState } from './state';
import type { PublicActivity, PublicMessageAnchor, PublicObserverLocation, PublicRoutePulse } from './types';

export type LabExperimentID = 'waterfall';

export interface LabExperiment {
  id: LabExperimentID;
  label: string;
  shortLabel: string;
  mode: 'hybrid';
  path: string;
  accent: string;
  tagline: string;
  detail: string;
  signal: string;
  cues: readonly string[];
}

export interface LabPoint {
  lat: number;
  lng: number;
  label: string;
}

export interface LabEvent {
  id: string;
  source: 'activity' | 'routePulse';
  kind: 'routed' | 'observer' | 'unmapped';
  at: number;
  displayAt: number;
  payloadTypeName: string;
  payloadLabel: string;
  color: string;
  region: string;
  iata: string;
  hopCount: number;
  segmentCount: number;
  distanceKm: number;
  routeIds: string[];
  endpointLabels: string[];
  points: LabPoint[];
  messageSender?: string;
  messageText?: string;
}

export interface LabPayloadMix {
  payloadTypeName: string;
  label: string;
  color: string;
  count: number;
}

export interface LabMetrics {
  eventCount: number;
  packetRatePerMinute: number;
  routedPerMinute: number;
  observerPerMinute: number;
  unmappedPerMinute: number;
  liveEnergy: number;
  averageHopCount: number;
  longestDistanceKm: number;
  activeRegionCount: number;
  activeRegions: string[];
  payloadMix: LabPayloadMix[];
  messageCount: number;
}

export interface LabWaterfallLane {
  payloadTypeName: string;
  label: string;
  color: string;
  count: number;
  routed: number;
  observer: number;
  messages: number;
  energy: number;
}

const LAB_EVENT_LIMIT = 360;
const LAB_WINDOW_MS = 60_000;
const ACTIVE_REGION_LIMIT = 6;
export const DEFAULT_LAB_EXPERIMENT_ID: LabExperimentID = 'waterfall';
export const LAB_EXPERIMENT_PATH_PREFIX = '#/lab/';
export const WATERFALL_LAB_PATH = '#/lab/waterfall';
export const LEGACY_LAB_EXPERIMENT_IDS = [
  'synth',
  'sequencer',
  'organism',
  'constellation',
  'aurora',
  'dj',
  'radar',
  'fireflies'
] as const;

export const LAB_EXPERIMENTS: readonly LabExperiment[] = [
  {
    id: 'waterfall',
    label: 'Packet Waterfall',
    shortLabel: 'Waterfall',
    mode: 'hybrid',
    path: WATERFALL_LAB_PATH,
    accent: '#22d3ee',
    tagline: 'Packets fall through a cinematic RF cascade and play the live network.',
    detail: 'Public packet activity becomes capped luminous streams, mist, route ribbons, impact rings, and opt-in rhythmic synth audio.',
    signal: 'Payload type, route state, packet density, hop count, public regions, message presence, and route distance.',
    cues: ['Capped packet streams', 'Rhythmic synth pulses', 'Live RF intensity']
  }
] as const;

export const WATERFALL_BACKGROUND_SRC = activeAssetPack.public.waterfallBackground;
export const WATERFALL_MIST_SRC = activeAssetPack.public.waterfallMist;

export function isLabExperimentID(value: string): value is LabExperimentID {
  return value === DEFAULT_LAB_EXPERIMENT_ID;
}

export function labExperimentPath(_id: LabExperimentID = DEFAULT_LAB_EXPERIMENT_ID): string {
  return WATERFALL_LAB_PATH;
}

export function canonicalLabHash(hash: string): string | null {
  if (hash === '#/lab' || hash === WATERFALL_LAB_PATH) return WATERFALL_LAB_PATH;
  if (!hash.startsWith(LAB_EXPERIMENT_PATH_PREFIX)) return null;
  return WATERFALL_LAB_PATH;
}

export function labExperimentIDFromHash(hash: string): LabExperimentID {
  return canonicalLabHash(hash) ? DEFAULT_LAB_EXPERIMENT_ID : DEFAULT_LAB_EXPERIMENT_ID;
}

export function isLegacyLabExperimentHash(hash: string): boolean {
  if (!hash.startsWith(LAB_EXPERIMENT_PATH_PREFIX)) return false;
  return hash !== WATERFALL_LAB_PATH;
}

export function experimentByID(_id: string | undefined): LabExperiment {
  return LAB_EXPERIMENTS[0];
}

export function labEventsFromState(state: Pick<AppState, 'activity' | 'pulses'>, limit = LAB_EVENT_LIMIT): LabEvent[] {
  const byKey = new Map<string, LabEvent>();

  for (const pulse of state.pulses ?? []) {
    const event = routePulseToLabEvent(pulse);
    byKey.set(`${event.source}:${event.id}`, event);
  }

  for (const activity of state.activity ?? []) {
    const event = activityToLabEvent(activity);
    byKey.set(`${event.source}:${event.id}`, event);
  }

  return [...byKey.values()]
    .filter((event) => Number.isFinite(event.at) && event.at > 0)
    .sort((a, b) => b.displayAt - a.displayAt || b.at - a.at || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, limit));
}

export function labMetrics(events: LabEvent[], now = Date.now(), windowMs = LAB_WINDOW_MS): LabMetrics {
  const recent = recentLabEvents(events, now, windowMs);
  const payloadMix = payloadMixForEvents(recent.length > 0 ? recent : events, 9);
  const regions = [...new Set(recent.map((event) => event.region || event.iata).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, ACTIVE_REGION_LIMIT);
  const hopTotal = recent.reduce((sum, event) => sum + event.hopCount, 0);
  const routedPerMinute = recent.filter((event) => event.kind === 'routed').length;
  const observerPerMinute = recent.filter((event) => event.kind === 'observer').length;
  const unmappedPerMinute = recent.filter((event) => event.kind === 'unmapped').length;
  const messageCount = recent.filter((event) => Boolean(event.messageText)).length;
  const density = recent.length / Math.max(16, windowMs / 3_000);
  const liveEnergy = clamp01(density + routedPerMinute / 42 + observerPerMinute / 58 + messageCount / 28);

  return {
    eventCount: events.length,
    packetRatePerMinute: Math.round(recent.length * (60_000 / Math.max(1, windowMs))),
    routedPerMinute,
    observerPerMinute,
    unmappedPerMinute,
    liveEnergy,
    averageHopCount: recent.length ? hopTotal / recent.length : 0,
    longestDistanceKm: recent.reduce((max, event) => Math.max(max, event.distanceKm), 0),
    activeRegionCount: regions.length,
    activeRegions: regions,
    payloadMix,
    messageCount
  };
}

export function recentLabEvents(events: LabEvent[], now = Date.now(), windowMs = LAB_WINDOW_MS): LabEvent[] {
  const start = now - Math.max(5_000, windowMs);
  return events.filter((event) => event.displayAt >= start && event.displayAt <= now + 5_000);
}

export function waterfallLanes(events: LabEvent[], now = Date.now(), windowMs = LAB_WINDOW_MS, limit = 9): LabWaterfallLane[] {
  const recent = recentLabEvents(events, now, windowMs);
  const source = recent.length > 0 ? recent : events;
  const lanes = new Map<string, LabWaterfallLane>();
  for (const event of source) {
    const payloadTypeName = normalizePayloadType(event.payloadTypeName);
    const visual = payloadVisual(payloadTypeName);
    const lane = lanes.get(payloadTypeName) ?? {
      payloadTypeName,
      label: visual.shortLabel,
      color: visual.color,
      count: 0,
      routed: 0,
      observer: 0,
      messages: 0,
      energy: 0
    };
    lane.count += 1;
    if (event.kind === 'routed') lane.routed += 1;
    if (event.kind === 'observer') lane.observer += 1;
    if (event.messageText) lane.messages += 1;
    lane.energy += eventIntensity(event) * freshness(event.displayAt, now);
    lanes.set(payloadTypeName, lane);
  }
  return [...lanes.values()]
    .map((lane) => ({ ...lane, energy: clamp01(lane.energy / Math.max(1, lane.count / 2)) }))
    .sort((a, b) => b.count - a.count || b.energy - a.energy || a.payloadTypeName.localeCompare(b.payloadTypeName))
    .slice(0, Math.max(1, limit));
}

export function filterLabEventsByPayload(events: LabEvent[], payloadTypeName: string): LabEvent[] {
  if (!payloadTypeName || payloadTypeName === 'all') return events;
  const normalized = normalizePayloadType(payloadTypeName);
  return events.filter((event) => normalizePayloadType(event.payloadTypeName) === normalized);
}

export function eventPitchHz(event: Pick<LabEvent, 'payloadTypeName' | 'hopCount' | 'distanceKm' | 'kind' | 'messageText'>): number {
  const payload = normalizePayloadType(event.payloadTypeName);
  const root = 174.61 + (stableHash(payload) % 9) * 21.25;
  const hopLift = Math.min(10, Math.max(0, event.hopCount)) * 16;
  const distanceLift = Math.log10(Math.max(1, event.distanceKm + 1)) * 58;
  const kindShift = event.kind === 'observer' ? -42 : event.kind === 'unmapped' ? -78 : 0;
  const messageLift = event.messageText ? 72 : 0;
  return Math.round(Math.max(72, Math.min(1760, root + hopLift + distanceLift + kindShift + messageLift)));
}

export function eventStereoPan(event: Pick<LabEvent, 'region' | 'iata' | 'points'>): number {
  if (event.points[0]) {
    return clamp((event.points[0].lng + 141) / 90 - 1, -0.9, 0.9);
  }
  const hash = stableHash(event.region || event.iata || 'center') % 200;
  return clamp(hash / 100 - 1, -0.75, 0.75);
}

export function eventIntensity(event: Pick<LabEvent, 'distanceKm' | 'hopCount' | 'kind' | 'messageText'>): number {
  return clamp01(
    0.2 +
    Math.min(0.34, event.distanceKm / 1_500) +
    Math.min(0.22, event.hopCount / 18) +
    (event.kind === 'routed' ? 0.18 : event.kind === 'observer' ? 0.08 : 0) +
    (event.messageText ? 0.12 : 0)
  );
}

export function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function routePulseToLabEvent(pulse: PublicRoutePulse): LabEvent {
  const visual = payloadVisual(pulse.payloadTypeName);
  const points = pulse.segments.flatMap((segment, index) => index === 0
    ? [endpointToPoint(segment.from), endpointToPoint(segment.to)]
    : [endpointToPoint(segment.to)]
  );
  const distanceKm = pulse.segments.reduce((sum, segment) => sum + safeNumber(segment.distanceKm), 0);
  return {
    id: pulse.id,
    source: 'routePulse',
    kind: 'routed',
    at: safeNumber(pulse.heardAt),
    displayAt: safeNumber(pulse.displayAt ?? pulse.receivedAt ?? pulse.heardAt),
    payloadTypeName: normalizePayloadType(pulse.payloadTypeName),
    payloadLabel: visual.label,
    color: visual.color,
    region: safeText(pulse.region),
    iata: safeText(pulse.iata),
    hopCount: Math.max(1, pulse.segments.length + 1),
    segmentCount: pulse.segments.length,
    distanceKm,
    routeIds: uniqueStrings(pulse.segments.map((segment) => segment.routeId)),
    endpointLabels: uniqueStrings(pulse.segments.flatMap((segment) => [segment.from.label, segment.to.label])),
    points,
    messageSender: safeOptionalText(pulse.messageSender),
    messageText: safeOptionalText(pulse.messageText)
  };
}

function activityToLabEvent(activity: PublicActivity): LabEvent {
  const visual = payloadVisual(activity.payloadTypeName);
  const kind = activity.animationState === 'route' || activity.hasRoute
    ? 'routed'
    : activity.animationState === 'observer'
      ? 'observer'
      : 'unmapped';
  const anchorPoint = messageAnchorToPoint(activity.messageAnchor);
  const observerPoint = observerLocationToPoint(activity.observerLocation);
  return {
    id: activity.id,
    source: 'activity',
    kind,
    at: safeNumber(activity.heardAt),
    displayAt: safeNumber(activity.displayAt ?? activity.receivedAt ?? activity.heardAt),
    payloadTypeName: normalizePayloadType(activity.payloadTypeName),
    payloadLabel: visual.label,
    color: visual.color,
    region: safeText(activity.region),
    iata: safeText(activity.iata),
    hopCount: Math.max(0, safeNumber(activity.hopCount)),
    segmentCount: Math.max(0, activity.routeIds?.length ?? 0),
    distanceKm: 0,
    routeIds: uniqueStrings(activity.routeIds ?? []),
    endpointLabels: uniqueStrings(activity.endpointLabels ?? []),
    points: [anchorPoint, observerPoint].filter((point): point is LabPoint => Boolean(point)),
    messageSender: safeOptionalText(activity.messageSender),
    messageText: safeOptionalText(activity.messageText)
  };
}

function payloadMixForEvents(events: LabEvent[], limit: number): LabPayloadMix[] {
  const mix = new Map<string, LabPayloadMix>();
  for (const event of events) {
    const payloadTypeName = normalizePayloadType(event.payloadTypeName);
    const visual = payloadVisual(payloadTypeName);
    const current = mix.get(payloadTypeName) ?? { payloadTypeName, label: visual.shortLabel, color: visual.color, count: 0 };
    current.count += 1;
    mix.set(payloadTypeName, current);
  }
  return [...mix.values()]
    .sort((a, b) => b.count - a.count || a.payloadTypeName.localeCompare(b.payloadTypeName))
    .slice(0, Math.max(1, limit));
}

function endpointToPoint(endpoint: { lat: number; lng: number; label: string; nodeId?: string }): LabPoint {
  return {
    lat: safeNumber(endpoint.lat),
    lng: safeNumber(endpoint.lng),
    label: safeText(endpoint.label || endpoint.nodeId || 'node')
  };
}

function messageAnchorToPoint(anchor: PublicMessageAnchor | undefined): LabPoint | null {
  if (!anchor) return null;
  return {
    lat: safeNumber(anchor.lat),
    lng: safeNumber(anchor.lng),
    label: safeText(anchor.label || anchor.nodeId || anchor.kind || 'message')
  };
}

function observerLocationToPoint(location: PublicObserverLocation | undefined): LabPoint | null {
  if (!location) return null;
  return {
    lat: safeNumber(location.lat),
    lng: safeNumber(location.lng),
    label: safeText(location.label || location.iata || location.region || 'observer')
  };
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.map(safeText).filter(Boolean))];
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeOptionalText(value: unknown): string | undefined {
  const text = safeText(value);
  return text || undefined;
}

function freshness(at: number, now: number): number {
  if (!Number.isFinite(at) || at <= 0) return 0;
  return clamp01(1 - Math.max(0, now - at) / LAB_WINDOW_MS);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
