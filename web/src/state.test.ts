import { describe, expect, it } from 'vitest';
import {
  ROUTE_TRACE_BIN_COUNT,
  ROUTE_TRACE_WINDOW_MS,
  SNAPSHOT_PULSE_REPLAY_LIMIT,
  SNAPSHOT_PULSE_REPLAY_SPACING_MS,
  SNAPSHOT_PULSE_FUTURE_SKEW_MS,
  SNAPSHOT_PULSE_STALE_MS,
  applyPublicEnvelope,
  addObserverBurst,
  currentPacketRatePerMinute,
  filterNodes,
  filterRoutes,
  hydrateSnapshotObserverBursts,
  hydrateSnapshotPulses,
  initialAppState,
  liveCoverageStats,
  pruneObserverBursts,
  summarizeRouteActivity
} from './state';
import type { PublicLiveEnvelope, PublicLiveState } from './types';

const publicState: PublicLiveState = {
  serverTime: 1_700_000_000_000,
  stats: {
    packets: 10,
    activeNodes: 2,
    activeRoutes: 1,
    mqttConnected: true,
    mqttMessages: 14,
    wsClients: 1,
    serverTime: 1_700_000_000_000
  },
  nodes: [
    {
      id: 'node-a',
      label: 'Kitchener Repeater',
      role: 'repeater',
      latitude: 43.45,
      longitude: -80.49,
      lastSeen: 1_700_000_000_000,
      firstSeen: 1_699_999_000_000,
      iatasHeardIn: ['YKF'],
      activityCount: 8
    },
    {
      id: 'node-b',
      label: 'Toronto Room',
      role: 'room_server',
      latitude: 43.65,
      longitude: -79.38,
      lastSeen: 1_700_000_000_000,
      firstSeen: 1_699_999_000_000,
      iatasHeardIn: ['YYZ'],
      activityCount: 6
    }
  ],
  routes: [
    {
      id: 'r-ab',
      from: { nodeId: 'node-a', label: 'Kitchener Repeater', lat: 43.45, lng: -80.49 },
      to: { nodeId: 'node-b', label: 'Toronto Room', lat: 43.65, lng: -79.38 },
      distanceKm: 93,
      packetCount: 7,
      lastHeard: 1_700_000_000_000,
      frequencyBucket: 0,
      payloadTypeNames: ['ADVERT']
    }
  ],
  recentActivity: [
    {
      id: 'activity-1',
      kind: 'packet',
      payloadTypeName: 'ADVERT',
      routeTypeName: 'FLOOD',
      iata: 'YKF',
      heardAt: 1_700_000_000_000,
      hopCount: 1,
      hasRoute: true,
      animationState: 'route',
      resolutionBucket: 'routed',
      routeIds: ['r-ab']
    }
  ]
};

describe('public app state', () => {
  it('initializes public nodes, routes, activity, and stats', () => {
    const state = initialAppState(publicState);

    expect(state.nodes).toHaveLength(2);
    expect(state.routes[0].frequencyBucket).toBeGreaterThanOrEqual(0);
    expect(state.activity[0].id).toBe('activity-1');
    expect(state.stats?.activeRoutes).toBe(1);
  });

  it('hydrates recent public pulses from state snapshots for polling fallback', () => {
    const state = initialAppState({
      ...publicState,
      recentPulses: [
        {
          id: 'pulse-snapshot-1',
          payloadTypeName: 'GROUP_TEXT',
          messageSender: 'Tree',
          messageText: 'hello map',
          heardAt: 1_700_000_000_000,
          segments: [
            {
              routeId: 'r-ab',
              from: { nodeId: 'node-a', label: 'Kitchener Repeater', lat: 43.45, lng: -80.49 },
              to: { nodeId: 'node-b', label: 'Toronto Room', lat: 43.65, lng: -79.38 },
              distanceKm: 93
            }
          ]
        }
      ]
    });

    expect(state.pulses[0].messageText).toBe('hello map');
    expect(state.pulses[0].messageSender).toBe('Tree');
    expect(state.pulses[0].receivedAt).toBe(publicState.serverTime);
    expect(state.pulses[0].displayAt).toBe(publicState.serverTime);
    expect(state.routeTraces).toHaveLength(1);
  });

  it('hydrates recent observer-only message bursts from state snapshots', () => {
    const state = initialAppState({
      ...publicState,
      recentActivity: [
        {
          id: 'activity-message',
          kind: 'packet',
          payloadTypeName: 'GROUP_TEXT',
          routeTypeName: 'FLOOD',
          iata: 'YKF',
          heardAt: publicState.serverTime - 2_000,
          hopCount: 0,
          hasRoute: false,
          animationState: 'observer',
          resolutionBucket: 'observer_only',
          observerLocation: { label: 'YKF observer', lat: 43.44, lng: -80.48 },
          messageSender: 'Tree',
          messageText: 'hello public'
        }
      ]
    });

    expect(state.observerBursts).toHaveLength(1);
    expect(state.observerBursts[0]).toMatchObject({
      id: 'observer-activity-message',
      payloadTypeName: 'GROUP_TEXT',
      messageSender: 'Tree',
      messageText: 'hello public',
      location: { label: 'YKF observer', lat: 43.44, lng: -80.48 }
    });
    expect(state.observerBursts[0].displayAt).toBe(publicState.serverTime);
  });

  it('ignores stale or unmapped activity when hydrating observer bursts', () => {
    const bursts = hydrateSnapshotObserverBursts([
      {
        id: 'stale',
        kind: 'packet',
        payloadTypeName: 'GROUP_TEXT',
        heardAt: publicState.serverTime - SNAPSHOT_PULSE_STALE_MS - 1,
        hopCount: 0,
        hasRoute: false,
        animationState: 'observer',
        resolutionBucket: 'observer_only',
        observerLocation: { label: 'observer', lat: 43.44, lng: -80.48 },
        messageText: 'old'
      },
      {
        id: 'unmapped',
        kind: 'packet',
        payloadTypeName: 'GROUP_TEXT',
        heardAt: publicState.serverTime,
        hopCount: 0,
        hasRoute: false,
        animationState: 'unmapped',
        resolutionBucket: 'unresolved_path',
        messageText: 'no location'
      }
    ], publicState.serverTime);

    expect(bursts).toHaveLength(0);
  });

  it('paces snapshot pulse replay and limits reconnect bursts', () => {
    const pulses = Array.from({ length: SNAPSHOT_PULSE_REPLAY_LIMIT + 5 }, (_, index) => ({
      id: `pulse-${index}`,
      payloadTypeName: 'ADVERT',
      heardAt: publicState.serverTime - index * 1000,
      segments: [
        {
          routeId: `r-${index}`,
          from: publicState.routes[0].from,
          to: publicState.routes[0].to,
          distanceKm: 93
        }
      ]
    }));

    const hydrated = hydrateSnapshotPulses(pulses, publicState.serverTime);

    expect(hydrated).toHaveLength(SNAPSHOT_PULSE_REPLAY_LIMIT);
    expect(hydrated.at(-1)?.displayAt).toBe(publicState.serverTime);
    expect(hydrated[0].displayAt).toBe(publicState.serverTime + (SNAPSHOT_PULSE_REPLAY_LIMIT - 1) * SNAPSHOT_PULSE_REPLAY_SPACING_MS);
  });

  it('drops stale and far-future snapshot pulses before replaying packet comets', () => {
    const goodPulse = {
      id: 'pulse-current',
      payloadTypeName: 'ADVERT',
      heardAt: publicState.serverTime,
      segments: [
        {
          routeId: 'r-current',
          from: publicState.routes[0].from,
          to: publicState.routes[0].to,
          distanceKm: 93
        }
      ]
    };
    const futurePulse = {
      ...goodPulse,
      id: 'pulse-future',
      heardAt: publicState.serverTime + SNAPSHOT_PULSE_FUTURE_SKEW_MS + 1
    };
    const stalePulse = {
      ...goodPulse,
      id: 'pulse-stale',
      heardAt: publicState.serverTime - SNAPSHOT_PULSE_STALE_MS - 1
    };

    const hydrated = hydrateSnapshotPulses([futurePulse, stalePulse, goodPulse], publicState.serverTime);

    expect(hydrated.map((pulse) => pulse.id)).toEqual(['pulse-current']);
  });

  it('updates sanitized activity and packet stats from public websocket events', () => {
    const state = initialAppState(publicState);
    const message: PublicLiveEnvelope = {
      v: 1,
      type: 'event',
      event: 'activity',
      data: {
        id: 'activity-2',
        kind: 'packet',
        payloadTypeName: 'PLAIN_TEXT',
        routeTypeName: 'FLOOD',
        iata: 'YYZ',
        heardAt: 1_700_000_010_000,
        hopCount: 0,
        hasRoute: false,
        animationState: 'observer',
        resolutionBucket: 'observer_only',
        observerLocation: { label: 'Toronto observer', iata: 'YYZ', lat: 43.65, lng: -79.38 }
      }
    };

    const next = applyPublicEnvelope(state, message);

    expect(next.activity[0].id).toBe('activity-2');
    expect(next.observerBursts[0].id).toBe('observer-activity-2');
    expect(next.stats?.packets).toBe(11);
    expect(JSON.stringify(next)).not.toMatch(/packetHash|publicKey|pathHex|observerPublicKey|summary|resolutionReason/);
  });

  it('upserts route pulses and keeps route buckets normalized', () => {
    const state = initialAppState(publicState);
    const message: PublicLiveEnvelope = {
      v: 1,
      type: 'event',
      event: 'routePulse',
      seq: 42,
      serverTime: 1_700_000_030_000,
      receivedAt: 1_700_000_030_000,
      displayAt: 1_700_000_030_150,
      data: {
        id: 'pulse-2',
        payloadTypeName: 'ADVERT',
        heardAt: 1_700_000_020_000,
        segments: [
          {
            routeId: 'r-ab',
            from: { nodeId: 'node-a', label: 'Kitchener Repeater', lat: 43.45, lng: -80.49 },
            to: { nodeId: 'node-b', label: 'Toronto Room', lat: 43.65, lng: -79.38 },
            distanceKm: 93
          }
        ]
      }
    };

    const next = applyPublicEnvelope(state, message);

    expect(next.routes[0].packetCount).toBe(8);
    expect(next.routes[0].lastHeard).toBe(1_700_000_020_000);
    expect(next.pulses).toHaveLength(1);
    expect(next.pulses[0].receivedAt).toBe(1_700_000_030_000);
    expect(next.pulses[0].displayAt).toBe(1_700_000_030_150);
    expect(next.pulses[0].seq).toBe(42);
    expect(next.routeTraces).toHaveLength(1);
    expect(next.stats?.activeRoutes).toBe(1);
  });

  it('dedupes live events after websocket reconnect recovery', () => {
    const state = initialAppState(publicState);
    const activityMessage: PublicLiveEnvelope = {
      v: 1,
      type: 'event',
      event: 'activity',
      data: {
        id: 'activity-reconnect',
        kind: 'packet',
        payloadTypeName: 'ADVERT',
        heardAt: 1_700_000_020_000,
        hopCount: 0,
        hasRoute: false,
        animationState: 'observer',
        resolutionBucket: 'observer_only',
        observerLocation: { label: 'Toronto observer', iata: 'YYZ', lat: 43.65, lng: -79.38 }
      }
    };
    const pulseMessage: PublicLiveEnvelope = {
      v: 1,
      type: 'event',
      event: 'routePulse',
      data: {
        id: 'pulse-reconnect',
        payloadTypeName: 'ADVERT',
        heardAt: 1_700_000_030_000,
        segments: [
          {
            routeId: 'r-ab',
            from: publicState.routes[0].from,
            to: publicState.routes[0].to,
            distanceKm: 93
          }
        ]
      }
    };

    const once = applyPublicEnvelope(applyPublicEnvelope(state, activityMessage), pulseMessage);
    const twice = applyPublicEnvelope(applyPublicEnvelope(once, activityMessage), pulseMessage);

    expect(twice.activity.filter((item) => item.id === 'activity-reconnect')).toHaveLength(1);
    expect(twice.pulses.filter((item) => item.id === 'pulse-reconnect')).toHaveLength(1);
    expect(twice.routes.find((route) => route.id === 'r-ab')?.packetCount).toBe(8);
  });

  it('summarizes and prunes route activity into last-15-minute bins', () => {
    const now = 1_700_000_900_000;
    const state = initialAppState(publicState);
    const next = applyPublicEnvelope(
      {
        ...state,
        routeTraces: [
          {
            routeId: 'r-ab',
            heardAt: now - ROUTE_TRACE_WINDOW_MS - 1,
            payloadTypeName: 'ADVERT',
            from: publicState.routes[0].from,
            to: publicState.routes[0].to,
            distanceKm: 93
          }
        ]
      },
      {
        v: 1,
        type: 'event',
        event: 'routePulse',
        data: {
          id: 'pulse-3',
          payloadTypeName: 'ADVERT',
          heardAt: now,
          segments: [
            {
              routeId: 'r-ab',
              from: publicState.routes[0].from,
              to: publicState.routes[0].to,
              distanceKm: 93
            }
          ]
        }
      }
    );

    expect(next.routeTraces).toHaveLength(1);
    const summary = summarizeRouteActivity(next.routeTraces, now).get('r-ab');
    expect(summary?.total).toBe(1);
    expect(summary?.bins).toHaveLength(ROUTE_TRACE_BIN_COUNT);
    expect(summary?.bins[ROUTE_TRACE_BIN_COUNT - 1]).toBe(1);
  });

  it('derives current packet rate from recent sanitized activity', () => {
    const now = 1_700_000_100_000;

    expect(
      currentPacketRatePerMinute(
        [
          { id: 'new-1', kind: 'packet', payloadTypeName: 'ADVERT', heardAt: now - 1000, hopCount: 0, hasRoute: false, animationState: 'observer', resolutionBucket: 'observer_only' },
          { id: 'new-2', kind: 'packet', payloadTypeName: 'ADVERT', heardAt: now - 59_000, hopCount: 0, hasRoute: false, animationState: 'unmapped', resolutionBucket: 'missing_location' },
          { id: 'old', kind: 'packet', payloadTypeName: 'ADVERT', heardAt: now - 61_000, hopCount: 0, hasRoute: false, animationState: 'unmapped', resolutionBucket: 'unresolved_path' },
          { id: 'route', kind: 'route', payloadTypeName: 'ADVERT', heardAt: now - 1000, hopCount: 0, hasRoute: true, animationState: 'route', resolutionBucket: 'routed' }
        ],
        now
      )
    ).toBe(3);
  });

  it('derives live coverage counters by animation outcome', () => {
    const now = 1_700_000_100_000;
    const coverage = liveCoverageStats(
      [
        { id: 'route', kind: 'packet', payloadTypeName: 'ADVERT', heardAt: now - 1000, hopCount: 0, hasRoute: true, animationState: 'route', resolutionBucket: 'routed' },
        { id: 'observer', kind: 'packet', payloadTypeName: 'ADVERT', heardAt: now - 2000, hopCount: 0, hasRoute: false, animationState: 'observer', resolutionBucket: 'observer_only' },
        { id: 'unmapped', kind: 'packet', payloadTypeName: 'ADVERT', heardAt: now - 3000, hopCount: 0, hasRoute: false, animationState: 'unmapped', resolutionBucket: 'missing_location' },
        { id: 'old', kind: 'packet', payloadTypeName: 'ADVERT', heardAt: now - 70_000, hopCount: 0, hasRoute: false, animationState: 'unmapped', resolutionBucket: 'unresolved_path' }
      ],
      now
    );

    expect(coverage.receivedPerMinute).toBe(3);
    expect(coverage.routeAnimatedPerMinute).toBe(1);
    expect(coverage.observerBurstPerMinute).toBe(1);
    expect(coverage.unmappedPerMinute).toBe(1);
    expect(coverage.lastPacketAgeMs).toBe(1000);
  });

  it('tracks and prunes observer burst memory', () => {
    const now = 1_700_000_100_000;
    const burst = addObserverBurst(
      [],
      {
        id: 'activity-observer',
        kind: 'packet',
        payloadTypeName: 'PLAIN_TEXT',
        heardAt: now,
        hopCount: 0,
        hasRoute: false,
        animationState: 'observer',
        resolutionBucket: 'observer_only',
        observerLocation: { label: 'YYZ observer', iata: 'YYZ', lat: 43.65, lng: -79.38 },
        messageSender: 'Alice',
        messageText: 'observer text',
        messageAnchor: { kind: 'observer', label: 'YYZ observer', lat: 43.65, lng: -79.38 }
      },
      now
    );

    expect(burst).toHaveLength(1);
    expect(burst[0].messageText).toBe('observer text');
    expect(burst[0].messageAnchor?.kind).toBe('observer');
    expect(pruneObserverBursts(burst, now + 15 * 60_000 + 1)).toHaveLength(0);
  });

  it('filters search by label, role, and IATA while preserving route context', () => {
    const state = initialAppState(publicState);

    expect(filterNodes(state.nodes, 'repeater')).toHaveLength(1);
    expect(filterNodes(state.nodes, 'YYZ')).toHaveLength(1);

    const visibleNodeIDs = new Set(filterNodes(state.nodes, 'room').map((node) => node.id));
    expect(filterRoutes(state.routes, visibleNodeIDs, 'room')).toHaveLength(1);
  });
});
