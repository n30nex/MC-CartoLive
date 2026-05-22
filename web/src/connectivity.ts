import type { PublicNode, PublicRoute } from './types';

export interface ConnectivityGraph {
  nodesByID: Map<string, PublicNode>;
  routesByID: Map<string, PublicRoute>;
  adjacency: Map<string, GraphEdge[]>;
  pathHash3ByNodeID: Map<string, string>;
}

export interface GraphEdge {
  route: PublicRoute;
  fromNodeID: string;
  toNodeID: string;
}

export interface DirectConnectivity {
  routeIDs: Set<string>;
  nodeIDs: Set<string>;
  routes: PublicRoute[];
  nodes: PublicNode[];
}

export interface ReachableNode {
  node: PublicNode;
  hopCount: number;
  pathRouteIDs: string[];
  pathNodeIDs: string[];
  totalDistanceKm: number;
  strongestRoutePacketCount: number;
  totalRoutePackets: number;
  lastHeard: number;
  endpointLabels: string[];
  pathHash3: string[];
  meshcorePath3: string;
}

export interface PhonebookGroup {
  hopCount: number;
  nodes: ReachableNode[];
}

export interface HighlightedPath {
  targetNodeID: string;
  routeIDs: string[];
  nodeIDs: string[];
}

interface PathCandidate {
  nodeID: string;
  hopCount: number;
  routeIDs: string[];
  nodeIDs: string[];
  totalDistanceKm: number;
  strongestRoutePacketCount: number;
  totalRoutePackets: number;
  lastHeard: number;
  endpointLabels: string[];
  pathHash3: string[];
}

export function buildConnectivityGraph(nodes: PublicNode[], routes: PublicRoute[]): ConnectivityGraph {
  const nodesByID = new Map(nodes.map((node) => [node.id, node]));
  const routesByID = new Map<string, PublicRoute>();
  const adjacency = new Map<string, GraphEdge[]>();
  const pathHash3ByNodeID = new Map<string, string>();

  for (const route of routes) {
    if (!nodesByID.has(route.from.nodeId) || !nodesByID.has(route.to.nodeId)) continue;
    registerPathHash3(pathHash3ByNodeID, route.from.nodeId, route.from.pathHash3);
    registerPathHash3(pathHash3ByNodeID, route.to.nodeId, route.to.pathHash3);
    routesByID.set(route.id, route);
    appendEdge(adjacency, route.from.nodeId, { route, fromNodeID: route.from.nodeId, toNodeID: route.to.nodeId });
    appendEdge(adjacency, route.to.nodeId, { route, fromNodeID: route.to.nodeId, toNodeID: route.from.nodeId });
  }

  for (const edges of adjacency.values()) {
    edges.sort(compareGraphEdges);
  }

  return { nodesByID, routesByID, adjacency, pathHash3ByNodeID };
}

export function directConnectivity(graph: ConnectivityGraph, selectedNodeID: string | null): DirectConnectivity {
  const routeIDs = new Set<string>();
  const nodeIDs = new Set<string>();
  if (!selectedNodeID) return { routeIDs, nodeIDs, routes: [], nodes: [] };

  const edges = graph.adjacency.get(selectedNodeID) ?? [];
  for (const edge of edges) {
    routeIDs.add(edge.route.id);
    nodeIDs.add(edge.toNodeID);
  }

  const routes = [...routeIDs]
    .map((routeID) => graph.routesByID.get(routeID))
    .filter((route): route is PublicRoute => Boolean(route))
    .sort(compareRoutesByActivity);
  const nodes = [...nodeIDs]
    .map((nodeID) => graph.nodesByID.get(nodeID))
    .filter((node): node is PublicNode => Boolean(node))
    .sort(compareNodesByActivity);

  return { routeIDs, nodeIDs, routes, nodes };
}

export function phonebookGroupsForNode(graph: ConnectivityGraph, selectedNodeID: string | null): PhonebookGroup[] {
  if (!selectedNodeID || !graph.nodesByID.has(selectedNodeID)) return [];
  const paths = reachablePaths(graph, selectedNodeID);
  const groups = new Map<number, ReachableNode[]>();

  for (const path of paths.values()) {
    if (path.nodeID === selectedNodeID) continue;
    const node = graph.nodesByID.get(path.nodeID);
    if (!node) continue;
    const item: ReachableNode = {
      node,
      hopCount: path.hopCount,
      pathRouteIDs: path.routeIDs,
      pathNodeIDs: path.nodeIDs,
      totalDistanceKm: path.totalDistanceKm,
      strongestRoutePacketCount: path.strongestRoutePacketCount,
      totalRoutePackets: path.totalRoutePackets,
      lastHeard: path.lastHeard,
      endpointLabels: path.endpointLabels,
      pathHash3: path.pathHash3,
      meshcorePath3: meshcorePath3(path.pathHash3)
    };
    groups.set(path.hopCount, [...(groups.get(path.hopCount) ?? []), item]);
  }

  return [...groups.entries()]
    .sort(([leftHop], [rightHop]) => rightHop - leftHop)
    .map(([hopCount, nodes]) => ({
      hopCount,
      nodes: nodes.sort(compareReachableNodes)
    }));
}

export function highlightedPathForTarget(groups: PhonebookGroup[], targetNodeID: string | null): HighlightedPath | null {
  if (!targetNodeID) return null;
  for (const group of groups) {
    const found = group.nodes.find((item) => item.node.id === targetNodeID);
    if (found) {
      return {
        targetNodeID,
        routeIDs: found.pathRouteIDs,
        nodeIDs: found.pathNodeIDs
      };
    }
  }
  return null;
}

export function shortestPathBetween(graph: ConnectivityGraph, sourceNodeID: string | null, targetNodeID: string | null): ReachableNode | null {
  if (!sourceNodeID || !targetNodeID || sourceNodeID === targetNodeID || !graph.nodesByID.has(sourceNodeID) || !graph.nodesByID.has(targetNodeID)) {
    return null;
  }
  const path = reachablePaths(graph, sourceNodeID).get(targetNodeID);
  const node = graph.nodesByID.get(targetNodeID);
  if (!path || !node) return null;
  return {
    node,
    hopCount: path.hopCount,
    pathRouteIDs: path.routeIDs,
    pathNodeIDs: path.nodeIDs,
    totalDistanceKm: path.totalDistanceKm,
    strongestRoutePacketCount: path.strongestRoutePacketCount,
    totalRoutePackets: path.totalRoutePackets,
    lastHeard: path.lastHeard,
    endpointLabels: path.endpointLabels,
    pathHash3: path.pathHash3,
    meshcorePath3: meshcorePath3(path.pathHash3)
  };
}

function reachablePaths(graph: ConnectivityGraph, selectedNodeID: string): Map<string, PathCandidate> {
  const start: PathCandidate = {
    nodeID: selectedNodeID,
    hopCount: 0,
    routeIDs: [],
    nodeIDs: [selectedNodeID],
    totalDistanceKm: 0,
    strongestRoutePacketCount: 0,
    totalRoutePackets: 0,
    lastHeard: 0,
    endpointLabels: [],
    pathHash3: []
  };
  const best = new Map<string, PathCandidate>([[selectedNodeID, start]]);
  const queue: PathCandidate[] = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of graph.adjacency.get(current.nodeID) ?? []) {
      if (current.nodeIDs.includes(edge.toNodeID)) continue;
      const route = edge.route;
      const next: PathCandidate = {
        nodeID: edge.toNodeID,
        hopCount: current.hopCount + 1,
        routeIDs: [...current.routeIDs, route.id],
        nodeIDs: [...current.nodeIDs, edge.toNodeID],
        totalDistanceKm: current.totalDistanceKm + route.distanceKm,
        strongestRoutePacketCount: Math.max(current.strongestRoutePacketCount, route.packetCount),
        totalRoutePackets: current.totalRoutePackets + route.packetCount,
        lastHeard: Math.max(current.lastHeard, route.lastHeard),
        endpointLabels: [...current.endpointLabels, route.from.nodeId === edge.fromNodeID ? route.to.label : route.from.label],
        pathHash3: [...current.pathHash3, graph.pathHash3ByNodeID.get(edge.toNodeID) ?? '']
      };
      const existing = best.get(next.nodeID);
      if (!existing || comparePathCandidates(next, existing) < 0) {
        best.set(next.nodeID, next);
        queue.push(next);
        queue.sort(comparePathCandidates);
      }
    }
  }

  return best;
}

function appendEdge(adjacency: Map<string, GraphEdge[]>, nodeID: string, edge: GraphEdge) {
  adjacency.set(nodeID, [...(adjacency.get(nodeID) ?? []), edge]);
}

function registerPathHash3(pathHash3ByNodeID: Map<string, string>, nodeID: string, value: string | undefined) {
  const normalized = normalizePathHash3(value);
  if (normalized && !pathHash3ByNodeID.has(nodeID)) {
    pathHash3ByNodeID.set(nodeID, normalized);
  }
}

function normalizePathHash3(value: string | undefined): string {
  const normalized = (value ?? '').trim().toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : '';
}

function meshcorePath3(prefixes: string[]): string {
  return prefixes.map(normalizePathHash3).filter(Boolean).join(',');
}

function compareGraphEdges(left: GraphEdge, right: GraphEdge): number {
  return compareRoutesByActivity(left.route, right.route);
}

function compareRoutesByActivity(left: PublicRoute, right: PublicRoute): number {
  return right.packetCount - left.packetCount || right.lastHeard - left.lastHeard || left.id.localeCompare(right.id);
}

function compareNodesByActivity(left: PublicNode, right: PublicNode): number {
  return right.activityCount - left.activityCount || right.lastSeen - left.lastSeen || left.label.localeCompare(right.label);
}

function compareReachableNodes(left: ReachableNode, right: ReachableNode): number {
  return (
    right.node.activityCount - left.node.activityCount ||
    right.strongestRoutePacketCount - left.strongestRoutePacketCount ||
    right.lastHeard - left.lastHeard ||
    left.node.label.localeCompare(right.node.label)
  );
}

function comparePathCandidates(left: PathCandidate, right: PathCandidate): number {
  return (
    left.hopCount - right.hopCount ||
    right.strongestRoutePacketCount - left.strongestRoutePacketCount ||
    right.lastHeard - left.lastHeard ||
    right.totalRoutePackets - left.totalRoutePackets ||
    left.totalDistanceKm - right.totalDistanceKm ||
    left.nodeID.localeCompare(right.nodeID)
  );
}
