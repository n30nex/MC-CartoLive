import { describe, expect, it } from 'vitest';
import {
  buildConnectivityGraph,
  directConnectivity,
  highlightedPathForTarget,
  phonebookGroupsForNode,
  shortestPathBetween
} from './connectivity';
import type { PublicNode, PublicRoute, PublicRouteEndpoint } from './types';

const node = (id: string, activityCount = 1, lastSeen = 1): PublicNode => ({
  id,
  label: id.toUpperCase(),
  role: id === 'a' ? 'repeater' : 'companion',
  latitude: 43,
  longitude: -79,
  firstSeen: 1,
  lastSeen,
  iatasHeardIn: ['YYZ'],
  activityCount
});

const endpoint = (nodeId: string): PublicRouteEndpoint => ({
  nodeId,
  label: nodeId.toUpperCase(),
  lat: 43,
  lng: -79,
  pathHash3: `${nodeId}${nodeId}${nodeId}${nodeId}${nodeId}${nodeId}`.slice(0, 6).toUpperCase()
});

const route = (id: string, from: string, to: string, packetCount: number, lastHeard: number, distanceKm = 1): PublicRoute => ({
  id,
  from: endpoint(from),
  to: endpoint(to),
  distanceKm,
  packetCount,
  lastHeard,
  frequencyBucket: 1,
  payloadTypeNames: ['GROUP_TEXT']
});

describe('connectivity graph', () => {
  it('returns direct route and neighbor sets for selected nodes', () => {
    const graph = buildConnectivityGraph(
      [node('a'), node('b'), node('c')],
      [route('a-b', 'a', 'b', 10, 100), route('b-c', 'b', 'c', 5, 90)]
    );

    const direct = directConnectivity(graph, 'a');

    expect([...direct.routeIDs]).toEqual(['a-b']);
    expect([...direct.nodeIDs]).toEqual(['b']);
    expect(direct.routes.map((item) => item.id)).toEqual(['a-b']);
    expect(direct.nodes.map((item) => item.id)).toEqual(['b']);
  });

  it('groups reachable nodes by hop count with max hops first', () => {
    const graph = buildConnectivityGraph(
      [node('a'), node('b'), node('c'), node('d')],
      [route('a-b', 'a', 'b', 10, 100), route('b-c', 'b', 'c', 6, 90), route('c-d', 'c', 'd', 3, 80)]
    );

    const groups = phonebookGroupsForNode(graph, 'a');

    expect(groups.map((group) => group.hopCount)).toEqual([3, 2, 1]);
    expect(groups[0].nodes.map((item) => item.node.id)).toEqual(['d']);
    expect(groups[2].nodes.map((item) => item.node.id)).toEqual(['b']);
  });

  it('sorts phonebook rows by most active node inside each hop group', () => {
    const graph = buildConnectivityGraph(
      [node('a'), node('b', 4), node('c', 30), node('d', 12)],
      [route('a-b', 'a', 'b', 8, 100), route('a-c', 'a', 'c', 5, 90), route('a-d', 'a', 'd', 20, 80)]
    );

    const groups = phonebookGroupsForNode(graph, 'a');

    expect(groups[0].hopCount).toBe(1);
    expect(groups[0].nodes.map((item) => item.node.id)).toEqual(['c', 'd', 'b']);
  });

  it('prefers fewer hops, then stronger and more recent route paths', () => {
    const graph = buildConnectivityGraph(
      [node('a'), node('b'), node('c'), node('d')],
      [
        route('a-d-weak', 'a', 'd', 1, 10),
        route('a-b', 'a', 'b', 100, 100),
        route('b-d', 'b', 'd', 100, 100),
        route('a-c-weak', 'a', 'c', 5, 30),
        route('c-d-weak', 'c', 'd', 5, 30)
      ]
    );

    const groups = phonebookGroupsForNode(graph, 'a');
    const d = groups.flatMap((group) => group.nodes).find((item) => item.node.id === 'd');

    expect(d?.hopCount).toBe(1);
    expect(d?.pathRouteIDs).toEqual(['a-d-weak']);

    const c = groups.flatMap((group) => group.nodes).find((item) => item.node.id === 'c');
    expect(c?.pathRouteIDs).toEqual(['a-c-weak']);
  });

  it('exposes highlighted path route and node IDs for a phonebook target', () => {
    const graph = buildConnectivityGraph(
      [node('a'), node('b'), node('c')],
      [route('a-b', 'a', 'b', 10, 100), route('b-c', 'b', 'c', 5, 90)]
    );

    const groups = phonebookGroupsForNode(graph, 'a');
    const highlighted = highlightedPathForTarget(groups, 'c');

    expect(highlighted).toEqual({
      targetNodeID: 'c',
      routeIDs: ['a-b', 'b-c'],
      nodeIDs: ['a', 'b', 'c']
    });
  });

  it('builds MeshCore 3-byte copy paths from public endpoint prefixes', () => {
    const graph = buildConnectivityGraph(
      [node('a'), node('b'), node('c')],
      [route('a-b', 'a', 'b', 10, 100), route('b-c', 'b', 'c', 5, 90)]
    );

    const path = shortestPathBetween(graph, 'a', 'c');

    expect(path?.pathHash3).toEqual(['BBBBBB', 'CCCCCC']);
    expect(path?.meshcorePath3).toBe('BBBBBB,CCCCCC');
  });
});
