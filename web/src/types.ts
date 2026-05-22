export type NodeRole = 'companion' | 'repeater' | 'room_server' | 'sensor' | 'unknown';

export interface PublicNode {
  id: string;
  label: string;
  role: NodeRole | string;
  isObserver?: boolean;
  latitude: number;
  longitude: number;
  lastSeen: number;
  firstSeen: number;
  iatasHeardIn: string[];
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
  payloadTypeName: string;
  messageSender?: string;
  messageText?: string;
  messageAnchor?: PublicMessageAnchor;
  heardAt: number;
  receivedAt?: number;
  displayAt?: number;
  seq?: number;
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
}

export interface PublicLiveState {
  serverTime: number;
  stats: PublicStats;
  nodes: PublicNode[];
  routes: PublicRoute[];
  recentPulses?: PublicRoutePulse[];
  recentActivity: PublicActivity[];
}

export interface Health {
  ok: boolean;
  mqttConnected: boolean;
  broker: string;
  packets: number;
  nodesWithPosition: number;
  edgeEvents: number;
  unresolved: number;
  wsClients: number;
  mqttMessages: number;
}

export type PublicLiveEnvelope =
  | { v: 1; type: 'hello'; seq?: number; serverTime: number; receivedAt?: number; displayAt?: number; connectionId: string }
  | { v: 1; type: 'lagged'; seq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; droppedCount: number; since: number }
  | { v: 1; type: 'event'; event: 'nodeUpdate'; seq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; data: PublicNode }
  | { v: 1; type: 'event'; event: 'activity'; seq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; data: PublicActivity }
  | { v: 1; type: 'event'; event: 'routePulse'; seq?: number; serverTime?: number; receivedAt?: number; displayAt?: number; data: PublicRoutePulse };
