import { describe, expect, it } from 'vitest';
import type { PublicRoute, PublicRouteEndpoint } from '../types';
import type { NodeFocus } from './nodeFocus';
import {
  pruneRoutePayloadGlows,
  routeActivityOpacity,
  routeActivityWidth,
  routeColorSignature,
  routeHighlightColor,
  routeFreshnessLevel,
  routeFreshnessOpacity,
  routePayloadGlowsToGeoJSON,
  routeSourceSignature,
  routesToGeoJSON,
  type RoutePayloadGlow
} from './routeSource';

const endpoint = (nodeId: string, lat = 43, lng = -79): PublicRouteEndpoint => ({
  nodeId,
  label: nodeId.toUpperCase(),
  lat,
  lng,
  pathHash3: `${nodeId}${nodeId}${nodeId}${nodeId}${nodeId}${nodeId}`.slice(0, 6).toUpperCase()
});

const route = (id: string, from: string, to: string, bucket = 1, packetCount = 10, lastHeard = 100): PublicRoute => ({
  id,
  from: endpoint(from),
  to: endpoint(to),
  distanceKm: 1,
  packetCount,
  lastHeard,
  frequencyBucket: bucket,
  payloadTypeNames: ['GROUP_TEXT']
});

const focus = (overrides: Partial<NodeFocus> = {}): NodeFocus => ({
  selectedNodeID: null,
  connectedRouteIDs: new Set(),
  neighbourNodeIDs: new Set(),
  pathRouteIDs: new Set(),
  pathNodeIDs: new Set(),
  neighbourDistanceKmByNodeID: new Map(),
  ...overrides
});

describe('route source helpers', () => {
  it('ignores volatile route counters in render signatures', () => {
    const base = [route('a-b', 'a', 'b', 1, 10, 100)];
    const updatedCounters = [route('a-b', 'a', 'b', 1, 999, 5000)];
    const updatedBucket = [route('a-b', 'a', 'b', 2, 999, 5000)];

    expect(routeSourceSignature(base, null, focus())).toBe(routeSourceSignature(updatedCounters, null, focus()));
    expect(routeSourceSignature(base, null, focus())).not.toBe(routeSourceSignature(updatedBucket, null, focus()));
  });

  it('ignores live route sort order churn in render signatures', () => {
    const first = [route('a-b', 'a', 'b', 1), route('c-d', 'c', 'd', 2)];
    const reordered = [route('c-d', 'c', 'd', 2, 500), route('a-b', 'a', 'b', 1, 10)];

    expect(routeSourceSignature(first, null, focus())).toBe(routeSourceSignature(reordered, null, focus()));
    expect(routeColorSignature(first)).toBe(routeColorSignature(reordered));
  });

  it('includes focus state in render signatures', () => {
    const routes = [route('a-b', 'a', 'b')];

    expect(routeSourceSignature(routes, null, focus())).not.toBe(
      routeSourceSignature(routes, null, focus({ selectedNodeID: 'a', connectedRouteIDs: new Set(['a-b']) }))
    );
  });

  it('marks connected routes and dims unrelated routes', () => {
    const data = routesToGeoJSON(
      [route('a-b', 'a', 'b'), route('c-d', 'c', 'd')],
      null,
      focus({ selectedNodeID: 'a', connectedRouteIDs: new Set(['a-b']) })
    );

    expect(data.features[0].properties).toMatchObject({ id: 'a-b', connected: true, dimmed: false });
    expect(data.features[1].properties).toMatchObject({ id: 'c-d', connected: false, dimmed: true });
  });

  it('uses darker semantic route colors in light mode', () => {
    const data = routesToGeoJSON(
      [route('a-b', 'a', 'b'), route('c-d', 'c', 'd')],
      null,
      focus({ selectedNodeID: 'a', connectedRouteIDs: new Set(['a-b']), pathRouteIDs: new Set(['c-d']) }),
      Date.now(),
      'light'
    );

    expect(data.features[0].properties).toMatchObject({ id: 'a-b', color: routeHighlightColor('connected', 'light') });
    expect(data.features[1].properties).toMatchObject({ id: 'c-d', color: routeHighlightColor('path', 'light') });
  });

  it('renders route geometry as densified arc coordinates', () => {
    const data = routesToGeoJSON([{
      ...route('long', 'a', 'b'),
      from: endpoint('a', 43.65, -79.38),
      to: endpoint('b', 49.28, -123.12),
      distanceKm: 3350
    }], null, focus());
    const geometry = data.features[0].geometry as { type: string; coordinates: Array<[number, number]> };

    expect(geometry.type).toBe('LineString');
    expect(geometry.coordinates.length).toBeGreaterThan(2);
    expect(geometry.coordinates[0]).toEqual([-79.38, 43.65]);
    expect(geometry.coordinates[geometry.coordinates.length - 1]).toEqual([-123.12, 49.28]);
  });

  it('builds payload glow GeoJSON only for active route glows', () => {
    const now = 1000;
    const glows = new Map<string, RoutePayloadGlow>([
      ['a-b', { color: '#22c55e', startedAt: now - 100, expiresAt: now + 900 }],
      ['missing', { color: '#ef4444', startedAt: now - 100, expiresAt: now + 900 }]
    ]);

    const data = routePayloadGlowsToGeoJSON([route('a-b', 'a', 'b')], glows, null, focus(), now);

    expect(data.features).toHaveLength(1);
    expect(data.features[0].properties).toMatchObject({ id: 'a-b', color: '#22c55e' });
  });

  it('prunes expired payload glows', () => {
    const glows = new Map<string, RoutePayloadGlow>([
      ['a-b', { color: '#22c55e', startedAt: 0, expiresAt: 10 }],
      ['b-c', { color: '#38bdf8', startedAt: 95, expiresAt: 200 }]
    ]);

    expect(pruneRoutePayloadGlows(glows, 100)).toBe(1);
    expect([...glows.keys()]).toEqual(['b-c']);
  });

  it('tracks route color changes separately from packet counters', () => {
    expect(routeColorSignature([route('a-b', 'a', 'b', 1, 10)])).toBe(routeColorSignature([route('a-b', 'a', 'b', 1, 999)]));
    expect(routeColorSignature([route('a-b', 'a', 'b', 1)])).not.toBe(routeColorSignature([route('a-b', 'a', 'b', 3)]));
  });

  it('adds subtle freshness levels without changing selected route behavior', () => {
    const now = 3_700_000;
    const fresh = route('fresh', 'a', 'b', 1, 10, now - 60_000);
    const old = route('old', 'c', 'd', 1, 10, now - 2 * 60 * 60_000);
    const data = routesToGeoJSON([fresh, old], null, focus(), now);

    expect(routeFreshnessLevel(fresh.lastHeard, now)).toBe(0);
    expect(routeFreshnessOpacity(old.lastHeard, now)).toBeLessThan(1);
    expect(data.features[0].properties).toMatchObject({ freshnessLevel: 0, freshnessOpacity: 1 });
    expect((data.features[1].properties as { freshnessOpacity: number }).freshnessOpacity).toBeLessThan(1);
    expect(routeSourceSignature([fresh], null, focus(), now)).not.toBe(
      routeSourceSignature([{ ...fresh, lastHeard: now - 2 * 60 * 60_000 }], null, focus(), now)
    );
  });

  it('thickens and brightens recently active high-frequency routes while cooling stale routes', () => {
    const now = 5_000_000;
    const freshBusy = route('busy', 'a', 'b', 4, 900, now - 30_000);
    const staleQuiet = route('quiet', 'c', 'd', 0, 10, now - 8 * 60 * 60_000);
    const data = routesToGeoJSON([freshBusy, staleQuiet], null, focus(), now);

    expect(routeActivityWidth(freshBusy, now)).toBeGreaterThan(routeActivityWidth(staleQuiet, now));
    expect(routeActivityOpacity(freshBusy, now)).toBeGreaterThan(routeActivityOpacity(staleQuiet, now));
    expect(data.features[0].properties).toMatchObject({
      id: 'busy',
      routeWidth: routeActivityWidth(freshBusy, now),
      routeOpacity: routeActivityOpacity(freshBusy, now)
    });
  });
});
