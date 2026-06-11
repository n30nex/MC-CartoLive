import type { NodeRole, PublicActivity, PublicNode, PublicRoute, PublicRouteEndpoint, PublicRoutePulse, PublicRouteSegment } from './types';

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
  const publicNodes = new Map(
    nodes
      .map((node) => normalizePublicNode(node))
      .filter((node): node is PublicNode => Boolean(node))
      .map((node) => [node.id, node])
  );
  const nodeDrafts = new Map<string, NetGraphNode>();
  const routeIDsByNode = new Map<string, Set<string>>();
  const edges = new Map<string, NetGraphEdge>();

  for (const route of routes) {
    const safeRoute = normalizePublicRoute(route);
    if (!safeRoute) continue;
    if (!isFiniteCoordinate(safeRoute.from.lat, safeRoute.from.lng) || !isFiniteCoordinate(safeRoute.to.lat, safeRoute.to.lng)) continue;
    if (safeRoute.from.nodeId === safeRoute.to.nodeId) continue;
    if (edges.has(safeRoute.id)) continue;
    const from = publicNodes.get(safeRoute.from.nodeId);
    const to = publicNodes.get(safeRoute.to.nodeId);
    nodeDrafts.set(
      safeRoute.from.nodeId,
      netGraphNodeFromRouteEndpoint(safeRoute.from.nodeId, safeRoute.from.label, safeRoute.from.lat, safeRoute.from.lng, from)
    );
    nodeDrafts.set(
      safeRoute.to.nodeId,
      netGraphNodeFromRouteEndpoint(safeRoute.to.nodeId, safeRoute.to.label, safeRoute.to.lat, safeRoute.to.lng, to)
    );
    addRouteForNode(routeIDsByNode, safeRoute.from.nodeId, safeRoute.id);
    addRouteForNode(routeIDsByNode, safeRoute.to.nodeId, safeRoute.id);
    edges.set(route.id, {
      id: safeRoute.id,
      sourceID: safeRoute.from.nodeId,
      targetID: safeRoute.to.nodeId,
      sourceLabel: safeRoute.from.label,
      targetLabel: safeRoute.to.label,
      distanceKm: safeRoute.distanceKm,
      packetCount: safeRoute.packetCount,
      lastHeard: safeRoute.lastHeard,
      payloadTypeNames: [...new Set(safeRoute.payloadTypeNames)].sort()
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
  const needle = safeText(query).toLowerCase();
  if (!needle) return new Set<string>();
  const matches = new Set<string>();
  for (const node of graph.nodes) {
    const fields = [node.label, node.role, ...node.iatasHeardIn, ...node.routeIDs];
    if (fields.some((field) => safeText(field).toLowerCase().includes(needle))) matches.add(node.id);
  }
  for (const edge of graph.edges) {
    const fields = [edge.id, edge.sourceLabel, edge.targetLabel, ...edge.payloadTypeNames];
    if (!fields.some((field) => safeText(field).toLowerCase().includes(needle))) continue;
    matches.add(edge.sourceID);
    matches.add(edge.targetID);
  }
  return matches;
}

export function routePulseToGraphComets(pulse: PublicRoutePulse, graph: NetGraphData, now = performanceNow()): NetGraphComet[] {
  const out: NetGraphComet[] = [];
  for (const [index, segment] of pulse.segments.entries()) {
    const safeSegment = normalizePublicRouteSegment(segment);
    if (!safeSegment) continue;
    const edge = graph.edgeByID.get(safeSegment.routeId) ?? edgeForEndpoints(graph, safeSegment.from.nodeId, safeSegment.to.nodeId);
    if (!edge) continue;
    out.push({
      id: `${pulse.id}:${edge.id}:${index}`,
      edgeID: edge.id,
      sourceID: edge.sourceID,
      targetID: edge.targetID,
      payloadTypeName: safeText(pulse.payloadTypeName),
      startedAt: now + index * 120,
      durationMs: DEFAULT_COMET_DURATION_MS
    });
  }
  return out;
}

export function observerActivityToGraphGlow(activity: PublicActivity, graph: NetGraphData, now = performanceNow()): NetGraphGlow | null {
  if (activity.animationState !== 'observer' || !activity.observerLocation) return null;
  const anchorNodeID = safeText(activity.messageAnchor?.nodeId);
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
  const safeID = safeText(id);
  if (!safeID) return nodeFromDefaults('unknown');
  return {
    id: safeID,
    label: safeText(node?.label || label || safeID),
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
  return `${safeText(label).toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
}

function isFiniteCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function normalizePublicNode(node: PublicNode): PublicNode | null {
  const id = safeText(node?.id);
  if (!id) return null;
  return {
    ...node,
    id,
    label: safeText(node?.label, id),
    role: normalizeNodeRole(node?.role),
    isObserver: node?.isObserver === true,
    latitude: safeNumber(node?.latitude),
    longitude: safeNumber(node?.longitude),
    lastSeen: safeNumber(node?.lastSeen),
    firstSeen: safeNumber(node?.firstSeen, 0),
    iatasHeardIn: safeStringArray(node?.iatasHeardIn).map((iata) => iata.toUpperCase()),
    activityCount: safeNumber(node?.activityCount, 0),
    regionsHeardIn: safeStringArray(node?.regionsHeardIn),
    ...('routeIDs' in node ? {} : {})
  };
}

function normalizePublicRoute(route: PublicRoute): PublicRoute | null {
  const id = safeText(route?.id);
  const from = normalizeRouteEndpoint(route?.from);
  const to = normalizeRouteEndpoint(route?.to);
  if (!id || !from || !to) return null;
  return {
    ...route,
    id,
    from,
    to,
    payloadTypeNames: safePayloadTypeNames(route?.payloadTypeNames),
    distanceKm: safeNumber(route?.distanceKm, 0),
    packetCount: safeNumber(route?.packetCount, 0),
    lastHeard: safeNumber(route?.lastHeard, 0),
    frequencyBucket: safeNumber(route?.frequencyBucket, 0)
  };
}

function normalizeRouteEndpoint(endpoint: PublicRouteEndpoint | null | undefined): NetGraphPublicRouteEndpoint | null {
  if (!endpoint) return null;
  const nodeId = safeText(endpoint.nodeId);
  if (!nodeId) return null;
  return {
    ...endpoint,
    nodeId,
    label: safeText(endpoint.label, nodeId),
    lat: safeNumber(endpoint.lat),
    lng: safeNumber(endpoint.lng),
    pathHash3: safeText(endpoint.pathHash3)
  };
}

interface NetGraphPublicRouteEndpoint {
  nodeId: string;
  label: string;
  lat: number;
  lng: number;
  pathHash3?: string;
}

function normalizePublicRouteSegment(segment: PublicRouteSegment | null | undefined): PublicRouteSegment | null {
  if (!segment) return null;
  const routeId = safeText(segment.routeId);
  const from = normalizeRouteEndpoint(segment.from);
  const to = normalizeRouteEndpoint(segment.to);
  if (!routeId || !from || !to) return null;
  return {
    ...segment,
    routeId,
    from,
    to,
    distanceKm: safeNumber(segment.distanceKm, 0)
  };
}

function normalizeNodeRole(role: unknown): NodeRole {
  const next = safeText(role as string).toLowerCase();
  if (next === 'companion' || next === 'repeater' || next === 'room_server' || next === 'sensor') {
    return next;
  }
  return 'unknown';
}

function safePayloadTypeNames(values: unknown): string[] {
  if (!Array.isArray(values) || values.length === 0) return ['unknown'];
  const next = values.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean);
  if (next.length === 0) return ['unknown'];
  return [...new Set(next.map((value) => value))];
}

function safeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    const next = safeText(value);
    if (next) out.push(next);
  }
  return out;
}

function safeText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    const next = value.trim();
    return next || fallback;
  }
  return fallback;
}

function safeNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return next;
}

function nodeFromDefaults(fallbackID: string): NetGraphNode {
  return {
    id: fallbackID,
    label: fallbackID,
    role: 'unknown',
    isObserver: false,
    lat: 0,
    lng: 0,
    lastSeen: 0,
    firstSeen: 0,
    iatasHeardIn: [],
    activityCount: 0,
    degree: 0,
    routeIDs: []
  };
}

function emptyGraph(): NetGraphData {
  return { nodes: [], edges: [], nodeByID: new Map(), edgeByID: new Map() };
}

function performanceNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
