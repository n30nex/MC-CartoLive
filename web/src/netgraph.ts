import type { PublicActivity, PublicNode, PublicRoute, PublicRoutePulse } from './types';

export interface NetGraphNode {
  id: string;
  label: string;
  role: string;
  isObserver: boolean;
  lat: number;
  lng: number;
  lastSeen: number;
  firstSeen: number;
  iatasHeardIn: string[];
  activityCount: number;
  degree: number;
  routeIDs: string[];
}

export interface NetGraphEdge {
  id: string;
  sourceID: string;
  targetID: string;
  sourceLabel: string;
  targetLabel: string;
  distanceKm: number;
  packetCount: number;
  lastHeard: number;
  payloadTypeNames: string[];
}

export interface NetGraphData {
  nodes: NetGraphNode[];
  edges: NetGraphEdge[];
  nodeByID: Map<string, NetGraphNode>;
  edgeByID: Map<string, NetGraphEdge>;
}

export interface NetGraphComet {
  id: string;
  edgeID: string;
  sourceID: string;
  targetID: string;
  payloadTypeName: string;
  startedAt: number;
  durationMs: number;
}

export interface NetGraphGlow {
  id: string;
  nodeID: string;
  payloadTypeName: string;
  startedAt: number;
  durationMs: number;
}

export interface NetGraphSelection {
  nodeIDs: Set<string>;
  edgeIDs: Set<string>;
}

const DEFAULT_COMET_DURATION_MS = 2400;
const DEFAULT_GLOW_DURATION_MS = 3600;

export function buildNetGraphData(nodes: PublicNode[], routes: PublicRoute[]): NetGraphData {
  const publicNodes = new Map(nodes.map((node) => [node.id, node]));
  const nodeDrafts = new Map<string, NetGraphNode>();
  const routeIDsByNode = new Map<string, Set<string>>();
  const edges = new Map<string, NetGraphEdge>();

  for (const route of routes) {
    if (!route.from.nodeId || !route.to.nodeId || route.from.nodeId === route.to.nodeId) continue;
    if (!isFiniteCoordinate(route.from.lat, route.from.lng) || !isFiniteCoordinate(route.to.lat, route.to.lng)) continue;
    if (edges.has(route.id)) continue;
    const from = publicNodes.get(route.from.nodeId);
    const to = publicNodes.get(route.to.nodeId);
    nodeDrafts.set(route.from.nodeId, netGraphNodeFromRouteEndpoint(route.from.nodeId, route.from.label, route.from.lat, route.from.lng, from));
    nodeDrafts.set(route.to.nodeId, netGraphNodeFromRouteEndpoint(route.to.nodeId, route.to.label, route.to.lat, route.to.lng, to));
    addRouteForNode(routeIDsByNode, route.from.nodeId, route.id);
    addRouteForNode(routeIDsByNode, route.to.nodeId, route.id);
    edges.set(route.id, {
      id: route.id,
      sourceID: route.from.nodeId,
      targetID: route.to.nodeId,
      sourceLabel: route.from.label,
      targetLabel: route.to.label,
      distanceKm: route.distanceKm,
      packetCount: route.packetCount,
      lastHeard: route.lastHeard,
      payloadTypeNames: [...new Set(route.payloadTypeNames)].sort()
    });
  }

  const graphNodes = Array.from(nodeDrafts.values())
    .map((node) => {
      const routeIDs = [...(routeIDsByNode.get(node.id) ?? new Set<string>())].sort();
      return { ...node, degree: routeIDs.length, routeIDs };
    })
    .filter((node) => node.degree > 0)
    .sort((a, b) => b.degree - a.degree || b.activityCount - a.activityCount || a.label.localeCompare(b.label));
  const graphEdges = Array.from(edges.values()).sort((a, b) => b.packetCount - a.packetCount || b.lastHeard - a.lastHeard);

  return {
    nodes: graphNodes,
    edges: graphEdges,
    nodeByID: new Map(graphNodes.map((node) => [node.id, node])),
    edgeByID: new Map(graphEdges.map((edge) => [edge.id, edge]))
  };
}

export function selectionForNode(graph: NetGraphData, nodeID: string): NetGraphSelection {
  const node = graph.nodeByID.get(nodeID);
  const edgeIDs = new Set(node?.routeIDs ?? []);
  const nodeIDs = new Set<string>(node ? [node.id] : []);
  for (const edgeID of edgeIDs) {
    const edge = graph.edgeByID.get(edgeID);
    if (!edge) continue;
    nodeIDs.add(edge.sourceID);
    nodeIDs.add(edge.targetID);
  }
  return { nodeIDs, edgeIDs };
}

export function selectedNeighborhood(graph: NetGraphData, nodeID: string): NetGraphData {
  const node = graph.nodeByID.get(nodeID);
  if (!node) return emptyGraph();
  const selection = selectionForNode(graph, nodeID);
  const nodes = graph.nodes.filter((item) => selection.nodeIDs.has(item.id));
  const edges = graph.edges.filter((edge) => selection.edgeIDs.has(edge.id) && selection.nodeIDs.has(edge.sourceID) && selection.nodeIDs.has(edge.targetID));
  return {
    nodes,
    edges,
    nodeByID: new Map(nodes.map((item) => [item.id, item])),
    edgeByID: new Map(edges.map((edge) => [edge.id, edge]))
  };
}

export function selectionForEdge(graph: NetGraphData, edgeID: string): NetGraphSelection {
  const edge = graph.edgeByID.get(edgeID);
  return {
    nodeIDs: new Set(edge ? [edge.sourceID, edge.targetID] : []),
    edgeIDs: new Set(edge ? [edge.id] : [])
  };
}

export function graphSearchMatches(graph: NetGraphData, query: string): Set<string> {
  const needle = query.trim().toLowerCase();
  if (!needle) return new Set<string>();
  const matches = new Set<string>();
  for (const node of graph.nodes) {
    const fields = [node.label, node.role, ...node.iatasHeardIn, ...node.routeIDs];
    if (fields.some((field) => field.toLowerCase().includes(needle))) matches.add(node.id);
  }
  for (const edge of graph.edges) {
    const fields = [edge.id, edge.sourceLabel, edge.targetLabel, ...edge.payloadTypeNames];
    if (!fields.some((field) => field.toLowerCase().includes(needle))) continue;
    matches.add(edge.sourceID);
    matches.add(edge.targetID);
  }
  return matches;
}

export function routePulseToGraphComets(pulse: PublicRoutePulse, graph: NetGraphData, now = performanceNow()): NetGraphComet[] {
  const out: NetGraphComet[] = [];
  for (const [index, segment] of pulse.segments.entries()) {
    const edge = graph.edgeByID.get(segment.routeId) ?? edgeForEndpoints(graph, segment.from.nodeId, segment.to.nodeId);
    if (!edge) continue;
    out.push({
      id: `${pulse.id}:${edge.id}:${index}`,
      edgeID: edge.id,
      sourceID: edge.sourceID,
      targetID: edge.targetID,
      payloadTypeName: pulse.payloadTypeName,
      startedAt: now + index * 120,
      durationMs: DEFAULT_COMET_DURATION_MS
    });
  }
  return out;
}

export function observerActivityToGraphGlow(activity: PublicActivity, graph: NetGraphData, now = performanceNow()): NetGraphGlow | null {
  if (activity.animationState !== 'observer' || !activity.observerLocation) return null;
  const anchorNodeID = activity.messageAnchor?.nodeId;
  const byAnchor = anchorNodeID ? graph.nodeByID.get(anchorNodeID) : null;
  const node = byAnchor ?? nodeByObserverLocation(graph, activity.observerLocation.label, activity.observerLocation.lat, activity.observerLocation.lng);
  if (!node) return null;
  return {
    id: `observer:${activity.id}:${node.id}`,
    nodeID: node.id,
    payloadTypeName: activity.payloadTypeName,
    startedAt: now,
    durationMs: DEFAULT_GLOW_DURATION_MS
  };
}

function netGraphNodeFromRouteEndpoint(id: string, label: string, lat: number, lng: number, node: PublicNode | undefined): NetGraphNode {
  return {
    id,
    label: node?.label || label || id,
    role: node?.role ?? 'unknown',
    isObserver: node?.isObserver === true,
    lat: node?.latitude ?? lat,
    lng: node?.longitude ?? lng,
    lastSeen: node?.lastSeen ?? 0,
    firstSeen: node?.firstSeen ?? 0,
    iatasHeardIn: [...new Set(node?.iatasHeardIn ?? [])].sort(),
    activityCount: node?.activityCount ?? 0,
    degree: 0,
    routeIDs: []
  };
}

function addRouteForNode(routesByNode: Map<string, Set<string>>, nodeID: string, routeID: string): void {
  const routes = routesByNode.get(nodeID) ?? new Set<string>();
  routes.add(routeID);
  routesByNode.set(nodeID, routes);
}

function edgeForEndpoints(graph: NetGraphData, sourceID: string, targetID: string): NetGraphEdge | null {
  for (const edge of graph.edges) {
    if ((edge.sourceID === sourceID && edge.targetID === targetID) || (edge.sourceID === targetID && edge.targetID === sourceID)) return edge;
  }
  return null;
}

function nodeByObserverLocation(graph: NetGraphData, label: string, lat: number, lng: number): NetGraphNode | null {
  const key = observerMatchKey(label, lat, lng);
  return graph.nodes.find((node) => observerMatchKey(node.label, node.lat, node.lng) === key) ?? null;
}

function observerMatchKey(label: string, lat: number, lng: number): string {
  return `${label.trim().toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
}

function isFiniteCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}

function emptyGraph(): NetGraphData {
  return { nodes: [], edges: [], nodeByID: new Map(), edgeByID: new Map() };
}

function performanceNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
