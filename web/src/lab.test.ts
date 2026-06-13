import { describe, expect, it } from 'vitest';
import {
  LAB_EXPERIMENTS,
  buildSequencerPattern,
  eventPitchHz,
  eventStereoPan,
  labExperimentIDFromHash,
  labExperimentPath,
  labEventsFromState,
  labMetrics,
  regionCells,
  routeOrganismRoutes
} from './lab';
import type { AppState } from './state';
import type { PublicRoute } from './types';

describe('labs data helpers', () => {
  const now = 1_700_000_000_000;

  it('normalizes public activity and route pulses into lab events', () => {
    const state = stateWithTraffic(now);
    const events = labEventsFromState(state);

    expect(LAB_EXPERIMENTS.map((item) => item.id)).toContain('fireflies');
    expect(LAB_EXPERIMENTS.every((item) => item.path === `#/lab/${item.id}`)).toBe(true);
    expect(LAB_EXPERIMENTS.every((item) => item.tagline.length > 8 && item.signal.length > 8 && item.cues.length === 3)).toBe(true);
    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining(['routed', 'observer']));
    expect(events[0].displayAt).toBeGreaterThanOrEqual(events.at(-1)?.displayAt ?? 0);
    expect(events.find((event) => event.source === 'routePulse')?.distanceKm).toBeCloseTo(42.5);
    expect(events.find((event) => event.messageText)?.messageText).toBe('hello public');
  });

  it('builds live metrics, sequencer steps, route organism inputs, and radar cells', () => {
    const state = stateWithTraffic(now);
    const events = labEventsFromState(state);
    const metrics = labMetrics(events, state.nodes, state.routes, now);
    const pattern = buildSequencerPattern(events, now, 16, 60_000);
    const organism = routeOrganismRoutes(state.routes, events, now);
    const cells = regionCells(events, now);

    expect(metrics.packetRatePerMinute).toBeGreaterThan(0);
    expect(metrics.routedPerMinute).toBeGreaterThan(0);
    expect(metrics.observerPerMinute).toBeGreaterThan(0);
    expect(metrics.payloadMix[0].count).toBeGreaterThan(0);
    expect(pattern.steps).toHaveLength(16);
    expect(pattern.steps.some((step) => step.count > 0)).toBe(true);
    expect(organism[0]).toMatchObject({ id: 'route-a-b', distanceKm: 42.5 });
    expect(cells.map((cell) => cell.region)).toContain('CA');
  });

  it('maps packet properties into stable audio parameters', () => {
    const event = labEventsFromState(stateWithTraffic(now))[0];
    expect(eventPitchHz(event)).toBeGreaterThan(80);
    expect(eventPitchHz(event)).toBeLessThanOrEqual(1440);
    expect(eventStereoPan(event)).toBeGreaterThanOrEqual(-0.9);
    expect(eventStereoPan(event)).toBeLessThanOrEqual(0.9);
  });

  it('parses routed lab experiment hashes safely', () => {
    expect(labExperimentPath('radar')).toBe('#/lab/radar');
    expect(labExperimentIDFromHash('#/lab/fireflies')).toBe('fireflies');
    expect(labExperimentIDFromHash('#/lab/nope')).toBe('synth');
    expect(labExperimentIDFromHash('#/packets')).toBe('synth');
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
