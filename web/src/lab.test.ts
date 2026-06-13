import { describe, expect, it } from 'vitest';
import {
  LAB_EXPERIMENTS,
  WATERFALL_LAB_PATH,
  canonicalLabHash,
  eventPitchHz,
  eventStereoPan,
  filterLabEventsByPayload,
  labExperimentIDFromHash,
  labExperimentPath,
  labEventsFromState,
  labMetrics,
  waterfallLanes
} from './lab';
import type { AppState } from './state';
import type { PublicRoute } from './types';

describe('waterfall labs data helpers', () => {
  const now = 1_700_000_000_000;

  it('normalizes public activity and route pulses into waterfall events', () => {
    const state = stateWithTraffic(now);
    const events = labEventsFromState(state);

    expect(LAB_EXPERIMENTS.map((item) => item.id)).toEqual(['waterfall']);
    expect(LAB_EXPERIMENTS[0].path).toBe(WATERFALL_LAB_PATH);
    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining(['routed', 'observer']));
    expect(events[0].displayAt).toBeGreaterThanOrEqual(events.at(-1)?.displayAt ?? 0);
    expect(events.find((event) => event.source === 'routePulse')?.distanceKm).toBeCloseTo(42.5);
    expect(events.find((event) => event.messageText)?.messageText).toBe('hello public');
  });

  it('builds live metrics and payload waterfall lanes', () => {
    const state = stateWithTraffic(now);
    const events = labEventsFromState(state);
    const metrics = labMetrics(events, now, 60_000);
    const lanes = waterfallLanes(events, now, 60_000);

    expect(metrics.packetRatePerMinute).toBeGreaterThan(0);
    expect(metrics.routedPerMinute).toBeGreaterThan(0);
    expect(metrics.observerPerMinute).toBeGreaterThan(0);
    expect(metrics.payloadMix[0].count).toBeGreaterThan(0);
    expect(lanes.length).toBeGreaterThan(0);
    expect(lanes.some((lane) => lane.routed > 0)).toBe(true);
    expect(lanes.some((lane) => lane.observer > 0)).toBe(true);
    expect(filterLabEventsByPayload(events, lanes[0].payloadTypeName).every((event) => event.payloadTypeName === lanes[0].payloadTypeName)).toBe(true);
  });

  it('maps packet properties into stable ambient audio parameters', () => {
    const event = labEventsFromState(stateWithTraffic(now))[0];
    expect(eventPitchHz(event)).toBeGreaterThan(70);
    expect(eventPitchHz(event)).toBeLessThanOrEqual(1760);
    expect(eventStereoPan(event)).toBeGreaterThanOrEqual(-0.9);
    expect(eventStereoPan(event)).toBeLessThanOrEqual(0.9);
  });

  it('redirects old Labs experiment hashes to Waterfall', () => {
    expect(labExperimentPath('waterfall')).toBe(WATERFALL_LAB_PATH);
    expect(labExperimentIDFromHash('#/lab/waterfall')).toBe('waterfall');
    expect(canonicalLabHash('#/lab')).toBe(WATERFALL_LAB_PATH);
    expect(canonicalLabHash('#/lab/synth')).toBe(WATERFALL_LAB_PATH);
    expect(canonicalLabHash('#/lab/fireflies')).toBe(WATERFALL_LAB_PATH);
    expect(canonicalLabHash('#/packets')).toBeNull();
  });
});

function stateWithTraffic(now: number): Pick<AppState, 'activity' | 'pulses' | 'nodes' | 'routes'> {
  const route: PublicRoute = {
    id: 'route-a-b',
    from: { nodeId: 'a', label: 'Alpha', lat: 43.6, lng: -79.4, pathHash3: 'abc123' },
    to: { nodeId: 'b', label: 'Bravo', lat: 43.9, lng: -79.8, pathHash3: 'def456' },
    distanceKm: 42.5,
    packetCount: 8,
    lastHeard: now - 3_000,
    frequencyBucket: 3,
    payloadTypeNames: ['PLAIN_TEXT']
  };
  return {
    nodes: [
      { id: 'a', label: 'Alpha', role: 'repeater', latitude: 43.6, longitude: -79.4, lastSeen: now - 2_000, firstSeen: now - 30_000, iatasHeardIn: ['YYZ'], activityCount: 12 },
      { id: 'b', label: 'Bravo', role: 'companion', latitude: 43.9, longitude: -79.8, lastSeen: now - 4_000, firstSeen: now - 30_000, iatasHeardIn: ['YYZ'], activityCount: 6 }
    ],
    routes: [route],
    activity: [
      {
        id: 'act-routed',
        kind: 'packet',
        payloadTypeName: 'PLAIN_TEXT',
        heardAt: now - 4_000,
        displayAt: now - 3_500,
        hopCount: 2,
        hasRoute: true,
        animationState: 'route',
        resolutionBucket: 'routed',
        region: 'CA',
        iata: 'YYZ',
        routeIds: ['route-a-b'],
        endpointLabels: ['Alpha', 'Bravo'],
        messageSender: 'Alpha',
        messageText: 'hello public',
        messageAnchor: { kind: 'source', nodeId: 'a', label: 'Alpha', lat: 43.6, lng: -79.4 }
      },
      {
        id: 'act-observer',
        kind: 'packet',
        payloadTypeName: 'ADVERT',
        heardAt: now - 12_000,
        displayAt: now - 11_500,
        hopCount: 0,
        hasRoute: false,
        animationState: 'observer',
        resolutionBucket: 'observer_only',
        region: 'CA',
        observerLocation: { label: 'YYZ observer', iata: 'YYZ', region: 'CA', lat: 43.65, lng: -79.38 }
      }
    ],
    pulses: [
      {
        id: 'pulse-a-b',
        payloadTypeName: 'PLAIN_TEXT',
        heardAt: now - 3_000,
        displayAt: now - 2_700,
        region: 'CA',
        iata: 'YYZ',
        messageSender: 'Alpha',
        messageText: 'hello public',
        segments: [{ routeId: 'route-a-b', from: route.from, to: route.to, distanceKm: route.distanceKm }]
      }
    ]
  };
}
