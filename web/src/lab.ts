import { normalizePayloadType, payloadVisual } from './payloadVisuals';
import type { AppState } from './state';
import type { PublicActivity, PublicMessageAnchor, PublicNode, PublicObserverLocation, PublicRoute, PublicRouteEndpoint, PublicRoutePulse } from './types';

export type LabExperimentID =
  | 'synth'
  | 'waterfall'
  | 'sequencer'
  | 'organism'
  | 'constellation'
  | 'aurora'
  | 'dj'
  | 'radar'
  | 'fireflies';

export interface LabExperiment {
  id: LabExperimentID;
  label: string;
  shortLabel: string;
  mode: 'audio' | 'visual' | 'hybrid';
  path: string;
  accent: string;
  tagline: string;
  detail: string;
  signal: string;
  cues: readonly string[];
}

export const LAB_EXPERIMENTS: readonly LabExperiment[] = [
  {
    id: 'synth',
    label: 'RF Synth',
    shortLabel: 'Synth',
    mode: 'hybrid',
    path: '#/lab/synth',
    accent: '#38bdf8',
    tagline: 'Packets become pitch, pan, and pulse.',
    detail: 'Live routed and observer events drive an opt-in Web Audio voice plus orbital packet particles.',
    signal: 'Payload type, route distance, hop count, region, and route confidence.',
    cues: ['Enable audio for tones', 'Watch routed pulses orbit wider', 'Observer packets sound sharper']
  },
  {
    id: 'waterfall',
    label: 'Packet Waterfall',
    shortLabel: 'Waterfall',
    mode: 'visual',
    path: '#/lab/waterfall',
    accent: '#22c55e',
    tagline: 'A rolling signal scope for public packet flow.',
    detail: 'Payload lanes reveal bursts, long paths, observer-only packets, and quiet gaps at a glance.',
    signal: 'Payload labels over the last live minute, colored by public packet class.',
    cues: ['Lane density shows bursts', 'Long streaks mean longer paths', 'Quiet lanes expose payload gaps']
  },
  {
    id: 'sequencer',
    label: 'Live Sequencer',
    shortLabel: 'Sequence',
    mode: 'hybrid',
    path: '#/lab/sequencer',
    accent: '#facc15',
    tagline: 'The network plays a 16-step pattern.',
    detail: 'Packet density fills steps while routed, observer, and message events change the rhythm.',
    signal: 'Minute buckets, payload mix, routed/observer balance, and message hits.',
    cues: ['Active step follows the beat', 'Payload mix colors the groove', 'Messages add accents']
  },
  {
    id: 'organism',
    label: 'Route Organism',
    shortLabel: 'Organism',
    mode: 'visual',
    path: '#/lab/organism',
    accent: '#a78bfa',
    tagline: 'Routes breathe like living tissue.',
    detail: 'High-confidence public routes flex with recent activity without exposing raw paths.',
    signal: 'Public route endpoints, packet counts, distance, and recent route events.',
    cues: ['Thicker fibers are busier', 'Fresh paths flex harder', 'Nodes glow with route energy']
  },
  {
    id: 'constellation',
    label: 'RF Constellation',
    shortLabel: 'Stars',
    mode: 'visual',
    path: '#/lab/constellation',
    accent: '#67e8f9',
    tagline: 'A sky chart of active RF nodes.',
    detail: 'Nodes become stars, routes become faint constellations, and fresh packets ripple through the field.',
    signal: 'Public nodes, roles, route frequency buckets, and routed event pulses.',
    cues: ['Repeaters glow warm', 'Observers glow rose', 'Fresh routed events ripple']
  },
  {
    id: 'aurora',
    label: 'Propagation Aurora',
    shortLabel: 'Aurora',
    mode: 'hybrid',
    path: '#/lab/aurora',
    accent: '#a3e635',
    tagline: 'Long hops shimmer as RF weather.',
    detail: 'Distance and hop count shape slow bands and gentle tones for unusual public route motion.',
    signal: 'Long-distance routed packets, multi-hop events, and live packet energy.',
    cues: ['Long routes raise the bands', 'Multi-hop packets thicken color', 'Audio is deliberately slow']
  },
  {
    id: 'dj',
    label: 'Packet DJ Booth',
    shortLabel: 'DJ Booth',
    mode: 'hybrid',
    path: '#/lab/dj',
    accent: '#fb7185',
    tagline: 'Payload mix becomes a live equalizer.',
    detail: 'The packet type distribution drives bars, arcs, and sharper percussive audio gestures.',
    signal: 'Payload mix, packet rate, event intensity, and route-vs-observer balance.',
    cues: ['Top payload becomes Deck A', 'Packet rate maps to BPM', 'Routed events add saw bite']
  },
  {
    id: 'radar',
    label: 'Network Weather Radar',
    shortLabel: 'Radar',
    mode: 'visual',
    path: '#/lab/radar',
    accent: '#2dd4bf',
    tagline: 'Regions scan like storm cells.',
    detail: 'Public region/IATA buckets become radar returns so operators can see where activity is clustering.',
    signal: 'Region counts, routed events, observer events, and public message density.',
    cues: ['Large cells are busy regions', 'Sweep line shows live scan', 'Message density adds glow']
  },
  {
    id: 'fireflies',
    label: 'Message Fireflies',
    shortLabel: 'Fireflies',
    mode: 'visual',
    path: '#/lab/fireflies',
    accent: '#f97316',
    tagline: 'Public text events drift through the RF field.',
    detail: 'Sanitized public message anchors become soft moving lights without exposing private packet data.',
    signal: 'Public-safe message sender labels, sanitized text presence, region, and observer/routed anchors.',
    cues: ['Only public text events appear', 'Anchored messages drift locally', 'Quiet means no recent public text']
  }
] as const;

export const DEFAULT_LAB_EXPERIMENT_ID: LabExperimentID = 'synth';
export const LAB_EXPERIMENT_PATH_PREFIX = '#/lab/';

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

export interface LabSequencerStep {
  index: number;
  start: number;
  end: number;
  count: number;
  routed: number;
  observer: number;
  message: number;
  payloads: LabPayloadMix[];
  energy: number;
}

export interface LabSequencerPattern {
  from: number;
  to: number;
  steps: LabSequencerStep[];
}

export interface LabRouteOrganismRoute {
  id: string;
  from: LabPoint;
  to: LabPoint;
  packetCount: number;
  distanceKm: number;
  activity: number;
  color: string;
}

export interface LabRegionCell {
  region: string;
  count: number;
  routed: number;
  observer: number;
  message: number;
  energy: number;
  color: string;
}

const LAB_EVENT_LIMIT = 260;
const LAB_WINDOW_MS = 60_000;
const ACTIVE_REGION_LIMIT = 6;

const LAB_EXPERIMENT_IDS = new Set<LabExperimentID>(LAB_EXPERIMENTS.map((experiment) => experiment.id));

export function isLabExperimentID(value: string): value is LabExperimentID {
  return LAB_EXPERIMENT_IDS.has(value as LabExperimentID);
}

export function labExperimentPath(id: LabExperimentID): string {
  return experimentByID(id).path;
}

export function labExperimentIDFromHash(hash: string): LabExperimentID {
  if (hash === '#/lab') return DEFAULT_LAB_EXPERIMENT_ID;
  if (!hash.startsWith(LAB_EXPERIMENT_PATH_PREFIX)) return DEFAULT_LAB_EXPERIMENT_ID;
  const id = hash.slice(LAB_EXPERIMENT_PATH_PREFIX.length).split(/[/?#]/)[0];
  return isLabExperimentID(id) ? id : DEFAULT_LAB_EXPERIMENT_ID;
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

export function labMetrics(events: LabEvent[], nodes: PublicNode[] = [], routes: PublicRoute[] = [], now = Date.now()): LabMetrics {
  const recent = events.filter((event) => event.displayAt >= now - LAB_WINDOW_MS && event.displayAt <= now + 5_000);
  const payloadMix = payloadMixForEvents(recent.length > 0 ? recent : events, 8);
  const regions = [...new Set(recent.map((event) => event.region || event.iata).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, ACTIVE_REGION_LIMIT);
  const hopTotal = recent.reduce((sum, event) => sum + event.hopCount, 0);
  const routedPerMinute = recent.filter((event) => event.kind === 'routed').length;
  const observerPerMinute = recent.filter((event) => event.kind === 'observer').length;
  const unmappedPerMinute = recent.filter((event) => event.kind === 'unmapped').length;
  const densityBoost = Math.min(0.35, routes.length / Math.max(24, nodes.length * 3));
  const liveEnergy = clamp01(recent.length / 32 + routedPerMinute / 44 + observerPerMinute / 60 + densityBoost);

  return {
    eventCount: events.length,
    packetRatePerMinute: recent.length,
    routedPerMinute,
    observerPerMinute,
    unmappedPerMinute,
    liveEnergy,
    averageHopCount: recent.length ? hopTotal / recent.length : 0,
    longestDistanceKm: recent.reduce((max, event) => Math.max(max, event.distanceKm), 0),
    activeRegionCount: regions.length,
    activeRegions: regions,
    payloadMix,
    messageCount: recent.filter((event) => Boolean(event.messageText)).length
  };
}

export function buildSequencerPattern(events: LabEvent[], now = Date.now(), stepCount = 16, windowMs = LAB_WINDOW_MS): LabSequencerPattern {
  const safeStepCount = Math.max(4, Math.min(32, Math.floor(stepCount)));
  const from = now - Math.max(5_000, windowMs);
  const to = now;
  const stepMs = (to - from) / safeStepCount;
  const steps: LabSequencerStep[] = Array.from({ length: safeStepCount }, (_, index) => {
    const start = from + index * stepMs;
    const end = index === safeStepCount - 1 ? to + 1 : start + stepMs;
    const stepEvents = events.filter((event) => event.displayAt >= start && event.displayAt < end);
    return {
      index,
      start,
      end,
      count: stepEvents.length,
      routed: stepEvents.filter((event) => event.kind === 'routed').length,
      observer: stepEvents.filter((event) => event.kind === 'observer').length,
      message: stepEvents.filter((event) => Boolean(event.messageText)).length,
      payloads: payloadMixForEvents(stepEvents, 4),
      energy: clamp01(stepEvents.length / 6 + stepEvents.reduce((sum, event) => sum + Math.min(1, event.distanceKm / 900), 0) / 12)
    };
  });
  return { from, to, steps };
}

export function routeOrganismRoutes(routes: PublicRoute[], events: LabEvent[], now = Date.now(), limit = 96): LabRouteOrganismRoute[] {
  const activityByRoute = new Map<string, number>();
  for (const event of events) {
    const ageMs = Math.max(0, now - event.displayAt);
    const weight = Math.exp(-ageMs / LAB_WINDOW_MS) * (event.kind === 'routed' ? 1 : 0.25);
    for (const routeId of event.routeIds) {
      activityByRoute.set(routeId, (activityByRoute.get(routeId) ?? 0) + weight);
    }
  }
  return routes
    .map((route) => {
      const visual = payloadVisual(route.payloadTypeNames?.[0]);
      return {
        id: route.id,
        from: endpointToPoint(route.from),
        to: endpointToPoint(route.to),
        packetCount: Math.max(0, route.packetCount),
        distanceKm: Math.max(0, route.distanceKm),
        activity: clamp01((activityByRoute.get(route.id) ?? 0) / 5 + freshness(route.lastHeard, now) * 0.4),
        color: visual.color
      };
    })
    .sort((a, b) => b.activity - a.activity || b.packetCount - a.packetCount || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, limit));
}

export function regionCells(events: LabEvent[], now = Date.now(), limit = 12): LabRegionCell[] {
  const cells = new Map<string, LabRegionCell>();
  for (const event of events) {
    const region = event.region || event.iata || 'unknown';
    const visual = payloadVisual(event.payloadTypeName);
    const existing = cells.get(region) ?? {
      region,
      count: 0,
      routed: 0,
      observer: 0,
      message: 0,
      energy: 0,
      color: visual.color
    };
    existing.count += 1;
    if (event.kind === 'routed') existing.routed += 1;
    if (event.kind === 'observer') existing.observer += 1;
    if (event.messageText) existing.message += 1;
    existing.energy += freshness(event.displayAt, now) * (event.kind === 'routed' ? 1 : 0.65);
    cells.set(region, existing);
  }
  return [...cells.values()]
    .map((cell) => ({ ...cell, energy: clamp01(cell.energy / Math.max(3, cell.count)) }))
    .sort((a, b) => b.energy - a.energy || b.count - a.count || a.region.localeCompare(b.region))
    .slice(0, Math.max(1, limit));
}

export function eventPitchHz(event: Pick<LabEvent, 'payloadTypeName' | 'hopCount' | 'distanceKm' | 'kind'>): number {
  const payload = normalizePayloadType(event.payloadTypeName);
  const root = 164.81 + (stableHash(payload) % 7) * 24.5;
  const hopLift = Math.min(9, Math.max(0, event.hopCount)) * 18;
  const distanceLift = Math.log10(Math.max(1, event.distanceKm + 1)) * 68;
  const kindShift = event.kind === 'observer' ? -36 : event.kind === 'unmapped' ? -72 : 0;
  return Math.round(Math.max(80, Math.min(1440, root + hopLift + distanceLift + kindShift)));
}

export function eventStereoPan(event: Pick<LabEvent, 'region' | 'iata' | 'points'>): number {
  if (event.points[0]) {
    return clamp((event.points[0].lng + 141) / 90 - 1, -0.9, 0.9);
  }
  const hash = stableHash(event.region || event.iata || 'center') % 200;
  return clamp(hash / 100 - 1, -0.75, 0.75);
}

export function eventIntensity(event: Pick<LabEvent, 'distanceKm' | 'hopCount' | 'kind'>): number {
  return clamp01(0.22 + Math.min(0.46, event.distanceKm / 1_200) + Math.min(0.24, event.hopCount / 22) + (event.kind === 'routed' ? 0.12 : 0));
}

export function experimentByID(id: string | undefined): LabExperiment {
  return LAB_EXPERIMENTS.find((experiment) => experiment.id === id) ?? LAB_EXPERIMENTS[0];
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

function endpointToPoint(endpoint: PublicRouteEndpoint): LabPoint {
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

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
