export type NodeRole = 'companion' | 'repeater' | 'room_server' | 'sensor' | 'unknown';

export interface PublicNode {
  seq?: number;
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
  latestSeq?: number;
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

export type PublicEvent =
  | { seq: number; type: 'activity'; at: number; receivedAt?: number; iata?: string; region?: string; payloadTypeName?: string; message?: boolean; routeIds?: string[]; nodeIds?: string[]; data: PublicActivity }
  | { seq: number; type: 'routePulse'; at: number; receivedAt?: number; iata?: string; region?: string; payloadTypeName?: string; message?: boolean; routeIds?: string[]; nodeIds?: string[]; data: PublicRoutePulse }
  | { seq: number; type: 'nodeUpdate'; at: number; receivedAt?: number; iata?: string; region?: string; payloadTypeName?: string; message?: boolean; routeIds?: string[]; nodeIds?: string[]; data: PublicNode }
  | { seq: number; type: string; at: number; receivedAt?: number; iata?: string; region?: string; payloadTypeName?: string; message?: boolean; routeIds?: string[]; nodeIds?: string[]; data: unknown };

export interface PublicEventsResponse {
  serverTime: number;
  oldestSeq: number;
  latestSeq: number;
  resetRequired: boolean;
  events: PublicEvent[];
  nextCursor?: string;
}

export interface PublicMapCluster {
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  activityCount?: number;
  lastSeen?: number;
  region?: string;
}

export interface PublicBootstrapResponse {
  serverTime: number;
  map?: PublicMapConfig;
  stats: PublicStats;
  latestSeq: number;
  health: RuntimeHealth;
  clusters: PublicMapCluster[];
  recentActivity: PublicActivity[];
}

export interface PublicViewportResponse {
  serverTime: number;
  latestSeq?: number;
  nodes: PublicNode[];
  routes: PublicRoute[];
  clusters?: PublicMapCluster[];
  events?: PublicEvent[];
  bbox?: number[];
  zoom?: number;
  includes?: string[];
}

export interface PublicNOCObserver {
  id: string;
  label: string;
  region?: string;
  state: 'online' | 'stale' | 'offline' | string;
  lastSeen: number;
  lastSeenAgeMs: number;
  packetsTotal: number;
  activityCount: number;
}

export interface PublicNOCResponse {
  serverTime: number;
  latestSeq?: number;
  mqttConnected: boolean;
  publicCacheReady: boolean;
  publicCacheAgeMs: number;
  wsClients: number;
  wsDroppedMessages: number;
  packets: number;
  activeNodes: number;
  activeRoutes: number;
  observers: PublicNOCObserver[];
  observerStateCounts: Record<string, number>;
  resolutionBuckets?: Record<string, Record<string, number>>;
}

export interface PublicCoverageCell {
  id: string;
  source: string;
  region?: string;
  bbox: number[];
  intensity: number;
  sampleCount: number;
  ageBucket: string;
  updatedAt: number;
  attribution?: string;
  precisionBucket: string;
}

export interface PublicCoverageResponse {
  serverTime: number;
  sourceStatus: string;
  precisionDefault: string;
  cells: PublicCoverageCell[];
  attribution?: string;
}

export interface PublicLOSPoint {
  fraction: number;
  lat: number;
  lng: number;
  distanceKm: number;
  elevationM?: number;
  clearanceM?: number;
}

export interface PublicLOSProfileResponse {
  serverTime: number;
  source: string;
  sourceStatus: string;
  distanceKm: number;
  bearingDeg: number;
  frequencyMhz: number;
  antennaHeightAM: number;
  antennaHeightBM: number;
  points: PublicLOSPoint[];
  notes?: string[];
}

export interface PublicSensorSummaryResponse {
  serverTime: number;
  mqttConnected: boolean;
  packets: number;
  activeNodes: number;
  activeRoutes: number;
  wsClients: number;
  observerOnline: number;
  observerStale: number;
  observerOffline: number;
  topRegion?: string;
  publicCacheAgeMs: number;
  latestSeq?: number;
}

export interface PublicPacketsResponse {
  serverTime: number;
  packets: PublicPacketPath[];
  nextCursor?: string;
  window: PublicHistoryWindow;
  scan?: PublicPacketScan;
}

export interface PublicPropagationWeatherSummary {
  source: string;
  model?: string;
  sampleTime: number;
  fetchedAt: number;
  temperatureC: number;
  dewPointC: number;
  relativeHumidityPct: number;
  pressureHPa: number;
  cloudCoverPct: number;
  visibilityM?: number;
  windSpeedKmh: number;
  inversionProxy: string;
}

export interface PublicPropagationSolarSummary {
  kpIndex: number;
  kpLabel: string;
  solarFluxSfu: number;
  solarFluxLabel: string;
  geomagActivity: string;
  fetchedAt: number;
}

export interface PublicPropagationReplayWindow {
  from: number;
  to: number;
}

export interface PublicPropagationEvent {
  id: string;
  at: number;
  classification: 'tropo_possible' | 'long_distance_event' | string;
  confidence: string;
  score: number;
  distanceKm: number;
  region?: string;
  routeIds: string[];
  endpointLabels: string[];
  segments: PublicRouteSegment[];
  reasons: string[];
  weather?: PublicPropagationWeatherSummary;
  solar?: PublicPropagationSolarSummary;
  replayWindow: PublicPropagationReplayWindow;
}

export interface PublicPropagationConditions {
  serverTime: number;
  eventCount: number;
  latestEvent?: PublicPropagationEvent;
  weather?: PublicPropagationWeatherSummary;
  solar?: PublicPropagationSolarSummary;
  sourceStatus: string;
}

export interface PublicPropagationResponse {
  serverTime: number;
  conditions: PublicPropagationConditions;
  events: PublicPropagationEvent[];
  nextCursor?: string;
  window: PublicHistoryWindow;
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
  reasons?: string[];
  version?: string;
  gitSha?: string;
  buildTime?: string;
  dbReady?: boolean;
  staticReady?: boolean;
  publicStateReady?: boolean;
  mqttSessionReady?: boolean;
  datasetState?: 'fresh_start' | 'warming' | 'live' | string;
  datasetStartedAt?: number;
  storagePressureState?: 'ok' | 'warn' | 'critical' | string;
}

export type Health = RuntimeHealth;

export type PublicLiveEnvelope =
  | { v: 1; type: 'hello'; seq?: number; latestSeq?: number; fromSeq?: number; toSeq?: number; serverTime: number; receivedAt?: number; displayAt?: number; connectionId: string }
  | { v: 1; type: 'pong'; seq?: number; latestSeq?: number; serverTime?: number; receivedAt?: number; displayAt?: number }
  | { v: 1; type: 'lagged'; seq?: number; latestSeq?: number; fromSeq?: number; toSeq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; droppedCount: number; since: number }
  | { v: 1; type: 'event'; event: 'nodeUpdate'; seq?: number; latestSeq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; data: PublicNode }
  | { v: 1; type: 'event'; event: 'activity'; seq?: number; latestSeq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; data: PublicActivity }
  | { v: 1; type: 'event'; event: 'routePulse'; seq?: number; latestSeq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; data: PublicRoutePulse };

export interface SolarConditions {
  serverTime: number;
  kpIndex: number;
  kpLabel: string;
  solarFluxSfu: number;
  solarFluxLabel: string;
  geomagActivity: string;
  fetchedAt: number;
}
