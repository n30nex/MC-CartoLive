export type NodeRole = 'companion' | 'repeater' | 'room_server' | 'sensor' | 'unknown';

export interface PublicNode {
  id: string;
  label: string;
  role: NodeRole;
  isObserver?: boolean;
  latitude: number;
  longitude: number;
  lastSeen: number;
  firstSeen: number;
  iatasHeardIn: string[];
  regionsHeardIn?: string[];
  activityCount: number;
}

export interface PublicRouteEndpoint {
  nodeId: string;
  label: string;
  lat: number;
  lng: number;
  pathHash3?: string;
}

export interface PublicRouteSegment {
  routeId: string;
  from: PublicRouteEndpoint;
  to: PublicRouteEndpoint;
  distanceKm: number;
}

export interface PublicRoute {
  id: string;
  from: PublicRouteEndpoint;
  to: PublicRouteEndpoint;
  distanceKm: number;
  packetCount: number;
  lastHeard: number;
  frequencyBucket: number;
  payloadTypeNames: string[];
}

export type PublicAnimationState = 'route' | 'observer' | 'unmapped';
export type PublicResolutionBucket =
  | 'routed'
  | 'observer_only'
  | 'unresolved_path'
  | 'missing_location'
  | 'rf_gated'
  | 'distance_gated'
  | 'not_map_safe';

export interface PublicObserverLocation {
  label: string;
  iata?: string;
  region?: string;
  lat: number;
  lng: number;
}

export interface PublicMessageAnchor {
  kind: 'source' | 'observer' | string;
  nodeId?: string;
  label: string;
  lat: number;
  lng: number;
}

export interface PublicActivity {
  id: string;
  kind: 'packet' | 'route' | string;
  payloadTypeName: string;
  routeTypeName?: string;
  iata?: string;
  region?: string;
  heardAt: number;
  receivedAt?: number;
  displayAt?: number;
  seq?: number;
  hopCount: number;
  hasRoute: boolean;
  animationState: PublicAnimationState;
  resolutionBucket: PublicResolutionBucket;
  observerLocation?: PublicObserverLocation;
  routeIds?: string[];
  endpointLabels?: string[];
  messageSender?: string;
  messageText?: string;
  messageAnchor?: PublicMessageAnchor;
}

export interface PublicObserverBurst {
  id: string;
  payloadTypeName: string;
  heardAt: number;
  receivedAt?: number;
  displayAt?: number;
  seq?: number;
  location: PublicObserverLocation;
  messageSender?: string;
  messageText?: string;
  messageAnchor?: PublicMessageAnchor;
}

export interface PublicRoutePulse {
  id: string;
  iata?: string;
  region?: string;
  payloadTypeName: string;
  messageSender?: string;
  messageText?: string;
  messageAnchor?: PublicMessageAnchor;
  heardAt: number;
  receivedAt?: number;
  displayAt?: number;
  seq?: number;
  segments: PublicRouteSegment[];
  replayOptions?: {
    force?: boolean;
    travelDurationMs?: number;
    brightness?: number;
    trailScale?: number;
    animationStyle?: 'comet' | 'pulse' | 'minimal';
  };
}

export interface PublicPacketPath {
  id: string;
  at: number;
  iata?: string;
  region?: string;
  payloadTypeName: string;
  messageSender?: string;
  messageText?: string;
  hopCount: number;
  segmentCount: number;
  distanceKm: number;
  routeIds: string[];
  endpointLabels: string[];
  segments: PublicRouteSegment[];
}

export interface PublicStats {
  packets: number;
  activeNodes: number;
  activeRoutes: number;
  mqttConnected: boolean;
  mqttMessages: number;
  wsClients: number;
  serverTime: number;
  resolutionBuckets?: Record<string, Record<string, number>>;
  excludedIatas?: Record<string, number>;
  excludedRegions?: Record<string, number>;
}

export interface PublicMapConfig {
  regionPreset?: string;
  defaultRegion?: string;
  defaultCenter?: [number, number];
  defaultZoom?: number;
  bounds?: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
}

export interface PublicLiveState {
  serverTime: number;
  map?: PublicMapConfig;
  stats: PublicStats;
  nodes: PublicNode[];
  routes: PublicRoute[];
  recentPulses?: PublicRoutePulse[];
  recentActivity: PublicActivity[];
}

export type PublicHistoryEvent =
  | { type: 'activity'; at: number; data: PublicActivity }
  | { type: 'routePulse'; at: number; data: PublicRoutePulse };

export interface PublicHistoryWindow {
  from: number;
  to: number;
  count: number;
}

export interface PublicHistoryResponse {
  serverTime: number;
  events: PublicHistoryEvent[];
  nextCursor?: string;
  window: PublicHistoryWindow;
}

export interface PublicPacketsResponse {
  serverTime: number;
  packets: PublicPacketPath[];
  nextCursor?: string;
  window: PublicHistoryWindow;
  scan?: PublicPacketScan;
}

export interface PublicChatMessage {
  id: string;
  at: number;
  region?: string;
  iata?: string;
  sender?: string;
  text: string;
  channelLabel?: string;
  payloadTypeName: string;
  source?: string;
  anchor?: PublicMessageAnchor;
  routeIds?: string[];
  endpointLabels?: string[];
}

export interface PublicChatResponse {
  serverTime: number;
  messages: PublicChatMessage[];
  nextCursor?: string;
  window: PublicHistoryWindow;
}

export interface PublicPacketScan {
  eventsScanned: number;
  scanLimit: number;
  filtered?: boolean;
  partial?: boolean;
}

export interface PublicHistorySummaryBucket {
  start: number;
  end: number;
  count: number;
}

export interface PublicHistorySummaryResponse {
  serverTime: number;
  from: number;
  to: number;
  bucketMs: number;
  buckets: PublicHistorySummaryBucket[];
}

export interface RuntimeHealth {
  ok?: boolean;
  ready?: boolean;
  version?: string;
  gitSha?: string;
  buildTime?: string;
  cached?: boolean;
  dbReady?: boolean;
  staticReady?: boolean;
  publicStateReady?: boolean;
  mqttConnected?: boolean;
  mqttMessages?: number;
  mqttDroppedMessages?: number;
  mqttMalformedTopics?: number;
  mqttReconnects?: number;
  mqttLastMessageAgeMs?: number;
  cacheAgeMs?: number;
  cacheRefreshFailures?: number;
  publicStateRequests?: number;
  publicStateErrors?: number;
  publicHistoryRequests?: number;
  publicHistoryErrors?: number;
  publicHistoryLatencyMs?: number;
  publicSummaryRequests?: number;
  publicSummaryErrors?: number;
  packetIngestState?: string;
  packetIngestFresh?: boolean;
  publicCacheState?: string;
  publicLiveFresh?: boolean;
  mapMotionState?: string;
  routeMotionState?: string;
  observerMotionState?: string;
  liveConfidenceState?: string;
  recentRoutePulseAgeMs?: number;
  recentObserverBurstAgeMs?: number;
  packets?: number;
  nodesWithPosition?: number;
  edgeEvents?: number;
  unresolved?: number;
  wsClients?: number;
  wsDroppedMessages?: number;
  wsQueueHighWater?: number;
  wsPingFailures?: number;
}

export type Health = RuntimeHealth;

export type PublicLiveEnvelope =
  | { v: 1; type: 'hello'; seq?: number; serverTime: number; receivedAt?: number; displayAt?: number; connectionId: string }
  | { v: 1; type: 'lagged'; seq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; droppedCount: number; since: number }
  | { v: 1; type: 'event'; event: 'nodeUpdate'; seq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; data: PublicNode }
  | { v: 1; type: 'event'; event: 'activity'; seq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; data: PublicActivity }
  | { v: 1; type: 'event'; event: 'routePulse'; seq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; data: PublicRoutePulse };

export interface SolarConditions {
  serverTime: number;
  kpIndex: number;
  kpLabel: string;
  solarFluxSfu: number;
  solarFluxLabel: string;
  geomagActivity: string;
  fetchedAt: number;
}
