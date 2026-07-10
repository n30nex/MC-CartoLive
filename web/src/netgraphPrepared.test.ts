import { describe, expect, it } from 'vitest';
import { preparedHitEdge, preparedHitNode, preparedPositions, preparedSearchMatches, pointOnPreparedEdge } from './netgraphPrepared';
import { prepareNetGraph } from './workers/netgraphTransforms';
import type { PublicNode, PublicRoute } from './types';

describe('prepared netgraph model', () => {
  it('returns deterministic prepared graphs for identical inputs', () => {
    const first = prepareNetGraph({ nodes, routes, width: 1200, height: 720, maxNodes: 2600, maxEdges: 4200 });
    const second = prepareNetGraph({ nodes, routes, width: 1200, height: 720, maxNodes: 2600, maxEdges: 4200 });

    expect(first.topologySignature).toBe(second.topologySignature);
    expect(first.nodes.map((node) => [node.id, node.x.toFixed(2), node.y.toFixed(2)])).toEqual(
      second.nodes.map((node) => [node.id, node.x.toFixed(2), node.y.toFixed(2)])
    );
    expect(first.edges.map((edge) => [edge.id, edge.controlX.toFixed(2), edge.controlY.toFixed(2)])).toEqual(
      second.edges.map((edge) => [edge.id, edge.controlX.toFixed(2), edge.controlY.toFixed(2)])
    );
  });

  it('reuses layout positions for metadata-only updates', () => {
    const first = prepareNetGraph({ nodes, routes, width: 1200, height: 720, maxNodes: 2600, maxEdges: 4200 });
    const nextRoutes = routes.map((route) => ({ ...route, packetCount: route.packetCount + 50, lastHeard: route.lastHeard + 1000 }));
    const second = prepareNetGraph({
      nodes: nodes.map((node) => ({ ...node, activityCount: node.activityCount + 3 })),
      routes: nextRoutes,
      width: 1200,
      height: 720,
      maxNodes: 2600,
      maxEdges: 4200,
      previousTopologySignature: first.topologySignature,
      previousPositions: preparedPositions(first)
    });

    expect(second.topologySignature).toBe(first.topologySignature);
    expect(second.layoutTicks).toBe(0);
    expect(second.layoutReused).toBe(true);
    expect(second.edges[0].packetCount).toBe(nextRoutes.find((route) => route.id === second.edges[0].id)?.packetCount);
    expect(second.nodes.map((node) => [node.id, node.x, node.y])).toEqual(first.nodes.map((node) => [node.id, node.x, node.y]));
  });

  it('uses spatial hit testing for nodes and edges', () => {
    const graph = prepareNetGraph({ nodes, routes, width: 1200, height: 720, maxNodes: 2600, maxEdges: 4200 });
    const node = graph.nodes.find((item) => item.id === 'b')!;
    const nodeHit = preparedHitNode(graph, { x: node.x, y: node.y }, 1);
    expect(nodeHit.item?.id).toBe('b');
    expect(nodeHit.candidates).toBeGreaterThan(0);

    const edge = graph.edges.find((item) => item.id === 'r2')!;
    const source = graph.nodes[edge.sourceIndex];
    const target = graph.nodes[edge.targetIndex];
    const midpoint = pointOnPreparedEdge(source, target, edge, 0.5);
    const edgeHit = preparedHitEdge(graph, midpoint, 1);
    expect(edgeHit.item?.id).toBe('r2');
    expect(edgeHit.candidates).toBeGreaterThan(0);
  });

  it('searches precomputed node and edge text', () => {
    const graph = prepareNetGraph({ nodes, routes, width: 1200, height: 720, maxNodes: 2600, maxEdges: 4200 });
    expect([...preparedSearchMatches(graph, 'observer')]).toContain('b');
    expect([...preparedSearchMatches(graph, 'YYZ')]).toContain('a');
    expect([...preparedSearchMatches(graph, 'r2')].sort()).toEqual(['b', 'c']);
    expect([...preparedSearchMatches(graph, 'trace')].sort()).toEqual(['b', 'c']);
  });

  it('prepares a production-scale synthetic graph with spatial indexes', () => {
    const syntheticNodes = Array.from({ length: 2500 }, (_, index) => node(`n${index}`, `Node ${index}`, 40 + index * 0.001, -80 - index * 0.001, index % 3 === 0 ? 'repeater' : 'companion'));
    const syntheticRoutes = Array.from({ length: 2500 }, (_, index) => {
      const next = (index + 1) % syntheticNodes.length;
      return route(`sr${index}`, syntheticNodes[index].id, syntheticNodes[index].label, syntheticNodes[index].latitude, syntheticNodes[index].longitude, syntheticNodes[next].id, syntheticNodes[next].label, syntheticNodes[next].latitude, syntheticNodes[next].longitude, index + 1);
    });
    const graph = prepareNetGraph({ nodes: syntheticNodes, routes: syntheticRoutes, width: 1440, height: 900, maxNodes: 2600, maxEdges: 4200 });

    expect(graph.nodes).toHaveLength(2500);
    expect(graph.edges).toHaveLength(2500);
    expect(graph.prepMs).toBeGreaterThan(0);
    expect(Object.keys(graph.nodeSpatialIndex.buckets).length).toBeGreaterThan(1);
    expect(Object.keys(graph.edgeSpatialIndex.buckets).length).toBeGreaterThan(1);
  }, 15_000);
});

const nodes: PublicNode[] = [
  node('a', 'Alpha', 45, -75, 'repeater'),
  node('b', 'Bravo Observer', 46, -76, 'room_server', true),
  node('c', 'Charlie', 47, -77, 'companion')
];

const routes: PublicRoute[] = [
  route('r1', 'a', 'Alpha', 45, -75, 'b', 'Bravo Observer', 46, -76, 8),
  route('r2', 'b', 'Bravo Observer', 46, -76, 'c', 'Charlie', 47, -77, 4, ['TRACE'])
];

function node(id: string, label: string, latitude: number, longitude: number, role: import('./types').NodeRole, isObserver = false): PublicNode {
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
  packetCount: number,
  payloadTypeNames = ['TEXT_MESSAGE']
): PublicRoute {
  return {
    id,
    from: { nodeId: sourceID, label: sourceLabel, lat: sourceLat, lng: sourceLng },
    to: { nodeId: targetID, label: targetLabel, lat: targetLat, lng: targetLng },
    distanceKm: 12,
    packetCount,
    lastHeard: 100,
    frequencyBucket: 1,
    payloadTypeNames
  };
}
