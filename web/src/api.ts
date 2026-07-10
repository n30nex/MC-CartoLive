import type {
  PublicActivity,
  PublicChatResponse,
  PublicChatMessage,
  PublicCoverageResponse,
  PublicBootstrapResponse,
  PublicEventsResponse,
  PublicHistoryResponse,
  PublicHistorySummaryResponse,
  PublicLOSProfileResponse,
  PublicMessageAnchor,
  PublicLiveState,
  PublicMapCluster,
  PublicNOCResponse,
  PublicNode,
  PublicObserverLocation,
  PublicPacketPath,
  PublicPropagationConditions,
  PublicPropagationEvent,
  PublicPropagationResponse,
  PublicPropagationSolarSummary,
  PublicPropagationWeatherSummary,
  PublicRoute,
  PublicRouteEndpoint,
  PublicRoutePulse,
  PublicRouteSegment,
  PublicPacketsResponse,
  PublicSensorSummaryResponse,
  PublicViewportResponse,
  PublicResolutionBucket,
  PublicStats,
  RuntimeHealth,
  SolarConditions
} from './types';

const PUBLIC_STATE_CACHE_KEY = 'mc-cartolive:last-public-state';
export const JSON_REQUEST_TIMEOUT_MS = 10_000;
export const PUBLIC_STATE_CACHE_MAX_AGE_MS = 5 * 60_000;
const PUBLIC_STATE_CACHE_WRITE_INTERVAL_MS = 60_000;
let lastPublicStateCacheWriteAt = 0;
let pendingPublicStateCacheWrite = false;

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const request = withRequestTimeout(signal);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: request.signal });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return await res.json() as T;
  } finally {
    request.cleanup();
  }
}

function withRequestTimeout(signal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), JSON_REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}

export interface PublicStateFetchResult {
  state: PublicLiveState;
  source: 'network' | 'offline-cache';
  cachedAt?: number;
}

export function fetchPublicState(signal?: AbortSignal): Promise<PublicLiveState> {
  return getJSON<PublicLiveState>('/api/v1/public/state', signal).then((response) => {
    const state = sanitizePublicState(response);
    cachePublicStateSnapshot(state);
    return state;
  });
}

export async function fetchPublicStateWithFallback(signal?: AbortSignal): Promise<PublicStateFetchResult> {
  try {
    return { state: await fetchPublicState(signal), source: 'network' };
  } catch (error) {
    if (signal?.aborted) throw error;
    const cached = readCachedPublicStateSnapshot();
    if (cached) return cached;
    throw error;
  }
}

export function fetchPublicBootstrap(signal?: AbortSignal): Promise<PublicBootstrapResponse> {
  return getJSON<PublicBootstrapResponse>('/api/v1/public/bootstrap', signal).then(sanitizePublicBootstrapResponse);
}

export function fetchHealthz(): Promise<RuntimeHealth> {
  return getJSON<RuntimeHealth>('/healthz');
}

export function fetchReadyz(): Promise<RuntimeHealth> {
  return getJSON<RuntimeHealth>('/readyz');
}

export interface PublicHistoryParams {
  from: number;
  to: number;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export function fetchPublicHistory({ from, to, limit, cursor, signal }: PublicHistoryParams): Promise<PublicHistoryResponse> {
  const params = new URLSearchParams({
    from: Math.round(from).toString(),
    to: Math.round(to).toString()
  });
  if (limit !== undefined) params.set('limit', Math.round(limit).toString());
  if (cursor) params.set('cursor', cursor);
  return getJSON<PublicHistoryResponse>(`/api/v1/public/history?${params.toString()}`, signal);
}

export interface PublicEventsParams {
  afterSeq?: number;
  from?: number;
  to?: number;
  limit?: number;
  region?: string;
  payload?: string;
  event?: string;
  messageOnly?: boolean;
  signal?: AbortSignal;
}

export function fetchPublicEvents({ afterSeq, from, to, limit, region, payload, event, messageOnly, signal }: PublicEventsParams): Promise<PublicEventsResponse> {
  const params = new URLSearchParams();
  if (afterSeq !== undefined) params.set('afterSeq', Math.max(0, Math.round(afterSeq)).toString());
  if (from !== undefined) params.set('from', Math.round(from).toString());
  if (to !== undefined) params.set('to', Math.round(to).toString());
  if (limit !== undefined) params.set('limit', Math.round(limit).toString());
  if (region) params.set('region', region);
  if (payload) params.set('payload', payload);
  if (event) params.set('event', event);
  if (messageOnly) params.set('messageOnly', 'true');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return getJSON<PublicEventsResponse>(`/api/v1/public/events${suffix}`, signal).then(sanitizePublicEventsResponse);
}

export interface PublicViewportParams {
  bbox: [number, number, number, number];
  zoom?: number;
  include?: string[];
  sinceSeq?: number;
  signal?: AbortSignal;
}

export function fetchPublicViewport({ bbox, zoom, include, sinceSeq, signal }: PublicViewportParams): Promise<PublicViewportResponse> {
  const params = new URLSearchParams({ bbox: bbox.map((value) => String(value)).join(',') });
  if (zoom !== undefined) params.set('zoom', String(zoom));
  if (include && include.length > 0) params.set('include', include.join(','));
  if (sinceSeq !== undefined) params.set('sinceSeq', Math.round(sinceSeq).toString());
  return getJSON<PublicViewportResponse>(`/api/v1/public/viewport?${params.toString()}`, signal).then(sanitizePublicViewportResponse);
}

export function fetchPublicNOC(signal?: AbortSignal): Promise<PublicNOCResponse> {
  return getJSON<PublicNOCResponse>('/api/v1/public/noc', signal);
}

export function fetchPublicCoverage(region?: string, signal?: AbortSignal): Promise<PublicCoverageResponse> {
  const params = new URLSearchParams();
  if (region) params.set('region', region);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return getJSON<PublicCoverageResponse>(`/api/v1/public/coverage${suffix}`, signal);
}

export interface PublicLOSProfileParams {
  aLat?: number;
  aLng?: number;
  bLat?: number;
  bLng?: number;
  nodeA?: string;
  nodeB?: string;
  frequencyMhz?: number;
  antennaHeightAM?: number;
  antennaHeightBM?: number;
  signal?: AbortSignal;
}

export function fetchPublicLOSProfile(paramsIn: PublicLOSProfileParams): Promise<PublicLOSProfileResponse> {
  const params = new URLSearchParams();
  for (const key of ['aLat', 'aLng', 'bLat', 'bLng', 'frequencyMhz', 'antennaHeightAM', 'antennaHeightBM'] as const) {
    const value = paramsIn[key];
    if (value !== undefined) params.set(key, String(value));
  }
  if (paramsIn.nodeA) params.set('nodeA', paramsIn.nodeA);
  if (paramsIn.nodeB) params.set('nodeB', paramsIn.nodeB);
  return getJSON<PublicLOSProfileResponse>(`/api/v1/public/los/profile?${params.toString()}`, paramsIn.signal);
}

export function fetchPublicSensorSummary(signal?: AbortSignal): Promise<PublicSensorSummaryResponse> {
  return getJSON<PublicSensorSummaryResponse>('/api/v1/public/integrations/home-assistant', signal);
}

export interface PublicPacketsParams extends PublicHistoryParams {
  iata?: string;
  region?: string;
  payload?: string;
  minHops?: number;
  messageOnly?: boolean;
  q?: string;
}

export function fetchPublicPackets({
  from,
  to,
  limit,
  cursor,
  iata,
  region,
  payload,
  minHops,
  messageOnly,
  q,
  signal
}: PublicPacketsParams): Promise<PublicPacketsResponse> {
  const params = new URLSearchParams({
    from: Math.round(from).toString(),
    to: Math.round(to).toString()
  });
  if (limit !== undefined) params.set('limit', Math.round(limit).toString());
  if (cursor) params.set('cursor', cursor);
  if (region || iata) params.set('region', region ?? iata ?? '');
  if (payload) params.set('payload', payload);
  if (minHops !== undefined && minHops > 0) params.set('minHops', Math.round(minHops).toString());
  if (messageOnly) params.set('messageOnly', 'true');
  if (q) params.set('q', q);
  return getJSON<PublicPacketsResponse>(`/api/v1/public/packets?${params.toString()}`, signal).then(sanitizePublicPacketsResponse);
}

export interface PublicPropagationParams extends PublicHistoryParams {
  iata?: string;
  region?: string;
}

export function fetchPublicPropagation({
  from,
  to,
  limit,
  cursor,
  iata,
  region,
  signal
}: PublicPropagationParams): Promise<PublicPropagationResponse> {
  const params = new URLSearchParams({
    from: Math.round(from).toString(),
    to: Math.round(to).toString()
  });
  if (limit !== undefined) params.set('limit', Math.round(limit).toString());
  if (cursor) params.set('cursor', cursor);
  if (region || iata) params.set('region', region ?? iata ?? '');
  return getJSON<PublicPropagationResponse>(`/api/v1/public/propagation?${params.toString()}`, signal).then(sanitizePublicPropagationResponse);
}

export interface PublicChatParams extends PublicHistoryParams {
  iata?: string;
  region?: string;
  channel?: string;
  q?: string;
}

export function fetchPublicChat({
  from,
  to,
  limit,
  cursor,
  iata,
  region,
  channel,
  q,
  signal
}: PublicChatParams): Promise<PublicChatResponse> {
  const params = new URLSearchParams({
    from: Math.round(from).toString(),
    to: Math.round(to).toString()
  });
  if (limit !== undefined) params.set('limit', Math.round(limit).toString());
  if (cursor) params.set('cursor', cursor);
  if (region) {
    params.set('region', region);
    params.set('iata', region);
  }
  if (iata) params.set('iata', iata);
  if (channel) params.set('channel', channel);
  if (q) params.set('q', q);
  return getJSON<PublicChatResponse>(`/api/v1/public/chat?${params.toString()}`, signal).then(sanitizePublicChatResponse);
}

export interface PublicHistorySummaryParams {
  from: number;
  to: number;
  bucketMs?: number;
  signal?: AbortSignal;
}

export function fetchPublicHistorySummary({ from, to, bucketMs, signal }: PublicHistorySummaryParams): Promise<PublicHistorySummaryResponse> {
  const params = new URLSearchParams({
    from: Math.round(from).toString(),
    to: Math.round(to).toString()
  });
  if (bucketMs !== undefined) params.set('bucketMs', Math.round(bucketMs).toString());
  return getJSON<PublicHistorySummaryResponse>(`/api/v1/public/history/summary?${params.toString()}`, signal);
}

export function fetchSolarConditions(signal?: AbortSignal): Promise<SolarConditions> {
  return getJSON<SolarConditions>('/api/v1/public/solar', signal);
}

interface SanitizedPacketsShape {
  packets: unknown[];
  window: NonNullable<PublicPacketsResponse['window']>;
  scan?: {
    eventsScanned?: unknown;
    scanLimit?: unknown;
    filtered?: unknown;
    partial?: unknown;
  };
  serverTime?: unknown;
  nextCursor?: unknown;
}

interface SanitizedPropagationShape {
  events: unknown[];
  conditions?: unknown;
  window: NonNullable<PublicPropagationResponse['window']>;
  serverTime?: unknown;
  nextCursor?: unknown;
}

interface SanitizedChatShape {
  messages: unknown[];
  window: NonNullable<PublicChatResponse['window']>;
  serverTime?: unknown;
  nextCursor?: unknown;
}

interface SanitizedPublicStateShape {
  serverTime?: unknown;
  map?: unknown;
  nodes?: unknown[];
  routes?: unknown[];
  recentPulses?: unknown[];
  recentActivity?: unknown[];
  stats?: unknown;
}

function sanitizePublicState(response: PublicLiveState | unknown): PublicLiveState {
  const safeResponse = (response ?? {}) as SanitizedPublicStateShape;
  const nodes = Array.isArray(safeResponse.nodes)
    ? safeResponse.nodes.map(sanitizePublicStateNode).filter((node): node is PublicNode => Boolean(node))
    : [];
  const routes = Array.isArray(safeResponse.routes)
    ? safeResponse.routes.map(sanitizePublicStateRoute).filter((route): route is PublicRoute => Boolean(route))
    : [];
  const recentPulses = Array.isArray(safeResponse.recentPulses)
    ? safeResponse.recentPulses.map(sanitizePublicStatePulse).filter((pulse): pulse is PublicRoutePulse => Boolean(pulse))
    : [];
  const recentActivity = Array.isArray(safeResponse.recentActivity)
    ? safeResponse.recentActivity.map(sanitizePublicStateActivity).filter((activity): activity is PublicActivity => Boolean(activity))
    : [];
  return {
    serverTime: sanitizeNumber(safeResponse.serverTime, Date.now()),
    map: sanitizePublicMapConfig(safeResponse.map),
    nodes,
    routes,
    recentPulses,
    recentActivity,
    stats: sanitizePublicStats(safeResponse.stats)
  };
}

function sanitizePublicEventsResponse(response: PublicEventsResponse | unknown): PublicEventsResponse {
  const safe = (response ?? {}) as { serverTime?: unknown; oldestSeq?: unknown; latestSeq?: unknown; resetRequired?: unknown; events?: unknown[]; nextCursor?: unknown };
  const events = Array.isArray(safe.events)
    ? safe.events.map(sanitizePublicEvent).filter((event): event is PublicEventsResponse['events'][number] => Boolean(event))
    : [];
  return {
    serverTime: sanitizeNumber(safe.serverTime, Date.now()),
    oldestSeq: sanitizeNumber(safe.oldestSeq, events[0]?.seq ?? 0),
    latestSeq: sanitizeNumber(safe.latestSeq, events.reduce((latest, event) => Math.max(latest, event.seq), 0)),
    resetRequired: safe.resetRequired === true,
    events,
    nextCursor: sanitizeStringOrUndefined(safe.nextCursor)
  };
}

function sanitizePublicEvent(event: unknown): PublicEventsResponse['events'][number] | null {
  if (!event || typeof event !== 'object') return null;
  const item = event as Record<string, unknown>;
  const seq = sanitizeNumber(item.seq, 0);
  const type = sanitizeString(item.type, '');
  if (seq <= 0 || !type) return null;
  const base = {
    seq,
    type,
    at: sanitizeNumber(item.at, Date.now()),
    receivedAt: sanitizeOptionalNumber(item.receivedAt),
    iata: sanitizeStringOrUndefined(item.iata),
    region: sanitizeStringOrUndefined(item.region),
    payloadTypeName: sanitizeStringOrUndefined(item.payloadTypeName),
    message: item.message === true,
    routeIds: safeStringList(item.routeIds),
    nodeIds: safeStringList(item.nodeIds)
  };
  if (type === 'activity') {
    const data = sanitizePublicStateActivity(item.data);
    return data ? { ...base, type, data } : null;
  }
  if (type === 'routePulse') {
    const data = sanitizePublicStatePulse(item.data);
    return data ? { ...base, type, data } : null;
  }
  if (type === 'nodeUpdate') {
    const data = sanitizePublicStateNode(item.data);
    return data ? { ...base, type, data } : null;
  }
  return { ...base, data: item.data };
}

function sanitizePublicViewportResponse(response: PublicViewportResponse | unknown): PublicViewportResponse {
  const safe = (response ?? {}) as { serverTime?: unknown; latestSeq?: unknown; nodes?: unknown[]; routes?: unknown[]; clusters?: unknown[]; events?: unknown[]; bbox?: unknown; zoom?: unknown; includes?: unknown };
  const nodes = Array.isArray(safe.nodes)
    ? safe.nodes.map(sanitizePublicStateNode).filter((node): node is PublicNode => Boolean(node))
    : [];
  const routes = Array.isArray(safe.routes)
    ? safe.routes.map(sanitizePublicStateRoute).filter((route): route is PublicRoute => Boolean(route))
    : [];
  const events = Array.isArray(safe.events)
    ? safe.events.map(sanitizePublicEvent).filter((event): event is PublicEventsResponse['events'][number] => Boolean(event))
    : [];
  const clusters = Array.isArray(safe.clusters)
    ? safe.clusters.map(sanitizePublicMapCluster).filter((cluster): cluster is PublicMapCluster => Boolean(cluster))
    : [];
  return {
    serverTime: sanitizeNumber(safe.serverTime, Date.now()),
    latestSeq: sanitizeOptionalNumber(safe.latestSeq),
    nodes,
    routes,
    clusters,
    events,
    bbox: Array.isArray(safe.bbox) ? safe.bbox.map((item) => sanitizeNumber(item, 0)).slice(0, 4) : undefined,
    zoom: sanitizeOptionalNumber(safe.zoom),
    includes: safeStringList(safe.includes)
  };
}

function sanitizePublicBootstrapResponse(response: PublicBootstrapResponse | unknown): PublicBootstrapResponse {
  const safe = (response ?? {}) as Record<string, unknown>;
  const clusters = Array.isArray(safe.clusters)
    ? safe.clusters.map(sanitizePublicMapCluster).filter((cluster): cluster is PublicMapCluster => Boolean(cluster))
    : [];
  const recentActivity = Array.isArray(safe.recentActivity)
    ? safe.recentActivity.map(sanitizePublicStateActivity).filter((activity): activity is PublicActivity => Boolean(activity))
    : [];
  return {
    serverTime: sanitizeNumber(safe.serverTime, Date.now()),
    map: sanitizePublicMapConfig(safe.map),
    stats: sanitizePublicStats(safe.stats),
    latestSeq: sanitizeNumber(safe.latestSeq, 0),
    health: safe.health && typeof safe.health === 'object' ? safe.health as RuntimeHealth : {},
    clusters,
    recentActivity
  };
}

function sanitizePublicMapCluster(value: unknown): PublicMapCluster | null {
  if (!value || typeof value !== 'object') return null;
  const safe = value as Record<string, unknown>;
  const id = sanitizeString(safe.id);
  const latitude = sanitizeOptionalNumber(safe.latitude ?? safe.lat);
  const longitude = sanitizeOptionalNumber(safe.longitude ?? safe.lng);
  const count = sanitizeNumber(safe.count, 0);
  if (!id || latitude === undefined || longitude === undefined || count <= 0) return null;
  return {
    id,
    latitude,
    longitude,
    count,
    activityCount: sanitizeOptionalNumber(safe.activityCount),
    lastSeen: sanitizeOptionalNumber(safe.lastSeen),
    region: sanitizeStringOrUndefined(safe.region)
  };
}

function sanitizePublicStateNode(node: unknown): PublicNode | null {
  if (!node || typeof node !== 'object') return null;
  const item = node as Record<string, unknown>;
  const id = sanitizeString(item.id);
  if (!id) return null;
  return {
    id,
    label: sanitizeString(item.label, id),
    role: normalizeNodeRole(item.role),
    isObserver: item.isObserver === true,
    latitude: sanitizeNumber(item.latitude),
    longitude: sanitizeNumber(item.longitude),
    lastSeen: sanitizeNumber(item.lastSeen, Date.now()),
    firstSeen: sanitizeNumber(item.firstSeen, 0),
    iatasHeardIn: safeStringList(item.iatasHeardIn),
    regionsHeardIn: safeStringList(item.regionsHeardIn),
    activityCount: sanitizeNumber(item.activityCount, 0)
  };
}

function sanitizePublicStateRoute(route: unknown): PublicRoute | null {
  if (!route || typeof route !== 'object') return null;
  const item = route as Record<string, unknown>;
  const id = sanitizeString(item.id);
  const from = sanitizePublicRouteEndpoint(item.from);
  const to = sanitizePublicRouteEndpoint(item.to);
  if (!id || !from || !to) return null;
  return {
    id,
    from,
    to,
    distanceKm: sanitizeNumber(item.distanceKm, 0),
    packetCount: sanitizeNumber(item.packetCount, 0),
    lastHeard: sanitizeNumber(item.lastHeard, 0),
    frequencyBucket: sanitizeNumber(item.frequencyBucket, 0),
    payloadTypeNames: safeStringList(item.payloadTypeNames)
  };
}

function sanitizePublicStatePulse(pulse: unknown): PublicRoutePulse | null {
  if (!pulse || typeof pulse !== 'object') return null;
  const item = pulse as Record<string, unknown>;
  const id = sanitizeString(item.id);
  if (!id) return null;
  const heardAt = sanitizeNumber(item.heardAt, Date.now());
  return {
    id,
    iata: sanitizeStringOrUndefined(item.iata),
    region: sanitizeStringOrUndefined(item.region),
    payloadTypeName: sanitizeString(item.payloadTypeName, 'Message'),
    messageSender: sanitizeStringOrUndefined(item.messageSender),
    messageText: sanitizeStringOrUndefined(item.messageText),
    messageAnchor: sanitizePublicMessageAnchor(item.messageAnchor),
    heardAt,
    receivedAt: sanitizeNumber(item.receivedAt, heardAt),
    displayAt: sanitizeNumber(item.displayAt, heardAt),
    seq: sanitizeNumber(item.seq, 0),
    segments: Array.isArray(item.segments)
      ? item.segments.map(sanitizePublicStateSegment).filter((segment): segment is PublicRouteSegment => Boolean(segment))
      : [],
    replayOptions: sanitizeRouteReplayOptions(item.replayOptions)
  };
}

function sanitizePublicStateActivity(activity: unknown): PublicActivity | null {
  if (!activity || typeof activity !== 'object') return null;
  const item = activity as Record<string, unknown>;
  const id = sanitizeString(item.id);
  if (!id) return null;
  const heardAt = sanitizeNumber(item.heardAt, Date.now());
  return {
    id,
    kind: sanitizeActivityKind(item.kind),
    payloadTypeName: sanitizeString(item.payloadTypeName, 'Message'),
    routeTypeName: sanitizeStringOrUndefined(item.routeTypeName),
    iata: sanitizeStringOrUndefined(item.iata),
    region: sanitizeStringOrUndefined(item.region),
    heardAt,
    receivedAt: sanitizeNumber(item.receivedAt, heardAt),
    displayAt: sanitizeNumber(item.displayAt, heardAt),
    seq: sanitizeNumber(item.seq, 0),
    hopCount: sanitizeNumber(item.hopCount, 0),
    hasRoute: item.hasRoute === true,
    animationState: sanitizeAnimationState(item.animationState),
    resolutionBucket: sanitizeResolutionBucket(item.resolutionBucket),
    observerLocation: sanitizePublicObserverLocation(item.observerLocation),
    routeIds: safeStringList(item.routeIds),
    endpointLabels: safeStringList(item.endpointLabels),
    messageSender: sanitizeStringOrUndefined(item.messageSender),
    messageText: sanitizeStringOrUndefined(item.messageText),
    messageAnchor: sanitizePublicMessageAnchor(item.messageAnchor)
  };
}

function sanitizePublicStateSegment(segment: unknown): PublicRouteSegment | null {
  if (!segment || typeof segment !== 'object') return null;
  const item = segment as Record<string, unknown>;
  const routeId = sanitizeString(item.routeId);
  const from = sanitizePublicRouteEndpoint(item.from);
  const to = sanitizePublicRouteEndpoint(item.to);
  if (!routeId || !from || !to) return null;
  return {
    routeId,
    from,
    to,
    distanceKm: sanitizeNumber(item.distanceKm, 0)
  };
}

function sanitizePublicRouteEndpoint(value: unknown): PublicRouteEndpoint | null {
  if (!value || typeof value !== 'object') return null;
  const endpoint = value as Record<string, unknown>;
  const nodeId = sanitizeString(endpoint.nodeId);
  if (!nodeId) return null;
  const lat = sanitizeNumber(endpoint.lat);
  const lng = sanitizeNumber(endpoint.lng);
  return {
    nodeId,
    label: sanitizeString(endpoint.label, nodeId),
    lat,
    lng,
    pathHash3: sanitizeStringOrUndefined(endpoint.pathHash3)
  };
}

function sanitizePublicMessageAnchor(anchor: unknown): PublicMessageAnchor | undefined {
  if (!anchor || typeof anchor !== 'object') return undefined;
  const safe = anchor as Record<string, unknown>;
  const label = sanitizeString(safe.label, '');
  if (!label) return undefined;
  return {
    kind: sanitizeString(safe.kind, ''),
    nodeId: sanitizeStringOrUndefined(safe.nodeId),
    label,
    lat: sanitizeNumber(safe.lat, 0),
    lng: sanitizeNumber(safe.lng, 0)
  };
}

function sanitizePublicObserverLocation(location: unknown): PublicObserverLocation | undefined {
  if (!location || typeof location !== 'object') return undefined;
  const item = location as Record<string, unknown>;
  const label = sanitizeString(item.label, '');
  if (!label) return undefined;
  return {
    label,
    iata: sanitizeStringOrUndefined(item.iata),
    region: sanitizeStringOrUndefined(item.region),
    lat: sanitizeNumber(item.lat, 0),
    lng: sanitizeNumber(item.lng, 0)
  };
}

function sanitizePublicMapConfig(value: unknown): NonNullable<PublicLiveState['map']> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const map = value as Record<string, unknown>;
  return {
    regionPreset: sanitizeStringOrUndefined(map.regionPreset),
    defaultRegion: sanitizeStringOrUndefined(map.defaultRegion),
    defaultCenter: sanitizeNumericTuple(map.defaultCenter),
    defaultZoom: sanitizeOptionalNumber(map.defaultZoom),
    bounds: sanitizePublicBounds(map.bounds)
  };
}

function sanitizePublicStats(raw: unknown): PublicStats {
  if (!raw || typeof raw !== 'object') return defaultPublicStats();
  const stats = raw as Record<string, unknown>;
  const resolutionBuckets = sanitizeNestedNumberMap(stats.resolutionBuckets);
  const excludedIatas = sanitizeStringNumberMap(stats.excludedIatas);
  const excludedRegions = sanitizeStringNumberMap(stats.excludedRegions);
  return {
    packets: sanitizeNumber(stats.packets, 0),
    activeNodes: sanitizeNumber(stats.activeNodes, 0),
    activeRoutes: sanitizeNumber(stats.activeRoutes, 0),
    mqttConnected: stats.mqttConnected === true,
    mqttMessages: sanitizeNumber(stats.mqttMessages, 0),
    wsClients: sanitizeNumber(stats.wsClients, 0),
    serverTime: sanitizeNumber(stats.serverTime, Date.now()),
    latestSeq: sanitizeOptionalNumber(stats.latestSeq),
    ...(resolutionBuckets ? { resolutionBuckets } : {}),
    ...(excludedIatas ? { excludedIatas } : {}),
    ...(excludedRegions ? { excludedRegions } : {})
  };
}

function sanitizePublicPacketsResponse(response: PublicPacketsResponse | unknown): PublicPacketsResponse {
  const safeResponse = (response ?? {}) as SanitizedPacketsShape;
  const packets = Array.isArray(safeResponse.packets)
    ? safeResponse.packets.map(sanitizePublicPacket).filter((packet): packet is PublicPacketPath => Boolean(packet))
    : [];
  return {
    window: sanitizePacketsWindow(safeResponse.window),
    serverTime: sanitizeNumber(safeResponse.serverTime, Date.now()),
    nextCursor: sanitizeStringOrUndefined(safeResponse.nextCursor),
    packets,
    scan: safeResponse.scan
      ? {
          eventsScanned: sanitizeNumber(safeResponse.scan.eventsScanned, 0),
          scanLimit: sanitizeNumber(safeResponse.scan.scanLimit, 0),
          filtered: safeResponse.scan.filtered === true,
          partial: safeResponse.scan.partial === true
        }
      : undefined
  };
}

function sanitizePublicPropagationResponse(response: PublicPropagationResponse | unknown): PublicPropagationResponse {
  const safeResponse = (response ?? {}) as SanitizedPropagationShape;
  const events = Array.isArray(safeResponse.events)
    ? safeResponse.events.map(sanitizePublicPropagationEvent).filter((event): event is PublicPropagationEvent => Boolean(event))
    : [];
  return {
    serverTime: sanitizeNumber(safeResponse.serverTime, Date.now()),
    conditions: sanitizePublicPropagationConditions(safeResponse.conditions, events),
    events,
    nextCursor: sanitizeStringOrUndefined(safeResponse.nextCursor),
    window: sanitizeHistoryWindow(safeResponse.window)
  };
}

function sanitizePublicChatResponse(response: PublicChatResponse | unknown): PublicChatResponse {
  const safeResponse = (response ?? {}) as SanitizedChatShape;
  const messages = Array.isArray(safeResponse.messages)
    ? safeResponse.messages.map(sanitizePublicChatMessage).filter((message): message is PublicChatMessage => Boolean(message))
    : [];
  return {
    serverTime: sanitizeNumber(safeResponse.serverTime, Date.now()),
    messages,
    nextCursor: sanitizeStringOrUndefined(safeResponse.nextCursor),
    window: sanitizeChatWindow(safeResponse.window)
  };
}

function sanitizePublicPropagationConditions(value: unknown, events: PublicPropagationEvent[]): PublicPropagationConditions {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const latestEvent = sanitizePublicPropagationEvent(item.latestEvent) ?? events[0];
  return {
    serverTime: sanitizeNumber(item.serverTime, Date.now()),
    eventCount: sanitizeNumber(item.eventCount, events.length),
    latestEvent,
    weather: sanitizePublicPropagationWeather(item.weather),
    solar: sanitizePublicPropagationSolar(item.solar),
    sourceStatus: sanitizeString(item.sourceStatus, events.length > 0 ? 'active' : 'quiet')
  };
}

function sanitizePublicPropagationEvent(event: unknown): PublicPropagationEvent | null {
  if (!event || typeof event !== 'object') return null;
  const item = event as Record<string, unknown>;
  const id = sanitizeString(item.id);
  if (!id) return null;
  const segments = Array.isArray(item.segments)
    ? item.segments.map(sanitizePublicStateSegment).filter((segment): segment is PublicRouteSegment => Boolean(segment))
    : [];
  return {
    id,
    at: sanitizeNumber(item.at, 0),
    classification: sanitizeString(item.classification, 'long_distance_event'),
    confidence: sanitizeString(item.confidence, 'low'),
    score: sanitizeNumber(item.score, 0),
    distanceKm: sanitizeNumber(item.distanceKm, 0),
    region: sanitizeStringOrUndefined(item.region),
    routeIds: safeStringList(item.routeIds),
    endpointLabels: safeStringList(item.endpointLabels),
    segments,
    reasons: safeStringList(item.reasons).slice(0, 8),
    weather: sanitizePublicPropagationWeather(item.weather),
    solar: sanitizePublicPropagationSolar(item.solar),
    replayWindow: sanitizePropagationReplayWindow(item.replayWindow, sanitizeNumber(item.at, 0))
  };
}

function sanitizePublicPropagationWeather(value: unknown): PublicPropagationWeatherSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const source = sanitizeString(item.source, '');
  if (!source) return undefined;
  return {
    source,
    model: sanitizeStringOrUndefined(item.model),
    sampleTime: sanitizeNumber(item.sampleTime, 0),
    fetchedAt: sanitizeNumber(item.fetchedAt, 0),
    temperatureC: sanitizeNumber(item.temperatureC, 0),
    dewPointC: sanitizeNumber(item.dewPointC, 0),
    relativeHumidityPct: sanitizeNumber(item.relativeHumidityPct, 0),
    pressureHPa: sanitizeNumber(item.pressureHPa, 0),
    cloudCoverPct: sanitizeNumber(item.cloudCoverPct, 0),
    visibilityM: sanitizeOptionalNumber(item.visibilityM),
    windSpeedKmh: sanitizeNumber(item.windSpeedKmh, 0),
    inversionProxy: sanitizeString(item.inversionProxy, 'unknown')
  };
}

function sanitizePublicPropagationSolar(value: unknown): PublicPropagationSolarSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  return {
    kpIndex: sanitizeNumber(item.kpIndex, 0),
    kpLabel: sanitizeString(item.kpLabel, 'quiet'),
    solarFluxSfu: sanitizeNumber(item.solarFluxSfu, 0),
    solarFluxLabel: sanitizeString(item.solarFluxLabel, 'unknown'),
    geomagActivity: sanitizeString(item.geomagActivity, 'unknown'),
    fetchedAt: sanitizeNumber(item.fetchedAt, 0)
  };
}

function sanitizePropagationReplayWindow(value: unknown, at: number): PublicPropagationEvent['replayWindow'] {
  if (!value || typeof value !== 'object') return { from: Math.max(0, at - 15 * 60_000), to: at + 15 * 60_000 };
  const item = value as Record<string, unknown>;
  return {
    from: sanitizeNumber(item.from, Math.max(0, at - 15 * 60_000)),
    to: sanitizeNumber(item.to, at + 15 * 60_000)
  };
}

function sanitizePublicPacket(packet: unknown): PublicPacketPath | null {
  if (!packet || typeof packet !== 'object') return null;
  const item = packet as Record<string, unknown>;
  const segments = Array.isArray(item.segments)
    ? item.segments.map(sanitizePublicPacketSegment).filter((segment): segment is PublicRouteSegment => Boolean(segment))
    : [];
  const segmentCount = sanitizeNumber(item.segmentCount, segments.length);
  const id = sanitizeString(item.id);
  if (!id) return null;
  return {
    id,
    at: sanitizeNumber(item.at, 0),
    iata: sanitizeStringOrUndefined(item.iata),
    region: sanitizeStringOrUndefined(item.region),
    payloadTypeName: sanitizeString(item.payloadTypeName, 'Message'),
    messageSender: sanitizeStringOrUndefined(item.messageSender),
    messageText: sanitizeStringOrUndefined(item.messageText),
    hopCount: sanitizeNumber(item.hopCount, 0),
    segmentCount: sanitizeNumber(item.segmentCount, segmentCount),
    distanceKm: sanitizeNumber(item.distanceKm, 0),
    routeIds: safeStringList(item.routeIds),
    endpointLabels: safeStringList(item.endpointLabels),
    segments
  };
}

function sanitizePublicPacketSegment(segment: unknown): PublicRouteSegment | null {
  if (!segment || typeof segment !== 'object') return null;
  const item = segment as Record<string, unknown>;
  const routeId = sanitizeString(item.routeId);
  const from = sanitizePublicPacketEndpoint(item.from);
  const to = sanitizePublicPacketEndpoint(item.to);
  if (!routeId || !from || !to) return null;
  return {
    routeId,
    from,
    to,
    distanceKm: sanitizeNumber(item.distanceKm, 0)
  };
}

function sanitizePublicPacketEndpoint(endpoint: unknown): PublicRouteEndpoint | null {
  if (!endpoint || typeof endpoint !== 'object') return null;
  const item = endpoint as Record<string, unknown>;
  const nodeId = sanitizeString(item.nodeId);
  if (!nodeId) return null;
  return {
    nodeId,
    label: sanitizeString(item.label, nodeId),
    lat: sanitizeNumber(item.lat, 0),
    lng: sanitizeNumber(item.lng, 0),
    pathHash3: sanitizeStringOrUndefined(item.pathHash3)
  };
}

function sanitizeHistoryWindow(windowData: unknown): NonNullable<PublicHistoryResponse['window']> {
  if (!windowData || typeof windowData !== 'object') return { from: 0, to: 0, count: 0 };
  const normalized = windowData as Record<string, unknown>;
  return {
    from: sanitizeNumber(normalized.from, 0),
    to: sanitizeNumber(normalized.to, 0),
    count: sanitizeNumber(normalized.count, 0)
  };
}

function sanitizePacketsWindow(windowData: unknown): NonNullable<PublicPacketsResponse['window']> {
  return sanitizeHistoryWindow(windowData);
}

function sanitizePublicChatMessage(message: unknown): PublicChatMessage | null {
  if (!message || typeof message !== 'object') return null;
  const safe = message as Record<string, unknown>;
  const messageText = sanitizeString(safe.text, '');
  if (!messageText) return null;
  const rawId = sanitizeString(safe.id, '');
  const at = sanitizeNumber(safe.at, 0);
  if (!rawId) return null;
  return {
    id: rawId,
    at,
    region: sanitizeStringOrUndefined(safe.region),
    iata: sanitizeStringOrUndefined(safe.iata),
    sender: sanitizeString(safe.sender, 'Unknown'),
    text: messageText,
    channelLabel: sanitizeString(safe.channelLabel, 'Public'),
    payloadTypeName: sanitizeString(safe.payloadTypeName, 'Message'),
    source: sanitizeStringOrUndefined(safe.source),
    anchor: sanitizePublicMessageAnchor(safe.anchor),
    routeIds: safeStringList(safe.routeIds),
    endpointLabels: safeStringList(safe.endpointLabels)
  };
}

function sanitizeChatWindow(windowData: unknown): NonNullable<PublicChatResponse['window']> {
  return sanitizeHistoryWindow(windowData);
}

function sanitizeNumericTuple(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const lat = sanitizeNumber(value[0], 0);
  const lng = sanitizeNumber(value[1], 0);
  return [lat, lng];
}

function sanitizePublicBounds(value: unknown): { minLat: number; maxLat: number; minLng: number; maxLng: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const bounds = value as Record<string, unknown>;
  return {
    minLat: sanitizeNumber(bounds.minLat, 0),
    maxLat: sanitizeNumber(bounds.maxLat, 0),
    minLng: sanitizeNumber(bounds.minLng, 0),
    maxLng: sanitizeNumber(bounds.maxLng, 0)
  };
}

function sanitizeRouteReplayOptions(value: unknown): {
  force?: boolean;
  travelDurationMs?: number;
  brightness?: number;
  trailScale?: number;
  animationStyle?: 'comet' | 'pulse' | 'minimal';
} | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const next = value as Record<string, unknown>;
  const style = sanitizeString(next.animationStyle);
  return {
    force: next.force === true || next.force === false ? next.force : undefined,
    travelDurationMs: sanitizeOptionalNumber(next.travelDurationMs),
    brightness: sanitizeOptionalNumber(next.brightness),
    trailScale: sanitizeOptionalNumber(next.trailScale),
    animationStyle: style === 'comet' || style === 'pulse' || style === 'minimal' ? style : undefined
  };
}

function safeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      output.push(item);
      continue;
    }
    if (typeof item === 'number' && Number.isFinite(item)) output.push(String(item));
    if (typeof item === 'boolean') output.push(item ? 'true' : 'false');
  }
  return output;
}

function sanitizeString(value: unknown, fallback = ''): string {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function sanitizeStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function sanitizeNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sanitizeOptionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function safeStringNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function sanitizeRouteType(value: unknown): PublicRoute[] {
  return Array.isArray(value) ? value.filter(Boolean) as PublicRoute[] : [];
}

function sanitizeNestedNumberMap(value: unknown): Record<string, Record<string, number>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const next = value as Record<string, unknown>;
  const out: Record<string, Record<string, number>> = {};
  for (const [bucket, rawBucket] of Object.entries(next)) {
    const cleanBucket = sanitizeStringNumberMap(rawBucket);
    if (!cleanBucket || Object.keys(cleanBucket).length === 0) continue;
    out[bucket] = cleanBucket;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeStringNumberMap(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(raw)) {
    const safeCount = safeStringNumber(count);
    if (safeCount === undefined) continue;
    out[key] = safeCount;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeActivityKind(value: unknown): 'packet' | 'route' | string {
  const safe = sanitizeString(value);
  return safe === 'packet' || safe === 'route' ? safe : 'packet';
}

function sanitizeAnimationState(value: unknown): PublicActivity['animationState'] {
  const safe = sanitizeString(value);
  if (safe === 'route' || safe === 'observer' || safe === 'unmapped') {
    return safe;
  }
  return 'unmapped';
}

function sanitizeResolutionBucket(value: unknown): PublicResolutionBucket {
  const safe = sanitizeString(value);
  switch (safe) {
    case 'routed':
    case 'observer_only':
    case 'unresolved_path':
    case 'missing_location':
    case 'rf_gated':
    case 'distance_gated':
    case 'not_map_safe':
      return safe;
    default:
      return 'not_map_safe';
  }
}

function normalizeNodeRole(role: unknown): 'companion' | 'repeater' | 'room_server' | 'sensor' | 'unknown' {
  const next = sanitizeString(role).toLowerCase();
  if (next === 'companion' || next === 'repeater' || next === 'room_server' || next === 'sensor') {
    return next;
  }
  return 'unknown';
}

function defaultPublicStats(): PublicStats {
  return {
    packets: 0,
    activeNodes: 0,
    activeRoutes: 0,
    mqttConnected: false,
    mqttMessages: 0,
    wsClients: 0,
    serverTime: 0
  };
}

function cachePublicStateSnapshot(state: PublicLiveState): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const now = Date.now();
  if (pendingPublicStateCacheWrite || now - lastPublicStateCacheWriteAt < PUBLIC_STATE_CACHE_WRITE_INTERVAL_MS) return;
  pendingPublicStateCacheWrite = true;
  const write = () => {
    pendingPublicStateCacheWrite = false;
    try {
      window.localStorage.setItem(PUBLIC_STATE_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), state }));
      lastPublicStateCacheWriteAt = Date.now();
    } catch {
      // Offline snapshot caching is opportunistic.
    }
  };
  const idleCallback = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (idleCallback) {
    idleCallback(write, { timeout: 2_000 });
  } else {
    window.setTimeout(write, 0);
  }
}

export function readCachedPublicStateSnapshot(now = Date.now()): PublicStateFetchResult | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(PUBLIC_STATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cachedAt?: unknown; state?: unknown };
    const cachedAt = sanitizeNumber(parsed.cachedAt, 0);
    if (cachedAt <= 0 || now - cachedAt < 0 || now - cachedAt > PUBLIC_STATE_CACHE_MAX_AGE_MS) return null;
    return { state: sanitizePublicState(parsed.state), source: 'offline-cache', cachedAt };
  } catch {
    return null;
  }
}
