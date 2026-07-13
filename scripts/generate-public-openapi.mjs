#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = read('VERSION').trim();
const check = process.argv.includes('--check');

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const string = (extra = {}) => ({ type: 'string', ...extra });
const integer = (extra = {}) => ({ type: 'integer', ...extra });
const int64 = (extra = {}) => integer({ format: 'int64', ...extra });
const number = (extra = {}) => ({ type: 'number', ...extra });
const boolean = (extra = {}) => ({ type: 'boolean', ...extra });
const array = (items, extra = {}) => ({ type: 'array', items, ...extra });
const object = (required, properties, extra = {}) => ({
  type: 'object',
  additionalProperties: false,
  ...(required.length ? { required } : {}),
  properties,
  ...extra
});
const stringArray = (extra = {}) => array(string(), extra);
const timestamp = (extra = {}) => int64({ description: 'Unix milliseconds', ...extra });
const jsonResponse = (schema, description = 'Public-safe JSON response') => ({
  description,
  content: { 'application/json': { schema: typeof schema === 'string' ? ref(schema) : schema } }
});
const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } }
});
const plainTextResponse = (description) => ({
  description,
  content: { 'text/plain; charset=utf-8': { schema: string() } }
});
const webSocketUnavailableResponse = {
  description: 'The public hub is unavailable (JSON) or the hub client limit is full (plain text)',
  content: {
    'application/json': { schema: ref('Error') },
    'text/plain; charset=utf-8': { schema: string() }
  }
};
const operation = (summary, schema, parameters = [], errors = {}) => ({
  summary,
  ...(parameters.length ? { parameters } : {}),
  responses: {
    200: jsonResponse(schema),
    ...Object.fromEntries(Object.entries(errors).map(([status, description]) => [status, errorResponse(description)]))
  }
});
const parameter = (name, schema, extra = {}) => ({ name, in: 'query', schema, ...extra });
const p = {
  from: parameter('from', timestamp()),
  to: parameter('to', timestamp()),
  limit2000: parameter('limit', integer({ minimum: 1, maximum: 2000 })),
  limit1000: parameter('limit', integer({ minimum: 1, maximum: 1000 })),
  limit5000: parameter('limit', integer({ minimum: 1, maximum: 5000 })),
  limit400: parameter('limit', integer({ minimum: 1, maximum: 400 })),
  limit200: parameter('limit', integer({ minimum: 1, maximum: 200 })),
  cursor: parameter('cursor', string({ description: 'Opaque bounded-history cursor' })),
  region: parameter('region', string({ minLength: 1, maxLength: 16 }), { description: 'Public region; iata is an accepted alias' }),
  iata: parameter('iata', string({ minLength: 1, maxLength: 16 }), { description: 'Alias for region' })
};

const schemas = {
  Error: object(['error'], { error: string() }),
  DatasetState: string({ enum: ['fresh_start', 'warming', 'live'] }),
  StoragePressureState: string({ enum: ['ok', 'warn', 'critical'] }),
  LiveQueueState: string({ enum: ['idle', 'active', 'lagging', 'failed'] }),
  CoordinateBounds: object(['minLat', 'maxLat', 'minLng', 'maxLng'], {
    minLat: number({ minimum: -90, maximum: 90 }), maxLat: number({ minimum: -90, maximum: 90 }),
    minLng: number({ minimum: -180, maximum: 180 }), maxLng: number({ minimum: -180, maximum: 180 })
  }),
  PublicMapConfig: object(['bounds'], {
    regionPreset: string(), defaultRegion: string(),
    defaultCenter: array(number(), { minItems: 2, maxItems: 2 }),
    defaultZoom: number(), bounds: ref('CoordinateBounds')
  }),
  PublicResolutionBuckets: {
    type: 'object',
    additionalProperties: { type: 'object', additionalProperties: int64({ minimum: 0 }) }
  },
  PublicCountMap: { type: 'object', additionalProperties: int64({ minimum: 0 }) },
  PublicStats: object(
    ['packets', 'activeNodes', 'activeRoutes', 'mqttConnected', 'mqttMessages', 'wsClients', 'serverTime'],
    {
      packets: int64({ minimum: 0 }), activeNodes: int64({ minimum: 0 }), activeRoutes: int64({ minimum: 0 }),
      mqttConnected: boolean(), mqttMessages: int64({ minimum: 0 }), wsClients: integer({ minimum: 0 }),
      serverTime: timestamp(), latestSeq: int64({ minimum: 0 }),
      resolutionBuckets: ref('PublicResolutionBuckets'), excludedIatas: ref('PublicCountMap'), excludedRegions: ref('PublicCountMap')
    }
  ),
  PublicNode: object(
    ['id', 'label', 'role', 'latitude', 'longitude', 'lastSeen', 'firstSeen', 'iatasHeardIn', 'activityCount'],
    {
      seq: int64({ minimum: 1 }), id: string(), label: string(),
      role: string({ enum: ['companion', 'repeater', 'room_server', 'sensor', 'unknown'] }),
      isObserver: boolean(), latitude: number({ minimum: -90, maximum: 90 }), longitude: number({ minimum: -180, maximum: 180 }),
      lastSeen: timestamp(), firstSeen: timestamp(), iatasHeardIn: stringArray(), regionsHeardIn: stringArray(),
      activityCount: int64({ minimum: 0 })
    }
  ),
  PublicRouteEndpoint: object(['nodeId', 'label', 'lat', 'lng'], {
    nodeId: string(), label: string(), lat: number({ minimum: -90, maximum: 90 }), lng: number({ minimum: -180, maximum: 180 }),
    pathHash3: string({ pattern: '^[0-9A-Fa-f]{6}$', description: 'Only public route-copy identifier; never a full key' })
  }),
  PublicRouteSegment: object(['routeId', 'from', 'to', 'distanceKm'], {
    routeId: string(), from: ref('PublicRouteEndpoint'), to: ref('PublicRouteEndpoint'), distanceKm: number({ minimum: 0 })
  }),
  PublicRoute: object(['id', 'from', 'to', 'distanceKm', 'packetCount', 'lastHeard', 'frequencyBucket', 'payloadTypeNames'], {
    id: string(), from: ref('PublicRouteEndpoint'), to: ref('PublicRouteEndpoint'), distanceKm: number({ minimum: 0 }),
    packetCount: integer({ minimum: 0 }), lastHeard: timestamp(), frequencyBucket: integer({ minimum: 0 }), payloadTypeNames: stringArray()
  }),
  PublicObserverLocation: object(['label', 'lat', 'lng'], {
    label: string(), iata: string(), region: string(), lat: number({ minimum: -90, maximum: 90 }), lng: number({ minimum: -180, maximum: 180 })
  }),
  PublicMessageAnchor: object(['kind', 'label', 'lat', 'lng'], {
    kind: string({ enum: ['source', 'observer'] }), nodeId: string(), label: string(),
    lat: number({ minimum: -90, maximum: 90 }), lng: number({ minimum: -180, maximum: 180 })
  }),
  PublicActivity: object(
    ['id', 'kind', 'payloadTypeName', 'heardAt', 'hopCount', 'hasRoute', 'animationState', 'resolutionBucket'],
    {
      seq: int64({ minimum: 1 }), id: string(), kind: string({ enum: ['packet'] }), payloadTypeName: string(), routeTypeName: string(),
      iata: string(), region: string(), heardAt: timestamp(), hopCount: integer({ minimum: 0 }), hasRoute: boolean(),
      animationState: string({ enum: ['route', 'observer', 'unmapped'] }),
      resolutionBucket: string({ enum: ['routed', 'observer_only', 'unresolved_path', 'missing_location', 'rf_gated', 'distance_gated', 'not_map_safe'] }),
      observerLocation: ref('PublicObserverLocation'), routeIds: stringArray(), endpointLabels: stringArray(),
      messageSender: string(), messageText: string(), messageAnchor: ref('PublicMessageAnchor')
    }
  ),
  PublicRoutePulse: object(['id', 'payloadTypeName', 'heardAt', 'segments'], {
    seq: int64({ minimum: 1 }), id: string(), iata: string(), region: string(), payloadTypeName: string(),
    messageSender: string(), messageText: string(), messageAnchor: ref('PublicMessageAnchor'), heardAt: timestamp(),
    segments: array(ref('PublicRouteSegment'), { minItems: 1 })
  }),
  PublicPacketPath: object(
    ['id', 'at', 'payloadTypeName', 'hopCount', 'segmentCount', 'distanceKm', 'routeIds', 'endpointLabels', 'segments'],
    {
      id: string(), at: timestamp(), iata: string(), region: string(), payloadTypeName: string(), messageSender: string(), messageText: string(),
      hopCount: integer({ minimum: 0 }), segmentCount: integer({ minimum: 1 }), distanceKm: number({ minimum: 0 }),
      routeIds: stringArray(), endpointLabels: stringArray(), segments: array(ref('PublicRouteSegment'), { minItems: 1 })
    }
  ),
  PublicChatMessage: object(['id', 'at', 'text', 'channelLabel', 'payloadTypeName', 'source'], {
    id: string(), at: timestamp(), iata: string(), region: string(), sender: string(), text: string(), channelLabel: string(),
    payloadTypeName: string(), source: string({ enum: ['routed', 'observer'] }), anchor: ref('PublicMessageAnchor'),
    routeIds: stringArray(), endpointLabels: stringArray()
  }),
  PublicHistoryWindow: object(['from', 'to', 'count'], {
    from: timestamp(), to: timestamp(), count: integer({ minimum: 0 })
  }),
  PublicHistoryActivityEvent: object(['type', 'at', 'data'], {
    type: string({ const: 'activity' }), at: timestamp(), data: ref('PublicActivity')
  }),
  PublicHistoryRoutePulseEvent: object(['type', 'at', 'data'], {
    type: string({ const: 'routePulse' }), at: timestamp(), data: ref('PublicRoutePulse')
  }),
  PublicHistoryEvent: { oneOf: [ref('PublicHistoryActivityEvent'), ref('PublicHistoryRoutePulseEvent')] },
  PublicHistoryResponse: object(['serverTime', 'events', 'window'], {
    serverTime: timestamp(), events: array(ref('PublicHistoryEvent')), nextCursor: string(), window: ref('PublicHistoryWindow')
  }),
  PublicPacketScan: object(['eventsScanned', 'scanLimit'], {
    eventsScanned: integer({ minimum: 0 }), scanLimit: integer({ minimum: 1 }), filtered: boolean(), partial: boolean()
  }),
  PublicPacketsResponse: object(['serverTime', 'packets', 'window', 'scan'], {
    serverTime: timestamp(), packets: array(ref('PublicPacketPath')), nextCursor: string(), window: ref('PublicHistoryWindow'), scan: ref('PublicPacketScan')
  }),
  PublicChatResponse: object(['serverTime', 'messages', 'window'], {
    serverTime: timestamp(), messages: array(ref('PublicChatMessage')), nextCursor: string(), window: ref('PublicHistoryWindow')
  }),
  PublicHistorySummaryBucket: object(['start', 'end', 'count'], {
    start: timestamp(), end: timestamp(), count: int64({ minimum: 0 })
  }),
  PublicHistorySummaryResponse: object(['serverTime', 'from', 'to', 'bucketMs', 'buckets'], {
    serverTime: timestamp(), from: timestamp(), to: timestamp(), bucketMs: int64({ minimum: 1000 }), buckets: array(ref('PublicHistorySummaryBucket'))
  }),
  PublicEventActivity: object(['seq', 'type', 'at', 'data'], {
    seq: int64({ minimum: 1 }), type: string({ const: 'activity' }), at: timestamp(), receivedAt: timestamp(), iata: string(), region: string(),
    payloadTypeName: string(), message: boolean(), routeIds: stringArray(), nodeIds: stringArray(), data: ref('PublicActivity')
  }),
  PublicEventRoutePulse: object(['seq', 'type', 'at', 'data'], {
    seq: int64({ minimum: 1 }), type: string({ const: 'routePulse' }), at: timestamp(), receivedAt: timestamp(), iata: string(), region: string(),
    payloadTypeName: string(), message: boolean(), routeIds: stringArray(), nodeIds: stringArray(), data: ref('PublicRoutePulse')
  }),
  PublicEventNodeUpdate: object(['seq', 'type', 'at', 'data'], {
    seq: int64({ minimum: 1 }), type: string({ const: 'nodeUpdate' }), at: timestamp(), receivedAt: timestamp(), iata: string(), region: string(),
    payloadTypeName: string(), message: boolean(), routeIds: stringArray(), nodeIds: stringArray(), data: ref('PublicNode')
  }),
  PublicEventExtension: object(['seq', 'type', 'at', 'data'], {
    seq: int64({ minimum: 1 }), type: { type: 'string', not: { enum: ['activity', 'routePulse', 'nodeUpdate'] } }, at: timestamp(),
    receivedAt: timestamp(), iata: string(), region: string(), payloadTypeName: string(), message: boolean(), routeIds: stringArray(), nodeIds: stringArray(), data: true
  }, { description: 'Additive future public event; its envelope fields remain privacy-filtered.' }),
  PublicEvent: { oneOf: [ref('PublicEventActivity'), ref('PublicEventRoutePulse'), ref('PublicEventNodeUpdate'), ref('PublicEventExtension')] },
  PublicEventsResponse: object(['serverTime', 'oldestSeq', 'latestSeq', 'events', 'resetRequired'], {
    serverTime: timestamp(), oldestSeq: int64({ minimum: 0 }), latestSeq: int64({ minimum: 0 }),
    events: array(ref('PublicEvent')), nextCursor: string({ pattern: '^[1-9][0-9]*$' }), resetRequired: boolean()
  }, {
    description: 'afterSeq <= 0, a cursor older than retention, or a cursor ahead of latestSeq returns resetRequired=true and no events.',
    allOf: [{ if: { properties: { resetRequired: { const: true } }, required: ['resetRequired'] }, then: { properties: { events: { maxItems: 0 } } } }]
  }),
  PublicMapCluster: object(['id', 'latitude', 'longitude', 'count'], {
    id: string(), latitude: number({ minimum: -90, maximum: 90 }), longitude: number({ minimum: -180, maximum: 180 }),
    count: integer({ minimum: 1 }), activityCount: int64({ minimum: 0 }), lastSeen: timestamp(), region: string()
  }),
  PublicRuntimeHealth: object(['mqttSessionReady', 'datasetState', 'datasetStartedAt', 'storagePressureState'], {
    mqttSessionReady: boolean(), datasetState: ref('DatasetState'), datasetStartedAt: timestamp(), storagePressureState: ref('StoragePressureState')
  }),
  PublicBootstrapResponse: object(['serverTime', 'map', 'stats', 'latestSeq', 'health', 'clusters', 'recentActivity'], {
    serverTime: timestamp(), map: ref('PublicMapConfig'), stats: ref('PublicStats'), latestSeq: int64({ minimum: 0 }),
    health: ref('PublicRuntimeHealth'), clusters: array(ref('PublicMapCluster')), recentActivity: array(ref('PublicActivity'), { maxItems: 40 })
  }),
  PublicViewportResponse: object(['serverTime', 'nodes', 'routes'], {
    serverTime: timestamp(), latestSeq: int64({ minimum: 0 }), nodes: array(ref('PublicNode')), routes: array(ref('PublicRoute')),
    clusters: array(ref('PublicMapCluster')), events: array(ref('PublicEvent')),
    bbox: array(number(), { minItems: 4, maxItems: 4 }), zoom: number(),
    includes: array(string({ enum: ['nodes', 'routes', 'events', 'clusters'] }), { uniqueItems: true })
  }),
  PublicNOCObserver: object(['id', 'label', 'state', 'lastSeen', 'lastSeenAgeMs', 'packetsTotal', 'activityCount'], {
    id: string(), label: string(), region: string(), state: string({ enum: ['online', 'stale', 'offline'] }), lastSeen: timestamp(),
    lastSeenAgeMs: int64({ minimum: 0 }), packetsTotal: int64({ minimum: 0 }), activityCount: int64({ minimum: 0 })
  }),
  PublicObserverStateCounts: object(['online', 'stale', 'offline'], {
    online: integer({ minimum: 0 }), stale: integer({ minimum: 0 }), offline: integer({ minimum: 0 })
  }),
  PublicNOCResponse: object(
    ['serverTime', 'mqttConnected', 'publicCacheReady', 'publicCacheAgeMs', 'wsClients', 'wsDroppedMessages', 'packets', 'activeNodes', 'activeRoutes', 'observers', 'observerStateCounts'],
    {
      serverTime: timestamp(), latestSeq: int64({ minimum: 0 }), mqttConnected: boolean(), publicCacheReady: boolean(), publicCacheAgeMs: int64(),
      wsClients: integer({ minimum: 0 }), wsDroppedMessages: int64({ minimum: 0 }), packets: int64({ minimum: 0 }), activeNodes: int64({ minimum: 0 }),
      activeRoutes: int64({ minimum: 0 }), observers: array(ref('PublicNOCObserver')), observerStateCounts: ref('PublicObserverStateCounts'),
      resolutionBuckets: ref('PublicResolutionBuckets')
    }
  ),
  PublicCoverageCell: object(['id', 'source', 'bbox', 'intensity', 'sampleCount', 'ageBucket', 'updatedAt', 'precisionBucket'], {
    id: string(), source: string(), region: string(), bbox: array(number(), { minItems: 4, maxItems: 4 }), intensity: number(),
    sampleCount: int64({ minimum: 0 }), ageBucket: string(), updatedAt: timestamp(), attribution: string(), precisionBucket: string({ enum: ['coarse'] })
  }),
  PublicCoverageResponse: object(['serverTime', 'sourceStatus', 'precisionDefault', 'cells'], {
    serverTime: timestamp(), sourceStatus: string({ enum: ['not_configured', 'ready'] }), precisionDefault: string({ const: 'coarse' }),
    cells: array(ref('PublicCoverageCell')), attribution: string()
  }),
  PublicLOSPoint: object(['fraction', 'lat', 'lng', 'distanceKm'], {
    fraction: number({ minimum: 0, maximum: 1 }), lat: number({ minimum: -90, maximum: 90 }), lng: number({ minimum: -180, maximum: 180 }),
    distanceKm: number({ minimum: 0 }), elevationM: number(), clearanceM: number()
  }),
  PublicLOSProfileResponse: object(
    ['serverTime', 'source', 'sourceStatus', 'distanceKm', 'bearingDeg', 'frequencyMhz', 'antennaHeightAM', 'antennaHeightBM', 'points'],
    {
      serverTime: timestamp(), source: string(), sourceStatus: string(), distanceKm: number({ minimum: 0 }), bearingDeg: number({ minimum: 0, maximum: 360 }),
      frequencyMhz: number(), antennaHeightAM: number(), antennaHeightBM: number(), points: array(ref('PublicLOSPoint'), { minItems: 2 }), notes: stringArray()
    }
  ),
  PublicSensorSummaryResponse: object(
    ['serverTime', 'mqttConnected', 'packets', 'activeNodes', 'activeRoutes', 'wsClients', 'observerOnline', 'observerStale', 'observerOffline', 'publicCacheAgeMs'],
    {
      serverTime: timestamp(), mqttConnected: boolean(), packets: int64({ minimum: 0 }), activeNodes: int64({ minimum: 0 }), activeRoutes: int64({ minimum: 0 }),
      wsClients: integer({ minimum: 0 }), observerOnline: integer({ minimum: 0 }), observerStale: integer({ minimum: 0 }), observerOffline: integer({ minimum: 0 }),
      topRegion: string(), publicCacheAgeMs: int64(), latestSeq: int64({ minimum: 0 })
    }
  ),
  SolarConditions: object(['serverTime', 'kpIndex', 'kpLabel', 'solarFluxSfu', 'solarFluxLabel', 'geomagActivity', 'fetchedAt'], {
    serverTime: timestamp(), kpIndex: number({ minimum: 0 }), kpLabel: string({ enum: ['', 'quiet', 'active', 'storm', 'major', 'severe'] }),
    solarFluxSfu: number({ minimum: 0 }), solarFluxLabel: string({ enum: ['', 'low', 'moderate', 'high', 'very_high'] }),
    geomagActivity: string({ enum: ['', 'quiet', 'unsettled', 'active', 'storm'] }), fetchedAt: timestamp()
  }),
  PublicPropagationWeatherSummary: object(
    ['source', 'sampleTime', 'fetchedAt', 'temperatureC', 'dewPointC', 'relativeHumidityPct', 'pressureHPa', 'cloudCoverPct', 'windSpeedKmh', 'inversionProxy'],
    {
      source: string(), model: string(), sampleTime: timestamp(), fetchedAt: timestamp(), temperatureC: number(), dewPointC: number(),
      relativeHumidityPct: number({ minimum: 0, maximum: 100 }), pressureHPa: number({ minimum: 0 }), cloudCoverPct: number({ minimum: 0, maximum: 100 }),
      visibilityM: number({ minimum: 0 }), windSpeedKmh: number({ minimum: 0 }),
      inversionProxy: string({ enum: ['surface_only', 'inversion', 'stable_layer', 'weak_lapse', 'normal_lapse'] })
    }
  ),
  PublicPropagationSolarSummary: object(['kpIndex', 'kpLabel', 'solarFluxSfu', 'solarFluxLabel', 'geomagActivity', 'fetchedAt'], {
    kpIndex: number({ minimum: 0 }), kpLabel: string(), solarFluxSfu: number({ minimum: 0 }), solarFluxLabel: string(), geomagActivity: string(), fetchedAt: timestamp()
  }),
  PublicPropagationReplayWindow: object(['from', 'to'], { from: timestamp(), to: timestamp() }),
  PublicPropagationEvent: object(
    ['id', 'at', 'classification', 'confidence', 'score', 'distanceKm', 'routeIds', 'endpointLabels', 'segments', 'reasons', 'replayWindow'],
    {
      id: string(), at: timestamp(), classification: string({ enum: ['tropo_possible', 'long_distance_event'] }), confidence: string({ enum: ['low', 'medium'] }), score: number(),
      distanceKm: number({ minimum: 0 }), region: string(), routeIds: stringArray(), endpointLabels: stringArray(), segments: array(ref('PublicRouteSegment'), { minItems: 1 }),
      reasons: stringArray(), weather: ref('PublicPropagationWeatherSummary'), solar: ref('PublicPropagationSolarSummary'), replayWindow: ref('PublicPropagationReplayWindow')
    }
  ),
  PublicPropagationConditions: object(['serverTime', 'eventCount', 'sourceStatus'], {
    serverTime: timestamp(), eventCount: integer({ minimum: 0 }), latestEvent: ref('PublicPropagationEvent'), weather: ref('PublicPropagationWeatherSummary'),
    solar: ref('PublicPropagationSolarSummary'), sourceStatus: string({ enum: ['restricted', 'no_recent_events', 'ready'] })
  }),
  PublicPropagationResponse: object(['serverTime', 'conditions', 'events', 'window'], {
    serverTime: timestamp(), conditions: ref('PublicPropagationConditions'), events: array(ref('PublicPropagationEvent')), nextCursor: string(), window: ref('PublicHistoryWindow')
  }),
  RuntimeOperationalStatus: object(
    [
      'ok', 'ready', 'dbReady', 'staticReady', 'publicStateReady', 'mqttSessionReady',
      'datasetState', 'datasetStartedAt', 'storagePressureState', 'version', 'gitSha', 'buildTime'
    ],
    {
      ok: boolean(), ready: boolean(), dbReady: boolean(), staticReady: boolean(), publicStateReady: boolean(),
      mqttSessionReady: boolean(), datasetState: ref('DatasetState'), datasetStartedAt: timestamp(),
      storagePressureState: ref('StoragePressureState'), version: string(), gitSha: string(), buildTime: string()
    },
    { description: 'Minimal public liveness and coarse dependency summary. Use /readyz for fail-closed serving readiness.' }
  ),
  RuntimeReadinessStatus: object(
    [
      'ok', 'ready', 'reasons', 'dbReady', 'staticReady', 'publicStateReady', 'mqttSessionReady', 'datasetState', 'storagePressureState',
      'primaryIngestState', 'liveProjectionState', 'primaryQueueOldestAgeMs', 'liveProjectionOldestAgeMs', 'lastBroadcastLatencyMs', 'maxBroadcastLatencyMs',
      'version', 'gitSha'
    ],
    {
      ok: boolean(), ready: boolean(), reasons: stringArray(), dbReady: boolean(), staticReady: boolean(), publicStateReady: boolean(),
      mqttSessionReady: boolean(), datasetState: ref('DatasetState'), storagePressureState: ref('StoragePressureState'),
      primaryIngestState: ref('LiveQueueState'), liveProjectionState: ref('LiveQueueState'),
      primaryQueueOldestAgeMs: int64({ minimum: 0 }), liveProjectionOldestAgeMs: int64({ minimum: 0 }), lastBroadcastLatencyMs: int64({ minimum: 0 }),
      maxBroadcastLatencyMs: int64({ minimum: 0 }),
      version: string(), gitSha: string()
    }
  ),
  PublicLiveState: object(['serverTime', 'map', 'stats', 'nodes', 'routes', 'recentActivity', 'updatedAt'], {
    serverTime: timestamp(), map: ref('PublicMapConfig'), stats: ref('PublicStats'), nodes: array(ref('PublicNode')), routes: array(ref('PublicRoute')),
    recentPulses: array(ref('PublicRoutePulse')), recentActivity: array(ref('PublicActivity')), updatedAt: timestamp()
  }),
  WebSocketSubscriptionScope: object([], {
    regions: stringArray(), payloadTypes: stringArray(), events: stringArray(), bbox: array(number(), { minItems: 4, maxItems: 4 }), messageOnly: boolean()
  }),
  WebSocketClientPing: object(['type'], { v: integer({ const: 1 }), type: string({ const: 'ping' }), id: string() }),
  WebSocketClientResume: object(['type'], { v: integer({ const: 1 }), type: string({ const: 'resume' }), id: string(), afterSeq: int64() }),
  WebSocketClientSubscribe: object(['type'], { v: integer({ const: 1 }), type: string({ const: 'subscribe' }), id: string(), scope: ref('WebSocketSubscriptionScope') }),
  WebSocketClientUnsubscribe: object(['type'], { v: integer({ const: 1 }), type: string({ const: 'unsubscribe' }), id: string() }),
  WebSocketClientMessage: { oneOf: [ref('WebSocketClientPing'), ref('WebSocketClientResume'), ref('WebSocketClientSubscribe'), ref('WebSocketClientUnsubscribe')] },
  WebSocketHello: object(['v', 'type', 'serverTime', 'receivedAt', 'connectionId'], {
    v: integer({ const: 1 }), type: string({ const: 'hello' }), seq: int64({ minimum: 1 }), latestSeq: int64({ minimum: 1 }), fromSeq: int64({ minimum: 1 }),
    toSeq: int64({ minimum: 1 }), serverTime: timestamp(), receivedAt: timestamp(), displayAt: timestamp(), connectionId: string({ format: 'uuid' })
  }),
  WebSocketPong: object(['v', 'type', 'serverTime', 'receivedAt'], {
    v: integer({ const: 1 }), type: string({ const: 'pong' }), seq: int64({ minimum: 1 }), latestSeq: int64({ minimum: 1 }),
    serverTime: timestamp(), receivedAt: timestamp(), displayAt: timestamp()
  }),
  WebSocketLagged: object(['v', 'type', 'serverTime', 'receivedAt', 'droppedCount', 'since'], {
    v: integer({ const: 1 }), type: string({ const: 'lagged' }), seq: int64({ minimum: 1 }), latestSeq: int64({ minimum: 1 }), fromSeq: int64({ minimum: 1 }),
    toSeq: int64({ minimum: 1 }), serverTime: timestamp(), receivedAt: timestamp(), displayAt: timestamp(), droppedCount: integer({ minimum: 1 }), since: timestamp()
  }),
  WebSocketNodeEvent: webSocketEventSchema('nodeUpdate', 'PublicNode'),
  WebSocketActivityEvent: webSocketEventSchema('activity', 'PublicActivity'),
  WebSocketRoutePulseEvent: webSocketEventSchema('routePulse', 'PublicRoutePulse'),
  WebSocketServerMessage: { oneOf: [ref('WebSocketHello'), ref('WebSocketPong'), ref('WebSocketLagged'), ref('WebSocketNodeEvent'), ref('WebSocketActivityEvent'), ref('WebSocketRoutePulseEvent')] },
  OpenAPIInfo: object(['title', 'version', 'description', 'license'], { title: string(), version: string(), description: string(), license: ref('OpenAPILicense') }),
  OpenAPILicense: object(['name'], { name: string(), url: string({ format: 'uri' }) }),
  OpenAPIServer: object(['url'], { url: string() }),
  OpenAPIPathItem: { type: 'object', required: ['get'], properties: { get: { type: 'object' } }, additionalProperties: false },
  OpenAPIComponents: object(['schemas'], { schemas: { type: 'object' } }),
  OpenAPIDocument: object(['openapi', 'info', 'servers', 'security', 'paths', 'components', 'x-public-forbidden-fields'], {
    openapi: string({ const: '3.1.0' }), info: ref('OpenAPIInfo'), servers: array(ref('OpenAPIServer'), { minItems: 1 }),
    security: array({ type: 'object' }),
    paths: { type: 'object', additionalProperties: ref('OpenAPIPathItem') }, components: ref('OpenAPIComponents'),
    'x-public-forbidden-fields': stringArray({ minItems: 1, uniqueItems: true })
  })
};

const doc = {
  openapi: '3.1.0',
  info: {
    title: 'MC-CartoLive Public API',
    version,
    description: 'Privacy-safe additive HTTP and WebSocket contract. Internal analyzer, metrics, and debug routes are intentionally excluded.',
    license: { name: 'MIT', url: 'https://github.com/n30nex/MC-CartoLive/blob/main/LICENSE' }
  },
  servers: [{ url: '/' }],
  security: [],
  paths: {
    '/healthz': { get: operation('Cheap public process health', 'RuntimeOperationalStatus') },
    '/readyz': {
      get: {
        ...operation('Public-safe serving readiness', 'RuntimeReadinessStatus'),
        responses: {
          200: jsonResponse('RuntimeReadinessStatus', 'All serving dependencies are ready'),
          503: jsonResponse('RuntimeReadinessStatus', 'One or more serving dependencies are not ready')
        }
      }
    },
    '/api/v1/public/state': {
      get: {
        ...operation('Compatibility full public live state', 'PublicLiveState', [], { 429: 'Rate limited', 500: 'Internal query failure', 503: 'Public cache warming' }),
        responses: {
          200: jsonResponse('PublicLiveState', 'Sanitized cached state; supports gzip and ETag'),
          304: { description: 'ETag unchanged; no response body' },
          429: errorResponse('Rate limited'), 500: errorResponse('Internal query failure'), 503: errorResponse('Public cache warming')
        }
      }
    },
    '/api/v1/public/bootstrap': { get: operation('Compact initial map bootstrap', 'PublicBootstrapResponse', [], { 429: 'Rate limited', 503: 'Public cache warming' }) },
    '/api/v1/public/history': {
      get: operation('Bounded routed-event history', 'PublicHistoryResponse', [p.from, p.to, p.limit2000, p.cursor], { 400: 'Invalid cursor or window', 429: 'Rate limited', 500: 'Query failure', 503: 'Store unavailable' })
    },
    '/api/v1/public/history/summary': {
      get: operation('Bounded history buckets', 'PublicHistorySummaryResponse', [p.from, p.to, parameter('bucketMs', int64({ minimum: 1000 }))], { 429: 'Rate limited', 503: 'Store unavailable' })
    },
    '/api/v1/public/events': {
      get: operation(
        'Durable public event resume with bounded reset semantics', 'PublicEventsResponse',
        [
          parameter('afterSeq', int64(), { description: 'Zero, negative, expired, or ahead cursors request an immediate reset response' }), p.from, p.to, p.limit1000,
          p.region, p.iata, parameter('payload', string(), { description: 'Payload type; payloadType is an accepted alias' }),
          parameter('payloadType', string(), { description: 'Alias for payload' }), parameter('event', string({ enum: ['activity', 'routePulse', 'nodeUpdate'] })),
          parameter('messageOnly', boolean())
        ],
        { 404: 'Public event resume disabled', 429: 'Rate limited', 500: 'Query failure' }
      )
    },
    '/api/v1/public/viewport': {
      get: operation(
        'Viewport-scoped map data; low zoom defaults to clusters and detail zoom defaults to nodes/routes/events', 'PublicViewportResponse',
        [
          parameter('bbox', string(), { required: true, description: 'minLng,minLat,maxLng,maxLat; commas, semicolons, and whitespace are accepted separators' }),
          parameter('zoom', number()), parameter('include', string({ description: 'Comma-separated nodes,routes,events,clusters or detail' })),
          parameter('sinceSeq', int64({ minimum: 0 }))
        ],
        { 400: 'Invalid bounding box', 404: 'Viewport API disabled', 429: 'Rate limited', 503: 'Public cache warming' }
      )
    },
    '/api/v1/public/noc': { get: operation('Public-safe operations summary', 'PublicNOCResponse', [], { 404: 'NOC API disabled', 429: 'Rate limited', 503: 'Public cache warming' }) },
    '/api/v1/public/packets': {
      get: operation(
        'Sanitized true-path packet projections', 'PublicPacketsResponse',
        [p.from, p.to, p.limit1000, p.cursor, p.region, p.iata, parameter('payload', string()), parameter('minHops', integer({ minimum: 0 })), parameter('messageOnly', boolean()), parameter('q', string({ maxLength: 120 }))],
        { 400: 'Invalid cursor or window', 429: 'Rate limited', 500: 'Query failure', 503: 'Store unavailable' }
      )
    },
    '/api/v1/public/chat': {
      get: operation(
        'Sanitized decoded public chat', 'PublicChatResponse',
        [p.from, p.to, p.limit400, p.cursor, p.region, p.iata, parameter('channel', string({ maxLength: 80 })), parameter('q', string({ maxLength: 120 }))],
        { 400: 'Invalid cursor or window', 429: 'Rate limited', 500: 'Query failure', 503: 'Store unavailable' }
      )
    },
    '/api/v1/public/solar': { get: operation('Public solar conditions', 'SolarConditions', [], { 429: 'Rate limited', 503: 'Solar conditions unavailable' }) },
    '/api/v1/public/propagation': {
      get: operation('Bounded public propagation events', 'PublicPropagationResponse', [p.from, p.to, p.limit200, p.cursor, p.region, p.iata], { 400: 'Invalid cursor or window', 429: 'Rate limited', 500: 'Query failure', 503: 'Store unavailable' })
    },
    '/api/v1/public/coverage': {
      get: operation('Coarse public coverage cells', 'PublicCoverageResponse', [p.region, p.iata, p.limit5000], { 404: 'Coverage API disabled', 429: 'Rate limited', 500: 'Query failure' })
    },
    '/api/v1/public/los/profile': {
      get: operation(
        'Public line-of-sight profile', 'PublicLOSProfileResponse',
        [
          parameter('aLat', number({ minimum: -90, maximum: 90 })), parameter('aLng', number({ minimum: -180, maximum: 180 })),
          parameter('bLat', number({ minimum: -90, maximum: 90 })), parameter('bLng', number({ minimum: -180, maximum: 180 })),
          parameter('nodeA', string()), parameter('nodeB', string()), parameter('frequencyMhz', number()),
          parameter('antennaHeightAM', number()), parameter('antennaHeightBM', number())
        ],
        { 400: 'Provide both coordinate pairs or both public node IDs', 404: 'LOS API disabled', 429: 'Rate limited' }
      )
    },
    '/api/v1/public/schema': { get: operation('This complete checked public OpenAPI document', 'OpenAPIDocument', [], { 404: 'Schema API disabled', 429: 'Rate limited' }) },
    '/api/v1/public/integrations/home-assistant': {
      get: operation('Public-safe aggregate sensor summary', 'PublicSensorSummaryResponse', [], { 404: 'Public integrations disabled', 429: 'Rate limited', 503: 'Public cache warming' })
    },
    '/ws/public': {
      get: {
        summary: 'Sanitized public WebSocket upgrade',
        description: 'The server also uses WebSocket protocol ping frames. JSON client and server envelopes are fully described by the extension below. API admission errors are JSON; hub saturation and upgrade protocol/origin rejections are plain text.',
        'x-websocket-messages': { client: ref('WebSocketClientMessage'), server: ref('WebSocketServerMessage') },
        responses: {
          101: { description: 'Switching Protocols' },
          400: plainTextResponse('Malformed or unsupported WebSocket handshake'),
          403: plainTextResponse('WebSocket Origin rejected'),
          405: plainTextResponse('Upgrade request method is not GET'),
          429: errorResponse('Per-IP public WebSocket quota exceeded'),
          500: plainTextResponse('WebSocket upgrade could not take control of the connection'),
          503: webSocketUnavailableResponse
        }
      }
    }
  },
  components: {
    schemas
  },
  'x-public-forbidden-fields': [
    'publicKey', 'observerPublicKey', 'packetHash', 'rawHex', 'rawJson', 'payloadHex', 'pathHex',
    'resolutionReason', 'resolver', 'debug', 'secret', 'token', 'password'
  ]
};

const operationIds = {
  '/healthz': 'getHealth', '/readyz': 'getReadiness', '/api/v1/public/state': 'getPublicState',
  '/api/v1/public/bootstrap': 'getPublicBootstrap', '/api/v1/public/history': 'getPublicHistory',
  '/api/v1/public/history/summary': 'getPublicHistorySummary', '/api/v1/public/events': 'getPublicEvents',
  '/api/v1/public/viewport': 'getPublicViewport', '/api/v1/public/noc': 'getPublicNOC',
  '/api/v1/public/packets': 'getPublicPackets', '/api/v1/public/chat': 'getPublicChat', '/api/v1/public/solar': 'getPublicSolar',
  '/api/v1/public/propagation': 'getPublicPropagation', '/api/v1/public/coverage': 'getPublicCoverage',
  '/api/v1/public/los/profile': 'getPublicLOSProfile', '/api/v1/public/schema': 'getPublicOpenAPI',
  '/api/v1/public/integrations/home-assistant': 'getPublicHomeAssistantSummary', '/ws/public': 'connectPublicWebSocket'
};
for (const [path, operationId] of Object.entries(operationIds)) doc.paths[path].get.operationId = operationId;

const rendered = `${JSON.stringify(doc, null, 2)}\n`;
const outputs = ['backend/internal/api/public-openapi.json', 'docs/public-api.openapi.json'];
if (check) {
  const stale = outputs.filter((path) => read(path) !== rendered);
  if (stale.length) {
    console.error(`generated public OpenAPI is stale: ${stale.join(', ')}`);
    console.error('run: node scripts/generate-public-openapi.mjs');
    process.exit(1);
  }
  console.log(`generated public OpenAPI synchronized: ${version}`);
} else {
  for (const path of outputs) writeFileSync(join(root, path), rendered);
  console.log(`generated public OpenAPI: ${version}`);
}

function webSocketEventSchema(event, dataSchema) {
  return object(['v', 'type', 'event', 'serverTime', 'data'], {
    v: integer({ const: 1 }), type: string({ const: 'event' }), event: string({ const: event }),
    seq: int64({ minimum: 1, description: 'Sparse monotonic durable cursor when present. Omitted for live-only fallback events; consumers must not advance their durable cursor for an omitted value.' }),
    latestSeq: int64({ minimum: 1 }), serverTime: timestamp(), receivedAt: timestamp(), displayAt: timestamp(), data: ref(dataSchema)
  });
}

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}
