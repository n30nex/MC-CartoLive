import type {
  PublicActivity,
  PublicLiveEnvelope,
  PublicLiveState,
  PublicNode,
  PublicObserverBurst,
  PublicRoute,
  PublicRouteEndpoint,
  PublicRoutePulse,
  PublicStats
} from './types';

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
}

export const emptyState: AppState = {
  nodes: [],
  routes: [],
  activity: [],
  pulses: [],
  observerBursts: [],
  routeTraces: [],
  stats: null,
  serverTime: 0
};

export function initialAppState(state: PublicLiveState): AppState {
  const pulses = hydrateSnapshotPulses(state.recentPulses ?? [], state.serverTime);
  const observerBursts = hydrateSnapshotObserverBursts(state.recentActivity ?? [], state.serverTime);
  const serverTime = state.serverTime;
  return {
    nodes: state.nodes ?? [],
    routes: normalizeRouteBuckets(state.routes ?? []),
    activity: state.recentActivity ?? [],
    pulses,
    observerBursts,
    routeTraces: pulses.reduce((traces, pulse) => addRouteTraceHits(traces, pulse, serverTime), [] as RouteTraceHit[]),
    stats: state.stats ?? null,
    serverTime
  };
}

export function hydrateSnapshotPulses(pulses: PublicRoutePulse[], serverTime: number): PublicRoutePulse[] {
  const maxHeardAt = serverTime + SNAPSHOT_PULSE_FUTURE_SKEW_MS;
  const minHeardAt = serverTime - SNAPSHOT_PULSE_STALE_MS;
  const recent = pulses
    .filter((pulse) => pulse.heardAt >= minHeardAt && pulse.heardAt <= maxHeardAt)
    .slice(0, SNAPSHOT_PULSE_REPLAY_LIMIT);
  const oldestFirst = recent.slice().reverse();
  const displayAtByID = new Map<string, number>();
  oldestFirst.forEach((pulse, index) => {
    displayAtByID.set(pulse.id, serverTime + index * SNAPSHOT_PULSE_REPLAY_SPACING_MS);
  });
  return recent.map((pulse) => ({
    ...pulse,
    receivedAt: pulse.receivedAt ?? serverTime,
    displayAt: pulse.displayAt ?? displayAtByID.get(pulse.id) ?? serverTime
  }));
}

export function hydrateSnapshotObserverBursts(activity: PublicActivity[], serverTime: number): PublicObserverBurst[] {
  const maxHeardAt = serverTime + SNAPSHOT_PULSE_FUTURE_SKEW_MS;
  const minHeardAt = serverTime - SNAPSHOT_PULSE_STALE_MS;
  const recent = activity
    .filter((item) => item.animationState === 'observer' && item.observerLocation && item.heardAt >= minHeardAt && item.heardAt <= maxHeardAt)
    .slice(0, SNAPSHOT_OBSERVER_BURST_REPLAY_LIMIT);
  const oldestFirst = recent.slice().reverse();
  const displayAtByID = new Map<string, number>();
  oldestFirst.forEach((item, index) => {
    displayAtByID.set(item.id, serverTime + index * SNAPSHOT_OBSERVER_BURST_REPLAY_SPACING_MS);
  });
  return recent.map((item) => ({
    id: `observer-${item.id}`,
    payloadTypeName: item.payloadTypeName,
    heardAt: item.heardAt,
    receivedAt: item.receivedAt ?? serverTime,
    displayAt: item.displayAt ?? displayAtByID.get(item.id) ?? serverTime,
    seq: item.seq,
    location: item.observerLocation!,
    messageSender: item.messageSender,
    messageText: item.messageText,
    messageAnchor: item.messageAnchor
  }));
}

export function applyPublicEnvelope(state: AppState, message: PublicLiveEnvelope): AppState {
  if (message.type !== 'event') return state;
  if (message.event === 'nodeUpdate') {
    const node = message.data;
    const next = state.nodes.filter((item) => item.id !== node.id);
    const nodes = [node, ...next];
    return { ...state, nodes, stats: refreshStats(state.stats, { activeNodes: nodes.length }) };
  }
  if (message.event === 'activity') {
    const activity = withEnvelopeTiming(message.data, message);
    if (state.activity.some((item) => item.id === activity.id)) return state;
    const packets = isPacketActivity(activity) ? (state.stats?.packets ?? 0) + 1 : state.stats?.packets;
    const serverTime = Math.max(state.serverTime, message.serverTime ?? activity.heardAt);
    return {
      ...state,
      activity: [activity, ...state.activity].slice(0, 240),
      observerBursts: addObserverBurst(state.observerBursts, activity, serverTime),
      stats: refreshStats(state.stats, { packets, serverTime: Math.max(state.stats?.serverTime ?? 0, serverTime) }),
      serverTime
    };
  }
  if (message.event === 'routePulse') {
    const pulse = withEnvelopeTiming(message.data, message);
    if (state.pulses.some((item) => item.id === pulse.id)) return state;
    const routes = upsertPulseRoutes(state.routes, pulse);
    const serverTime = Math.max(state.serverTime, message.serverTime ?? pulse.heardAt);
    const routeTraces = addRouteTraceHits(state.routeTraces, pulse, serverTime);
    return {
      ...state,
      routes,
      pulses: [pulse, ...state.pulses].slice(0, 240),
      routeTraces,
      stats: refreshStats(state.stats, { activeRoutes: routes.length, serverTime: Math.max(state.stats?.serverTime ?? 0, serverTime) }),
      serverTime
    };
  }
  return state;
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

function upsertPulseRoutes(routes: PublicRoute[], pulse: PublicRoutePulse): PublicRoute[] {
  if (pulse.segments.length === 0) return routes;

  const touched = new Map<string, { segment: PublicRoutePulse['segments'][number]; hits: number }>();
  for (const segment of pulse.segments) {
    const existing = touched.get(segment.routeId);
    touched.set(segment.routeId, { segment, hits: (existing?.hits ?? 0) + 1 });
  }

  let maxBefore = 1;
  let maxAfter = 1;
  let changed = false;
  let next = routes;
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    maxBefore = Math.max(maxBefore, route.packetCount);
    const update = touched.get(route.id);
    if (!update) {
      maxAfter = Math.max(maxAfter, route.packetCount);
      continue;
    }
    if (!changed) next = routes.slice();
    changed = true;
    const packetCount = route.packetCount + update.hits;
    const payloadTypeNames = route.payloadTypeNames.includes(pulse.payloadTypeName)
      ? route.payloadTypeNames
      : [...route.payloadTypeNames, pulse.payloadTypeName].sort();
    next[index] = {
      ...route,
      packetCount,
      lastHeard: Math.max(route.lastHeard, pulse.heardAt),
      frequencyBucket: frequencyBucket(packetCount, maxBefore),
      payloadTypeNames
    };
    maxAfter = Math.max(maxAfter, packetCount);
    touched.delete(route.id);
  }

  if (touched.size > 0) {
    if (!changed) next = routes.slice();
    changed = true;
    for (const { segment, hits } of touched.values()) {
      const route: PublicRoute = {
        id: segment.routeId,
        from: segment.from,
        to: segment.to,
        distanceKm: segment.distanceKm,
        packetCount: hits,
        lastHeard: pulse.heardAt,
        frequencyBucket: frequencyBucket(hits, Math.max(maxBefore, hits)),
        payloadTypeNames: [pulse.payloadTypeName]
      };
      next.push(route);
      maxAfter = Math.max(maxAfter, hits);
    }
  }

  if (!changed) return routes;
  if (maxAfter === maxBefore) return next;
  return normalizeRouteBuckets(next);
}

function normalizeRouteBuckets(routes: PublicRoute[]): PublicRoute[] {
  const max = Math.max(1, ...routes.map((route) => route.packetCount));
  return routes.map((route) => ({
    ...route,
    frequencyBucket: frequencyBucket(route.packetCount, max),
    payloadTypeNames: [...new Set(route.payloadTypeNames)].sort()
  }));
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

function withEnvelopeTiming<T extends { receivedAt?: number; displayAt?: number; seq?: number }>(
  data: T,
  message: Extract<PublicLiveEnvelope, { type: 'event' }>
): T {
  return {
    ...data,
    receivedAt: message.receivedAt ?? message.serverTime ?? data.receivedAt,
    displayAt: message.displayAt ?? message.receivedAt ?? message.serverTime ?? data.displayAt,
    seq: message.seq ?? data.seq
  };
}
