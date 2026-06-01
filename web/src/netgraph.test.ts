import { describe, expect, it } from 'vitest';
import {
  buildNetGraphData,
  graphSearchMatches,
  observerActivityToGraphGlow,
  routePulseToGraphComets,
  selectedNeighborhood,
  selectionForEdge,
  selectionForNode
} from './netgraph';
import { buildEdgeRenderPlans, edgeControlPoint, stableVisibleGraph } from './netgraphLayout';
import type { PublicActivity, PublicNode, PublicRoute, PublicRoutePulse } from './types';

const nodes: PublicNode[] = [
  node('a', 'Alpha', 45, -75, 'repeater'),
  node('b', 'Bravo Observer', 46, -76, 'room_server', true),
  node('c', 'Charlie', 47, -77, 'companion'),
  node('orphan', 'Orphan', 48, -78, 'repeater')
];

const routes: PublicRoute[] = [
  route('r1', 'a', 'Alpha', 45, -75, 'b', 'Bravo Observer', 46, -76, 8),
  route('r1', 'a', 'Alpha duplicate', 45, -75, 'b', 'Bravo Observer', 46, -76, 1),
  route('r2', 'b', 'Bravo Observer', 46, -76, 'c', 'Charlie', 47, -77, 4)
];

describe('netgraph helpers', () => {
  it('builds connected graph nodes and excludes route-less public nodes', () => {
    const graph = buildNetGraphData(nodes, routes);
    expect(graph.nodes.map((item) => item.id).sort()).toEqual(['a', 'b', 'c']);
    expect(graph.edges.map((item) => item.id).sort()).toEqual(['r1', 'r2']);
    expect(graph.nodeByID.get('orphan')).toBeUndefined();
    expect(graph.nodeByID.get('b')).toMatchObject({ label: 'Bravo Observer', isObserver: true, degree: 2 });
  });

  it('returns direct neighbor and edge highlights for node and edge selections', () => {
    const graph = buildNetGraphData(nodes, routes);
    expect([...selectionForNode(graph, 'b').nodeIDs].sort()).toEqual(['a', 'b', 'c']);
    expect([...selectionForNode(graph, 'b').edgeIDs].sort()).toEqual(['r1', 'r2']);
    expect([...selectionForEdge(graph, 'r1').nodeIDs].sort()).toEqual(['a', 'b']);
    expect([...selectionForEdge(graph, 'r1').edgeIDs]).toEqual(['r1']);
  });

  it('derives a stable visible graph when only packet and activity metadata changes', () => {
    const graph = buildNetGraphData(nodes, routes);
    const noisyNodes = nodes.map((item) => ({
      ...item,
      activityCount: item.id === 'c' ? 999 : 0,
      lastSeen: item.lastSeen + 5000
    }));
    const noisyRoutes = routes.map((item) => ({
      ...item,
      packetCount: item.id === 'r2' ? 999 : 1,
      lastHeard: item.lastHeard + 5000,
      payloadTypeNames: [...item.payloadTypeNames, 'NODEINFO_APP']
    }));
    const noisyGraph = buildNetGraphData(noisyNodes, noisyRoutes);

    const visible = stableVisibleGraph(graph, { maxNodes: 2, maxEdges: 2 });
    const noisyVisible = stableVisibleGraph(noisyGraph, { maxNodes: 2, maxEdges: 2 });

    expect(visible.nodes.map((item) => item.id)).toEqual(noisyVisible.nodes.map((item) => item.id));
    expect(visible.edges.map((item) => item.id)).toEqual(noisyVisible.edges.map((item) => item.id));
  });

  it('builds a selected 1-hop neighborhood graph', () => {
    const graph = buildNetGraphData(nodes, routes);
    const neighborhood = selectedNeighborhood(graph, 'b');

    expect(neighborhood.nodes.map((item) => item.id).sort()).toEqual(['a', 'b', 'c']);
    expect(neighborhood.edges.map((item) => item.id).sort()).toEqual(['r1', 'r2']);
    expect(selectedNeighborhood(graph, 'missing').nodes).toEqual([]);
  });

  it('assigns deterministic edge lanes for shared endpoint corridors', () => {
    const sharedRoutes = [
      route('route-c', 'a', 'Alpha', 45, -75, 'b', 'Bravo Observer', 46, -76, 3),
      route('route-a', 'a', 'Alpha', 45, -75, 'b', 'Bravo Observer', 46, -76, 2),
      route('route-b', 'b', 'Bravo Observer', 46, -76, 'a', 'Alpha', 45, -75, 1)
    ];
    const graph = buildNetGraphData(nodes, sharedRoutes);
    const plans = buildEdgeRenderPlans(graph.edges);
    const reorderedPlans = buildEdgeRenderPlans(buildNetGraphData(nodes, sharedRoutes.slice().reverse()).edges);

    expect([...plans.values()].map((plan) => [plan.edgeID, plan.laneIndex, plan.laneCount, plan.laneOffset])).toEqual([
      ['route-a', 0, 3, -1],
      ['route-b', 1, 3, 0],
      ['route-c', 2, 3, 1]
    ]);
    expect([...plans.values()]).toEqual([...reorderedPlans.values()]);

    const left = edgeControlPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, graph.edgeByID.get('route-a')!, plans.get('route-a'));
    const right = edgeControlPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, graph.edgeByID.get('route-c')!, plans.get('route-c'));
    expect(left.y).toBeLessThan(0);
    expect(right.y).toBeGreaterThan(0);
  });

  it('maps route pulses to matching graph edge comets', () => {
    const graph = buildNetGraphData(nodes, routes);
    const pulse: PublicRoutePulse = {
      id: 'pulse-1',
      payloadTypeName: 'TEXT_MESSAGE',
      heardAt: 1,
      segments: [{
        routeId: 'r2',
        from: { nodeId: 'b', label: 'Bravo Observer', lat: 46, lng: -76 },
        to: { nodeId: 'c', label: 'Charlie', lat: 47, lng: -77 },
        distanceKm: 32
      }]
    };
    expect(routePulseToGraphComets(pulse, graph, 100)).toEqual([
      expect.objectContaining({ edgeID: 'r2', sourceID: 'b', targetID: 'c', payloadTypeName: 'TEXT_MESSAGE' })
    ]);
  });

  it('maps observer-only activity to matched graph node glows', () => {
    const graph = buildNetGraphData(nodes, routes);
    const activity: PublicActivity = {
      id: 'activity-1',
      kind: 'packet',
      payloadTypeName: 'NODEINFO_APP',
      heardAt: 1,
      hopCount: 0,
      hasRoute: false,
      animationState: 'observer',
      resolutionBucket: 'observer_only',
      observerLocation: { label: 'Bravo Observer', lat: 46.0002, lng: -76.0002 }
    };
    expect(observerActivityToGraphGlow(activity, graph, 100)).toMatchObject({ nodeID: 'b', payloadTypeName: 'NODEINFO_APP' });
    expect(observerActivityToGraphGlow({ ...activity, animationState: 'unmapped' }, graph, 100)).toBeNull();
  });

  it('searches labels, roles, IATAs, routes, and edge endpoint labels', () => {
    const graph = buildNetGraphData(nodes, routes);
    expect([...graphSearchMatches(graph, 'observer')]).toContain('b');
    expect([...graphSearchMatches(graph, 'YYZ')]).toContain('a');
    expect([...graphSearchMatches(graph, 'r2')].sort()).toEqual(['b', 'c']);
  });
});

function node(id: string, label: string, latitude: number, longitude: number, role: string, isObserver = false): PublicNode {
  return {
    id,
    label,
    role,
    isObserver,
    latitude,
    longitude,
    lastSeen: 1000,
    firstSeen: 1,
    iatasHeardIn: id === 'a' ? ['YYZ'] : ['YOW'],
    activityCount: id === 'b' ? 12 : 3
  };
}

function route(
  id: string,
  sourceID: string,
  sourceLabel: string,
  sourceLat: number,
  sourceLng: number,
  targetID: string,
  targetLabel: string,
  targetLat: number,
  targetLng: number,
  packetCount: number
): PublicRoute {
  return {
    id,
    from: { nodeId: sourceID, label: sourceLabel, lat: sourceLat, lng: sourceLng },
    to: { nodeId: targetID, label: targetLabel, lat: targetLat, lng: targetLng },
    distanceKm: 12,
    packetCount,
    lastHeard: 100,
    frequencyBucket: 1,
    payloadTypeNames: ['TEXT_MESSAGE']
  };
}
