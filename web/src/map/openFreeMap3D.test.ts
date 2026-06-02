import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_LAYER_SETTINGS, DEFAULT_PACKET_VISUAL_SETTINGS } from '../mapSettings';
import type { PublicNode, PublicRoute } from '../types';
import { emptyNodeFocus } from './nodeFocus';
import {
  OPENFREEMAP_3D_LAYER_ID,
  buildCometSegmentPaths,
  createOpenFreeMap3DController,
  nodeModelLOD,
  nodeModelKind,
  openFreeMap3DCometBudget,
  openFreeMap3DFrameInterval,
  openFreeMap3DNodeBudget,
  openFreeMap3DObserverGlowBudget,
  openFreeMap3DRouteBudget,
  routeArcRadialSegments,
  routeArcTubularSegments,
  selectOpenFreeMap3DNodes,
  selectOpenFreeMap3DRoutes,
  type OpenFreeMap3DUpdate
} from './openFreeMap3D';

describe('OpenFreeMap 3D layer helpers', () => {
  it('maps public node roles to procedural model kinds', () => {
    expect(nodeModelKind({ role: 'repeater' })).toBe('repeater');
    expect(nodeModelKind({ role: 'companion' })).toBe('companion');
    expect(nodeModelKind({ role: 'room_server' })).toBe('room');
    expect(nodeModelKind({ role: 'sensor' })).toBe('other');
    expect(nodeModelKind({ role: 'repeater', isObserver: true })).toBe('observer');
  });

  it('creates a MapLibre custom 3D layer controller', () => {
    const controller = createOpenFreeMap3DController();

    expect(controller.layer.id).toBe(OPENFREEMAP_3D_LAYER_ID);
    expect(controller.layer.type).toBe('custom');
    expect((controller.layer as { renderingMode?: string }).renderingMode).toBe('3d');
    controller.destroy();
  });

  it('selects only visible detail nodes for 3D models', () => {
    const input = updateInput({
      nodes: [
        node('visible', 43.6, -79.4, 2),
        node('focused', 43.7, -79.5, 1),
        node('outside', 48, -90, 999)
      ],
      focus: { ...emptyNodeFocus(), selectedNodeID: 'focused' }
    });

    const selected = selectOpenFreeMap3DNodes(mapViewport(9, -80, 43, -78, 44), input, 2);

    expect(selected.map((item) => item.id)).toEqual(['focused', 'visible']);
  });

  it('uses adaptive 3D node budgets and keeps focus nodes on full model LOD', () => {
    expect(openFreeMap3DNodeBudget(6.9)).toBe(0);
    expect(openFreeMap3DNodeBudget(7.2)).toBeLessThan(openFreeMap3DNodeBudget(10.5));
    expect(openFreeMap3DNodeBudget(13, 'balanced')).toBeLessThan(openFreeMap3DNodeBudget(13, 'high'));
    expect(openFreeMap3DNodeBudget(13, 'high')).toBeGreaterThanOrEqual(630);

    const focus = { ...emptyNodeFocus(), selectedNodeID: 'selected', pathNodeIDs: new Set(['path']) };

    expect(nodeModelLOD(node('ordinary', 43.6, -79.4, 5), focus, 7.4)).toBe('marker');
    expect(nodeModelLOD(node('selected', 43.6, -79.4, 5), focus, 7.4)).toBe('full');
    expect(nodeModelLOD(node('path', 43.6, -79.4, 5), focus, 7.4)).toBe('full');
    expect(nodeModelLOD(node('ordinary-high', 43.6, -79.4, 5), focus, 10)).toBe('full');
  });

  it('uses adaptive 3D route budgets so low zoom route arcs stay bounded', () => {
    expect(openFreeMap3DRouteBudget(5)).toBeLessThan(openFreeMap3DRouteBudget(9));
    expect(openFreeMap3DRouteBudget(9)).toBeLessThan(openFreeMap3DRouteBudget(12));
    expect(openFreeMap3DRouteBudget(13, 'smooth')).toBeLessThan(openFreeMap3DRouteBudget(13, 'balanced'));
    expect(openFreeMap3DRouteBudget(13, 'high')).toBeGreaterThanOrEqual(760);
    expect(openFreeMap3DCometBudget('smooth')).toBeLessThan(openFreeMap3DCometBudget('high'));
    expect(openFreeMap3DObserverGlowBudget('smooth')).toBeLessThan(openFreeMap3DObserverGlowBudget('high'));
    expect(openFreeMap3DFrameInterval('smooth')).toBeGreaterThan(openFreeMap3DFrameInterval('balanced'));
    expect(openFreeMap3DFrameInterval('balanced')).toBeGreaterThan(openFreeMap3DFrameInterval('high'));
    expect(openFreeMap3DFrameInterval('high')).toBeLessThanOrEqual(17);
  });

  it('keeps fresh or focused 3D routes without including every offscreen route', () => {
    const now = 1_700_000_000_000;
    const input = updateInput({
      selectedRouteID: 'focused-route',
      routes: [
        route('visible-old', 43.6, -79.4, 43.7, -79.5, now - 20 * 60_000),
        route('fresh-offscreen', 48, -90, 48.5, -90.5, now - 10_000),
        route('focused-route', 49, -100, 49.5, -100.5, now - 2 * 60 * 60_000),
        route('stale-offscreen', 51, -105, 51.5, -105.5, now - 2 * 60 * 60_000)
      ]
    });

    const selected = selectOpenFreeMap3DRoutes(mapViewport(9, -80, 43, -78, 44), input, now, 10);

    expect(selected.map((item) => item.id)).toEqual(['focused-route', 'fresh-offscreen', 'visible-old']);
  });

  it('uses cheaper route arc geometry for ordinary arcs while preserving selected emphasis', () => {
    expect(routeArcRadialSegments(1)).toBe(3);
    expect(routeArcRadialSegments(1.35)).toBe(3);
    expect(routeArcRadialSegments(1.85)).toBe(4);
    expect(routeArcRadialSegments(1.85, 'high')).toBe(5);
    expect(routeArcTubularSegments(34, 1, 'smooth')).toBeLessThan(routeArcTubularSegments(34, 1, 'high'));
    expect(routeArcTubularSegments(34, 1)).toBeLessThan(routeArcTubularSegments(34, 1.85));
    expect(routeArcTubularSegments(8, 1)).toBeGreaterThanOrEqual(4);
  });

  it('precomputes 3D comet arc vectors once per route segment', () => {
    const paths = buildCometSegmentPaths([
      {
        routeId: 'route-a',
        from: { nodeId: 'a', label: 'A', lat: 43.6, lng: -79.4 },
        to: { nodeId: 'b', label: 'B', lat: 43.8, lng: -79.7 },
        distanceKm: 28
      },
      {
        routeId: 'route-b',
        from: { nodeId: 'b', label: 'B', lat: 43.8, lng: -79.7 },
        to: { nodeId: 'c', label: 'C', lat: 44.1, lng: -80 },
        distanceKm: 45
      }
    ], 1.2);

    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path.samples.length).toBeGreaterThanOrEqual(8);
      expect(path.vectors).toHaveLength(path.samples.length);
      expect(path.vectors[0].x).toBeTypeOf('number');
      expect(path.vectors[0].z).toBeTypeOf('number');
    }
  });
});

function mapViewport(zoom: number, west: number, south: number, east: number, north: number): any {
  return {
    getZoom: () => zoom,
    getBounds: () => ({
      getWest: () => west,
      getSouth: () => south,
      getEast: () => east,
      getNorth: () => north
    })
  };
}

function updateInput(overrides: Partial<OpenFreeMap3DUpdate> = {}): OpenFreeMap3DUpdate {
  return {
    nodes: [],
    routes: [],
    focus: emptyNodeFocus(),
    selectedRouteID: null,
    analysisSegments: [],
    layerSettings: DEFAULT_MAP_LAYER_SETTINGS,
    packetVisualSettings: DEFAULT_PACKET_VISUAL_SETTINGS,
    themeMode: 'dark',
    ...overrides
  };
}

function node(id: string, latitude: number, longitude: number, activityCount: number): PublicNode {
  return {
    id,
    label: id,
    role: 'repeater',
    latitude,
    longitude,
    lastSeen: 1,
    firstSeen: 1,
    iatasHeardIn: ['YKF'],
    activityCount
  };
}

function route(id: string, fromLat: number, fromLng: number, toLat: number, toLng: number, lastHeard: number): PublicRoute {
  return {
    id,
    from: { nodeId: `${id}-from`, label: `${id} from`, lat: fromLat, lng: fromLng },
    to: { nodeId: `${id}-to`, label: `${id} to`, lat: toLat, lng: toLng },
    distanceKm: 15,
    packetCount: 10,
    lastHeard,
    frequencyBucket: 2,
    payloadTypeNames: ['GROUP_TEXT']
  };
}
