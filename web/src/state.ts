import type {
  PublicActivity,
  PublicEvent,
  PublicLiveEnvelope,
  PublicLiveState,
  PublicNode,
  PublicObserverBurst,
  PublicRoute,
  PublicRouteEndpoint,
  PublicRoutePulse,
  PublicStats
} from './types';
import { recordRouteReducerDuration } from './perfDiagnostics';

export const ROUTE_TRACE_WINDOW_MS = 15 * 60_000;
export const ROUTE_TRACE_BIN_COUNT = 12;
export const PACKET_RATE_WINDOW_MS = 60_000;
export const OBSERVER_BURST_WINDOW_MS = 15 * 60_000;
export const SNAPSHOT_PULSE_REPLAY_LIMIT = 32;
export const SNAPSHOT_PULSE_REPLAY_SPACING_MS = 140;
export const SNAPSHOT_PULSE_STALE_MS = 60_000;
export const SNAPSHOT_PULSE_FUTURE_SKEW_MS = 10_000;
export const SNAPSHOT_OBSERVER_BURST_REPLAY_LIMIT = 32;
export const SNAPSHOT_OBSERVER_BURST_REPLAY_SPACING_MS = 140;
export const ROUTE_BUCKET_REBALANCE_FACTOR = 1.25;
const ROUTE_VISUAL_FRESH_MS = 15 * 60_000;

export interface RouteTraceHit {
  routeId: string;
  heardAt: number;
  payloadTypeName: string;
  from: PublicRouteEndpoint;
  to: PublicRouteEndpoint;
  distanceKm: number;
}

export interface RouteActivitySummary {
  routeId: string;
  total: number;
  latestHeard: number;
  bins: number[];
}

export interface LiveCoverageStats {
  receivedPerMinute: number;
  routeAnimatedPerMinute: number;
  observerBurstPerMinute: number;
  unmappedPerMinute: number;
  lastPacketAgeMs: number | null;
}

export interface AppState {
  nodes: PublicNode[];
  routes: PublicRoute[];
  activity: PublicActivity[];
  pulses: PublicRoutePulse[];
  observerBursts: PublicObserverBurst[];
  routeTraces: RouteTraceHit[];
  stats: PublicStats | null;
  serverTime: number;
  latestSeq: number;
  seenSeqs: number[];
  routeIndex: Map<string, number>;
  routeMaxPacketCount: number;
  routeTopologyRevision: number;
  routeTrafficRevision: number;
  routeVisualRevision: number;
}

export interface ApplyLiveOptions {
  /** Only connected WebSocket traffic is eligible for map motion. */
  animate?: boolean;
}

export const emptyState: AppState = {
  nodes: [],
  routes: [],
  activity: [],
  pulses: [],
  observerBursts: [],
  routeTraces: [],
  stats: null,
  serverTime: 0,
  latestSeq: 0,
  seenSeqs: [],
  routeIndex: new Map(),
  routeMaxPacketCount: 1,
  routeTopologyRevision: 0,
  routeTrafficRevision: 0,
  routeVisualRevision: 0
};

export function initialAppState(state: PublicLiveState): AppState {
  const serverTime = state.serverTime;
  const routes = normalizeRouteBuckets(state.routes ?? []);
  return {
    nodes: state.nodes ?? [],
    routes,
    activity: state.recentActivity ?? [],
    // Snapshots establish authoritative state but never replay stale motion.
    pulses: [],
    observerBursts: [],
    routeTraces: (state.recentPulses ?? []).reduce((traces, pulse) => addRouteTraceHits(traces, pulse, serverTime), [] as RouteTraceHit[]),
    stats: state.stats ?? null,
    serverTime,
    latestSeq: state.stats?.latestSeq ?? 0,
    seenSeqs: [],
    routeIndex: indexRoutes(routes),
    routeMaxPacketCount: maxRoutePacketCount(routes),
    routeTopologyRevision: 1,
    routeTrafficRevision: 1,
    routeVisualRevision: 1
  };
}

export function hydrateSnapshotTopology(current: AppState, snapshot: PublicLiveState): AppState {
  const routes = mergeCurrentEntities(current.routes, normalizeRouteBuckets(snapshot.routes ?? []));
  const topologyChanged = routes.length !== current.routes.length;
  return {
    ...current,
    nodes: mergeCurrentEntities(current.nodes, snapshot.nodes ?? []),
    routes,
    routeIndex: topologyChanged ? indexRoutes(routes) : current.routeIndex,
    routeMaxPacketCount: Math.max(current.routeMaxPacketCount, maxRoutePacketCount(routes)),
    routeTopologyRevision: current.routeTopologyRevision + (topologyChanged ? 1 : 0),
    routeVisualRevision: current.routeVisualRevision + (topologyChanged ? 1 : 0),
    stats: current.stats ?? snapshot.stats ?? null,
    serverTime: Math.max(current.serverTime, snapshot.serverTime),
    latestSeq: Math.max(current.latestSeq, snapshot.stats?.latestSeq ?? 0)
  };
}

export function publicLiveStateSignature(state: PublicLiveState): string {
  const nodes = state.nodes ?? [];
  const routes = state.routes ?? [];
  const activity = state.recentActivity ?? [];
  const pulses = state.recentPulses ?? [];
  return [
    state.serverTime,
    state.stats?.latestSeq ?? 0,
    state.stats?.packets ?? 0,
    nodes.length,
    routes.length,
    activity.length,
    pulses.length,
    nodes[0]?.id ?? '',
    routes[0]?.id ?? '',
    activity[0]?.id ?? '',
    pulses[0]?.id ?? ''
  ].join(':');
}

export function hydrateSnapshotPulses(pulses: PublicRoutePulse[], serverTime: number): PublicRoutePulse[] {
  void pulses;
  void serverTime;
  return [];
}

export function hydrateSnapshotObserverBursts(activity: PublicActivity[], serverTime: number): PublicObserverBurst[] {
  void activity;
  void serverTime;
  return [];
}

export function applyPublicEnvelope(state: AppState, message: PublicLiveEnvelope): AppState {
  return applyPublicEnvelopes(state, [message], { animate: true });
}

export function applyPublicEnvelopes(state: AppState, messages: PublicLiveEnvelope[], options: ApplyLiveOptions = {}): AppState {
  const animate = options.animate !== false;
  const pulseIDs = new Set(state.pulses.map((pulse) => pulse.id));
  const acceptedPulses: PublicRoutePulse[] = [];
  let next = state;
  for (const message of messages) {
    if (message.type === 'event' && message.event === 'routePulse') {
      if (message.seq && next.seenSeqs.includes(message.seq)) {
        next = withLatestSeq(next, message.latestSeq ?? message.seq);
        continue;
      }
      const pulse = withEnvelopeTiming(message.data, message);
      if (pulseIDs.has(pulse.id)) {
        next = rememberSeq(withLatestSeq(next, message.latestSeq ?? message.seq), message.seq);
        continue;
      }
      pulseIDs.add(pulse.id);
      acceptedPulses.push(pulse);
      const serverTime = Math.max(next.serverTime, message.serverTime ?? pulse.heardAt);
      next = rememberSeq(withLatestSeq({
        ...next,
        pulses: animate ? [pulse, ...next.pulses].slice(0, 2_000) : next.pulses,
        routeTraces: addRouteTraceHits(next.routeTraces, pulse, serverTime),
        serverTime
      }, message.latestSeq ?? message.seq ?? next.latestSeq), message.seq);
      continue;
    }
    next = applyNonRouteEnvelope(next, message, animate);
  }
  if (acceptedPulses.length === 0) return next;
  const reducerStartedAt = performance.now();
  const routeUpdate = upsertPulseRoutesBatch(
    next.routes,
    next.routeIndex,
    next.routeMaxPacketCount,
    acceptedPulses
  );
  recordRouteReducerDuration(performance.now() - reducerStartedAt);
  return {
    ...next,
    routes: routeUpdate.routes,
    routeIndex: routeUpdate.routeIndex,
    routeMaxPacketCount: routeUpdate.maxPacketCount,
    routeTopologyRevision: next.routeTopologyRevision + (routeUpdate.topologyChanged ? 1 : 0),
    routeTrafficRevision: next.routeTrafficRevision + 1,
    // Packet counts and buckets are authoritative immediately, but MapLibre
    // route geometry/style refreshes on topology or the bounded freshness
    // clock instead of rebuilding its source for each traffic increment.
    routeVisualRevision: next.routeVisualRevision + (routeUpdate.topologyChanged ? 1 : 0),
    stats: refreshStats(next.stats, {
      activeRoutes: routeUpdate.routes.length,
      serverTime: Math.max(next.stats?.serverTime ?? 0, next.serverTime)
    })
  };
}

function applyNonRouteEnvelope(state: AppState, message: PublicLiveEnvelope, animate: boolean): AppState {
  if (message.type === 'hello' || message.type === 'pong' || message.type === 'lagged') {
    return withLatestSeq(state, message.latestSeq ?? message.seq ?? state.latestSeq);
  }
  if (message.type !== 'event') return state;
  if (message.seq && state.seenSeqs.includes(message.seq)) {
    return withLatestSeq(state, message.latestSeq ?? message.seq);
  }
  const mark = (next: AppState): AppState => rememberSeq(withLatestSeq(next, message.latestSeq ?? message.seq ?? next.latestSeq), message.seq);
  if (message.event === 'nodeUpdate') {
    const node = message.data;
    const next = state.nodes.filter((item) => item.id !== node.id);
    const nodes = [node, ...next];
    return mark({ ...state, nodes, stats: refreshStats(state.stats, { activeNodes: nodes.length }) });
  }
  if (message.event === 'activity') {
    const activity = withEnvelopeTiming(message.data, message);
    if (state.activity.some((item) => item.id === activity.id)) return mark(state);
    const packets = isPacketActivity(activity) ? (state.stats?.packets ?? 0) + 1 : state.stats?.packets;
    const serverTime = Math.max(state.serverTime, message.serverTime ?? activity.heardAt);
    return mark({
      ...state,
      activity: [activity, ...state.activity].slice(0, 240),
      observerBursts: animate ? addObserverBurst(state.observerBursts, activity, serverTime) : state.observerBursts,
      stats: refreshStats(state.stats, { packets, serverTime: Math.max(state.stats?.serverTime ?? 0, serverTime) }),
      serverTime
    });
  }
  return state;
}

export function applyPublicEvent(state: AppState, event: PublicEvent): AppState {
  if (event.type !== 'activity' && event.type !== 'routePulse' && event.type !== 'nodeUpdate') {
    return withLatestSeq(state, event.seq);
  }
  return applyPublicEnvelopes(state, [{
    v: 1,
    type: 'event',
    event: event.type,
    seq: event.seq,
    latestSeq: event.seq,
    serverTime: event.receivedAt ?? event.at,
    receivedAt: event.receivedAt ?? event.at,
    displayAt: event.receivedAt ?? event.at,
    data: event.data as never
  }], { animate: false });
}

export function applyPublicEvents(state: AppState, events: PublicEvent[]): AppState {
  const envelopes = events
    .filter((event) => event.type === 'activity' || event.type === 'routePulse' || event.type === 'nodeUpdate')
    .map((event) => ({
      v: 1 as const,
      type: 'event' as const,
      event: event.type as 'activity' | 'routePulse' | 'nodeUpdate',
      seq: event.seq,
      latestSeq: event.seq,
      serverTime: event.receivedAt ?? event.at,
      receivedAt: event.receivedAt ?? event.at,
      displayAt: event.receivedAt ?? event.at,
      data: event.data as never
    }));
  let next = applyPublicEnvelopes(state, envelopes as PublicLiveEnvelope[], { animate: false });
  for (const event of events) {
    if (event.type !== 'activity' && event.type !== 'routePulse' && event.type !== 'nodeUpdate') {
      next = withLatestSeq(next, event.seq);
    }
  }
  return next;
}

export function filterNodes(nodes: PublicNode[], query: string): PublicNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  return nodes.filter((node) =>
    [node.label, node.role, ...node.iatasHeardIn].some((value) => value.toLowerCase().includes(needle))
  );
}

export function filterRoutes(routes: PublicRoute[], visibleNodeIDs: Set<string>, query: string): PublicRoute[] {
  if (!query.trim()) return routes;
  return routes.filter(
    (route) =>
      visibleNodeIDs.has(route.from.nodeId) ||
      visibleNodeIDs.has(route.to.nodeId) ||
      route.from.label.toLowerCase().includes(query.toLowerCase()) ||
      route.to.label.toLowerCase().includes(query.toLowerCase())
  );
}

interface RouteBatchUpdate {
  routes: PublicRoute[];
  routeIndex: Map<string, number>;
  maxPacketCount: number;
  topologyChanged: boolean;
  visualChanged: boolean;
}

function upsertPulseRoutesBatch(
  routes: PublicRoute[],
  routeIndex: Map<string, number>,
  maxPacketCount: number,
  pulses: PublicRoutePulse[]
): RouteBatchUpdate {
  const touched = new Map<string, {
    segment: PublicRoutePulse['segments'][number];
    hits: number;
    lastHeard: number;
    payloadTypeNames: Set<string>;
  }>();
  for (const pulse of pulses) {
    for (const segment of pulse.segments) {
      const existing = touched.get(segment.routeId);
      if (existing) {
        existing.hits += 1;
        existing.lastHeard = Math.max(existing.lastHeard, pulse.heardAt);
        existing.payloadTypeNames.add(pulse.payloadTypeName);
      } else {
        touched.set(segment.routeId, {
          segment,
          hits: 1,
          lastHeard: pulse.heardAt,
          payloadTypeNames: new Set([pulse.payloadTypeName])
        });
      }
    }
  }
  if (touched.size === 0) return { routes, routeIndex, maxPacketCount, topologyChanged: false, visualChanged: false };

  const maxBefore = Math.max(1, maxPacketCount);
  let maxAfter = maxBefore;
  let changed = false;
  let next = routes;
  let nextIndex = routeIndex;
  let topologyChanged = false;
  let visualChanged = false;
  for (const [routeID, update] of touched) {
    const index = routeIndex.get(routeID);
    if (index === undefined) continue;
    const route = routes[index];
    if (!route) continue;
    if (!changed) next = routes.slice();
    changed = true;
    const packetCount = route.packetCount + update.hits;
    const payloadTypeNames = [...new Set([...route.payloadTypeNames, ...update.payloadTypeNames])].sort();
    const nextBucket = frequencyBucket(packetCount, maxBefore);
    if (nextBucket !== route.frequencyBucket || route.lastHeard < update.lastHeard - ROUTE_VISUAL_FRESH_MS) {
      visualChanged = true;
    }
    next[index] = {
      ...route,
      packetCount,
      lastHeard: Math.max(route.lastHeard, update.lastHeard),
      frequencyBucket: nextBucket,
      payloadTypeNames
    };
    maxAfter = Math.max(maxAfter, packetCount);
    touched.delete(routeID);
  }

  if (touched.size > 0) {
    if (!changed) next = routes.slice();
    changed = true;
    nextIndex = new Map(routeIndex);
    topologyChanged = true;
    visualChanged = true;
    for (const { segment, hits, lastHeard, payloadTypeNames } of touched.values()) {
      const route: PublicRoute = {
        id: segment.routeId,
        from: segment.from,
        to: segment.to,
        distanceKm: segment.distanceKm,
        packetCount: hits,
        lastHeard,
        frequencyBucket: frequencyBucket(hits, Math.max(maxBefore, hits)),
        payloadTypeNames: [...payloadTypeNames].sort()
      };
      nextIndex.set(route.id, next.length);
      next.push(route);
      maxAfter = Math.max(maxAfter, hits);
    }
  }

  if (!changed) return { routes, routeIndex, maxPacketCount: maxAfter, topologyChanged: false, visualChanged: false };
  const rebalance = maxAfter > maxBefore * ROUTE_BUCKET_REBALANCE_FACTOR;
  const normalized = rebalance ? normalizeRouteBuckets(next) : next;
  return { routes: normalized, routeIndex: nextIndex, maxPacketCount: maxAfter, topologyChanged, visualChanged: visualChanged || rebalance };
}

function mergeCurrentEntities<T extends { id: string }>(current: T[], snapshot: T[]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...current, ...snapshot]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

function normalizeRouteBuckets(routes: PublicRoute[]): PublicRoute[] {
  const max = Math.max(1, ...routes.map((route) => route.packetCount));
  return routes.map((route) => ({
    ...route,
    frequencyBucket: frequencyBucket(route.packetCount, max),
    payloadTypeNames: [...new Set(route.payloadTypeNames)].sort()
  }));
}

function indexRoutes(routes: PublicRoute[]): Map<string, number> {
  return new Map(routes.map((route, index) => [route.id, index]));
}

function maxRoutePacketCount(routes: PublicRoute[]): number {
  return Math.max(1, ...routes.map((route) => route.packetCount));
}

function frequencyBucket(count: number, maxCount: number): number {
  if (maxCount <= 1) return 0;
  return Math.max(0, Math.min(4, Math.round((Math.log1p(count) / Math.log1p(maxCount + 1)) * 4)));
}

export function addRouteTraceHits(routeTraces: RouteTraceHit[], pulse: PublicRoutePulse, now = pulse.heardAt): RouteTraceHit[] {
  const next = [
    ...routeTraces,
    ...pulse.segments.map((segment) => ({
      routeId: segment.routeId,
      heardAt: pulse.heardAt,
      payloadTypeName: pulse.payloadTypeName,
      from: segment.from,
      to: segment.to,
      distanceKm: segment.distanceKm
    }))
  ];
  return pruneRouteTraces(next, now).slice(-2000);
}

export function pruneRouteTraces(routeTraces: RouteTraceHit[], now: number): RouteTraceHit[] {
  const cutoff = now - ROUTE_TRACE_WINDOW_MS;
  return routeTraces.filter((trace) => trace.heardAt >= cutoff);
}

export function summarizeRouteActivity(routeTraces: RouteTraceHit[], now: number): Map<string, RouteActivitySummary> {
  const cutoff = now - ROUTE_TRACE_WINDOW_MS;
  const binSize = ROUTE_TRACE_WINDOW_MS / ROUTE_TRACE_BIN_COUNT;
  const summaries = new Map<string, RouteActivitySummary>();
  for (const trace of routeTraces) {
    if (trace.heardAt < cutoff) continue;
    const existing = summaries.get(trace.routeId);
    const summary =
      existing ??
      ({
        routeId: trace.routeId,
        total: 0,
        latestHeard: 0,
        bins: Array.from({ length: ROUTE_TRACE_BIN_COUNT }, () => 0)
      } satisfies RouteActivitySummary);
    const bin = Math.max(0, Math.min(ROUTE_TRACE_BIN_COUNT - 1, Math.floor((trace.heardAt - cutoff) / binSize)));
    summary.total += 1;
    summary.latestHeard = Math.max(summary.latestHeard, trace.heardAt);
    summary.bins[bin] += 1;
    if (!existing) summaries.set(trace.routeId, summary);
  }
  return summaries;
}

export function currentPacketRatePerMinute(activity: PublicActivity[], now: number): number {
  const cutoff = now - PACKET_RATE_WINDOW_MS;
  return activity.filter((item) => isPacketActivity(item) && item.heardAt >= cutoff).length;
}

export function liveCoverageStats(activity: PublicActivity[], now: number): LiveCoverageStats {
  const cutoff = now - PACKET_RATE_WINDOW_MS;
  const recent = activity.filter((item) => isPacketActivity(item) && item.heardAt >= cutoff);
  const lastPacketAt = activity.filter(isPacketActivity).reduce((latest, item) => Math.max(latest, item.heardAt), 0);
  return {
    receivedPerMinute: recent.length,
    routeAnimatedPerMinute: recent.filter((item) => item.animationState === 'route').length,
    observerBurstPerMinute: recent.filter((item) => item.animationState === 'observer').length,
    unmappedPerMinute: recent.filter((item) => item.animationState === 'unmapped').length,
    lastPacketAgeMs: lastPacketAt > 0 ? Math.max(0, now - lastPacketAt) : null
  };
}

export function addObserverBurst(observerBursts: PublicObserverBurst[], activity: PublicActivity, now = activity.heardAt): PublicObserverBurst[] {
  if (activity.animationState !== 'observer' || !activity.observerLocation) {
    return pruneObserverBursts(observerBursts, now);
  }
  const next = [
    ...observerBursts,
    {
      id: `observer-${activity.id}`,
      payloadTypeName: activity.payloadTypeName,
      heardAt: activity.heardAt,
      receivedAt: activity.receivedAt,
      displayAt: activity.displayAt,
      seq: activity.seq,
      location: activity.observerLocation,
      messageSender: activity.messageSender,
      messageText: activity.messageText,
      messageAnchor: activity.messageAnchor
    }
  ];
  return pruneObserverBursts(next, now).slice(-2000);
}

export function pruneObserverBursts(observerBursts: PublicObserverBurst[], now: number): PublicObserverBurst[] {
  const cutoff = now - OBSERVER_BURST_WINDOW_MS;
  return observerBursts.filter((burst) => burst.heardAt >= cutoff);
}

export function isPacketActivity(item: PublicActivity): boolean {
  return item.kind === 'packet' || item.kind === 'route';
}

function refreshStats(stats: PublicStats | null, next: Partial<PublicStats>): PublicStats | null {
  if (!stats) return null;
  return {
    ...stats,
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined))
  };
}

function withLatestSeq(state: AppState, seq: number | undefined): AppState {
  if (!seq || seq <= state.latestSeq) return state;
  return {
    ...state,
    latestSeq: seq,
    stats: refreshStats(state.stats, { latestSeq: seq }) ?? state.stats
  };
}

function rememberSeq(state: AppState, seq: number | undefined): AppState {
  if (!seq || seq <= 0 || state.seenSeqs.includes(seq)) return state;
  return {
    ...state,
    seenSeqs: [...state.seenSeqs, seq].slice(-1000)
  };
}

function withEnvelopeTiming<T extends { receivedAt?: number; displayAt?: number; seq?: number }>(
  data: T,
  message: Extract<PublicLiveEnvelope, { type: 'event' }>
): T {
  const receivedAt = message.receivedAt ?? message.serverTime ?? data.receivedAt;
  return {
    ...data,
    receivedAt,
    // Preserve the field for wire compatibility, but make it immediate. The
    // browser scheduler owns visual pacing and recovery never animates.
    displayAt: receivedAt ?? data.displayAt,
    seq: message.seq ?? data.seq
  };
}
