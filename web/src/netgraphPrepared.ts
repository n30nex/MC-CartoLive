import type { NodeIconShape } from './nodeVisuals';
import type { NetGraphData, NetGraphEdge, NetGraphNode, NetGraphSelection } from './netgraph';
import type { PublicNode, PublicRoute } from './types';

export interface NetGraphPrepareInput {
  nodes: PublicNode[];
  routes: PublicRoute[];
  width: number;
  height: number;
  maxNodes: number;
  maxEdges: number;
  previousTopologySignature?: string;
  previousPositions?: NetGraphPreviousPosition[];
  layoutPaused?: boolean;
}

export interface NetGraphPreviousPosition {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

export interface PreparedNetGraphNode extends NetGraphNode {
  x: number;
  y: number;
  seedX: number;
  seedY: number;
  componentID: number;
  componentX: number;
  componentY: number;
  radius: number;
  color: string;
  shape: NodeIconShape;
  searchText: string;
}

export interface PreparedNetGraphEdge extends NetGraphEdge {
  sourceIndex: number;
  targetIndex: number;
  laneOffset: number;
  laneCount: number;
  controlX: number;
  controlY: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  color: string;
  searchText: string;
}

export interface NetGraphSpatialIndex {
  cellSize: number;
  buckets: Record<string, number[]>;
}

export interface PreparedNetGraph {
  nodes: PreparedNetGraphNode[];
  edges: PreparedNetGraphEdge[];
  nodeIndexByID: Record<string, number>;
  edgeIndexByID: Record<string, number>;
  nodeSpatialIndex: NetGraphSpatialIndex;
  edgeSpatialIndex: NetGraphSpatialIndex;
  topologySignature: string;
  totalNodes: number;
  totalEdges: number;
  visibleNodes: number;
  visibleEdges: number;
  prepMs: number;
  layoutMs: number;
  layoutTicks: number;
  layoutReused: boolean;
}

export interface NetGraphSettlePlan {
  ticks: number;
  alpha: number;
  restart: boolean;
}

export interface GraphTransform {
  x: number;
  y: number;
  k: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface NetGraphHitResult<T> {
  item: T | null;
  candidates: number;
}

const NETGRAPH_INITIAL_SETTLE_TICKS = 90;
const NETGRAPH_MAJOR_SETTLE_TICKS = 48;
const NETGRAPH_INCREMENTAL_SETTLE_TICKS = 16;
const SPATIAL_CELL_SIZE = 128;

export function netGraphSettlePlan(previousNodeCount: number, currentNodeCount: number, changedNodeCount: number, layoutPaused: boolean): NetGraphSettlePlan {
  if (layoutPaused) {
    return { ticks: 0, alpha: 0, restart: false };
  }
  if (previousNodeCount <= 0) {
    return { ticks: NETGRAPH_INITIAL_SETTLE_TICKS, alpha: 0.18, restart: true };
  }
  const denominator = Math.max(previousNodeCount, currentNodeCount, 1);
  const changeRatio = changedNodeCount / denominator;
  if (changeRatio >= 0.18) {
    return { ticks: NETGRAPH_MAJOR_SETTLE_TICKS, alpha: 0.12, restart: true };
  }
  return { ticks: NETGRAPH_INCREMENTAL_SETTLE_TICKS, alpha: 0.06, restart: true };
}

export function preparedNodeSearchText(node: NetGraphNode): string {
  return [node.id, node.label, node.role, ...node.iatasHeardIn, ...node.routeIDs].join(' ').toLowerCase();
}

export function preparedEdgeSearchText(edge: NetGraphEdge): string {
  return [edge.id, edge.sourceLabel, edge.targetLabel, ...edge.payloadTypeNames].join(' ').toLowerCase();
}

export function createNodeSpatialIndex(nodes: PreparedNetGraphNode[], cellSize = SPATIAL_CELL_SIZE): NetGraphSpatialIndex {
  const buckets: Record<string, number[]> = {};
  nodes.forEach((node, index) => {
    addIndexToBounds(buckets, cellSize, {
      minX: node.x - node.radius,
      minY: node.y - node.radius,
      maxX: node.x + node.radius,
      maxY: node.y + node.radius
    }, index);
  });
  return { cellSize, buckets };
}

export function createEdgeSpatialIndex(edges: PreparedNetGraphEdge[], cellSize = SPATIAL_CELL_SIZE): NetGraphSpatialIndex {
  const buckets: Record<string, number[]> = {};
  edges.forEach((edge, index) => {
    addIndexToBounds(buckets, cellSize, edge, index);
  });
  return { cellSize, buckets };
}

export function rebuildPreparedNetGraphIndexes(graph: PreparedNetGraph): PreparedNetGraph {
  return {
    ...graph,
    nodeIndexByID: Object.fromEntries(graph.nodes.map((node, index) => [node.id, index])),
    edgeIndexByID: Object.fromEntries(graph.edges.map((edge, index) => [edge.id, index])),
    nodeSpatialIndex: createNodeSpatialIndex(graph.nodes),
    edgeSpatialIndex: createEdgeSpatialIndex(graph.edges)
  };
}

export function refreshPreparedEdgeGeometry(graph: PreparedNetGraph): PreparedNetGraph {
  for (const edge of graph.edges) {
    const source = graph.nodes[edge.sourceIndex];
    const target = graph.nodes[edge.targetIndex];
    if (!source || !target) continue;
    const control = preparedEdgeControlPoint(source, target, edge);
    const padding = Math.max(16, edge.width + 10);
    edge.controlX = control.x;
    edge.controlY = control.y;
    edge.minX = Math.min(source.x, target.x, control.x) - padding;
    edge.minY = Math.min(source.y, target.y, control.y) - padding;
    edge.maxX = Math.max(source.x, target.x, control.x) + padding;
    edge.maxY = Math.max(source.y, target.y, control.y) + padding;
  }
  return rebuildPreparedNetGraphIndexes(graph);
}

export function querySpatialIndex(index: NetGraphSpatialIndex, bounds: WorldBounds): number[] {
  const out = new Set<number>();
  const minCellX = Math.floor(bounds.minX / index.cellSize);
  const maxCellX = Math.floor(bounds.maxX / index.cellSize);
  const minCellY = Math.floor(bounds.minY / index.cellSize);
  const maxCellY = Math.floor(bounds.maxY / index.cellSize);
  for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (const item of index.buckets[cellKey(cellX, cellY)] ?? []) out.add(item);
    }
  }
  return [...out];
}

export function viewportWorldBounds(transform: GraphTransform, width: number, height: number, padding = 96): WorldBounds {
  const k = Math.max(0.001, transform.k);
  return {
    minX: (0 - transform.x) / k - padding,
    minY: (0 - transform.y) / k - padding,
    maxX: (width - transform.x) / k + padding,
    maxY: (height - transform.y) / k + padding
  };
}

export function preparedSearchMatches(graph: PreparedNetGraph | null, query: string): Set<string> {
  const needle = query.trim().toLowerCase();
  if (!graph || !needle) return new Set<string>();
  const matches = new Set<string>();
  for (const node of graph.nodes) {
    if (node.searchText.includes(needle)) matches.add(node.id);
  }
  for (const edge of graph.edges) {
    if (!edge.searchText.includes(needle)) continue;
    matches.add(edge.sourceID);
    matches.add(edge.targetID);
  }
  return matches;
}

export function selectionForPreparedNode(graph: PreparedNetGraph | null, nodeID: string): NetGraphSelection {
  const node = graph ? graph.nodes[graph.nodeIndexByID[nodeID]] : undefined;
  const edgeIDs = new Set(node?.routeIDs ?? []);
  const nodeIDs = new Set<string>(node ? [node.id] : []);
  if (!graph) return { nodeIDs, edgeIDs };
  for (const edgeID of edgeIDs) {
    const edge = graph.edges[graph.edgeIndexByID[edgeID]];
    if (!edge) continue;
    nodeIDs.add(edge.sourceID);
    nodeIDs.add(edge.targetID);
  }
  return { nodeIDs, edgeIDs };
}

export function selectionForPreparedEdge(graph: PreparedNetGraph | null, edgeID: string): NetGraphSelection {
  const edge = graph ? graph.edges[graph.edgeIndexByID[edgeID]] : undefined;
  return {
    nodeIDs: new Set(edge ? [edge.sourceID, edge.targetID] : []),
    edgeIDs: new Set(edge ? [edge.id] : [])
  };
}

export function preparedHitNode(graph: PreparedNetGraph | null, point: { x: number; y: number }, scale: number): NetGraphHitResult<PreparedNetGraphNode> {
  if (!graph) return { item: null, candidates: 0 };
  let best: PreparedNetGraphNode | null = null;
  let bestDistance = Infinity;
  const allowance = 8 / Math.max(0.001, scale);
  const candidates = querySpatialIndex(graph.nodeSpatialIndex, {
    minX: point.x - allowance - 18,
    minY: point.y - allowance - 18,
    maxX: point.x + allowance + 18,
    maxY: point.y + allowance + 18
  });
  for (const index of candidates) {
    const node = graph.nodes[index];
    if (!node) continue;
    const distance = Math.hypot(point.x - node.x, point.y - node.y);
    if (distance <= node.radius + allowance && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return { item: best, candidates: candidates.length };
}

export function preparedHitEdge(graph: PreparedNetGraph | null, point: { x: number; y: number }, scale: number): NetGraphHitResult<PreparedNetGraphEdge> {
  if (!graph) return { item: null, candidates: 0 };
  let best: PreparedNetGraphEdge | null = null;
  let bestDistance = Infinity;
  const threshold = 14 / Math.max(0.001, scale);
  const candidates = querySpatialIndex(graph.edgeSpatialIndex, {
    minX: point.x - threshold,
    minY: point.y - threshold,
    maxX: point.x + threshold,
    maxY: point.y + threshold
  });
  for (const index of candidates) {
    const edge = graph.edges[index];
    if (!edge) continue;
    const source = graph.nodes[edge.sourceIndex];
    const target = graph.nodes[edge.targetIndex];
    if (!source || !target) continue;
    const distance = distanceToPreparedEdge(point, source, target, edge);
    if (distance <= threshold && distance < bestDistance) {
      best = edge;
      bestDistance = distance;
    }
  }
  return { item: best, candidates: candidates.length };
}

export function pointOnPreparedEdge(source: Pick<PreparedNetGraphNode, 'x' | 'y'>, target: Pick<PreparedNetGraphNode, 'x' | 'y'>, edge: Pick<PreparedNetGraphEdge, 'controlX' | 'controlY'>, progress: number): { x: number; y: number } {
  const t = Math.max(0, Math.min(1, progress));
  const oneMinus = 1 - t;
  return {
    x: oneMinus * oneMinus * source.x + 2 * oneMinus * t * edge.controlX + t * t * target.x,
    y: oneMinus * oneMinus * source.y + 2 * oneMinus * t * edge.controlY + t * t * target.y
  };
}

export function preparedEdgeControlPoint(source: Pick<PreparedNetGraphNode, 'x' | 'y'>, target: Pick<PreparedNetGraphNode, 'x' | 'y'>, edge: Pick<PreparedNetGraphEdge, 'id' | 'sourceID' | 'targetID' | 'laneCount' | 'laneOffset'>): { x: number; y: number } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const baseBend = Math.min(58, Math.max(10, length * 0.075));
  const bend = edge.laneCount > 1
    ? edge.laneOffset * baseBend * 0.9 * edgeDirectionSign(edge)
    : fallbackEdgeBend(edge.id, baseBend);
  return {
    x: (source.x + target.x) / 2 + (-dy / length) * bend,
    y: (source.y + target.y) / 2 + (dx / length) * bend
  };
}

export function preparedGraphToData(graph: PreparedNetGraph | null): NetGraphData {
  if (!graph) return { nodes: [], edges: [], nodeByID: new Map(), edgeByID: new Map() };
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    nodeByID: new Map(graph.nodes.map((node) => [node.id, node])),
    edgeByID: new Map(graph.edges.map((edge) => [edge.id, edge]))
  };
}

export function preparedPositions(graph: PreparedNetGraph | null): NetGraphPreviousPosition[] {
  return graph?.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })) ?? [];
}

export function preparedNodeByID(graph: PreparedNetGraph | null, nodeID: string): PreparedNetGraphNode | null {
  return graph ? graph.nodes[graph.nodeIndexByID[nodeID]] ?? null : null;
}

export function preparedEdgeByID(graph: PreparedNetGraph | null, edgeID: string): PreparedNetGraphEdge | null {
  return graph ? graph.edges[graph.edgeIndexByID[edgeID]] ?? null : null;
}

export function edgeIntersectsBounds(edge: PreparedNetGraphEdge, bounds: WorldBounds): boolean {
  return edge.maxX >= bounds.minX && edge.minX <= bounds.maxX && edge.maxY >= bounds.minY && edge.minY <= bounds.maxY;
}

export function nodeIntersectsBounds(node: PreparedNetGraphNode, bounds: WorldBounds): boolean {
  return node.x + node.radius >= bounds.minX && node.x - node.radius <= bounds.maxX && node.y + node.radius >= bounds.minY && node.y - node.radius <= bounds.maxY;
}

function distanceToPreparedEdge(point: { x: number; y: number }, source: PreparedNetGraphNode, target: PreparedNetGraphNode, edge: PreparedNetGraphEdge): number {
  let best = Infinity;
  let previous = pointOnPreparedEdge(source, target, edge, 0);
  for (let step = 1; step <= 10; step++) {
    const current = pointOnPreparedEdge(source, target, edge, step / 10);
    best = Math.min(best, distanceToSegment(point, previous, current));
    previous = current;
  }
  return best;
}

function addIndexToBounds(buckets: Record<string, number[]>, cellSize: number, bounds: WorldBounds, index: number): void {
  const minCellX = Math.floor(bounds.minX / cellSize);
  const maxCellX = Math.floor(bounds.maxX / cellSize);
  const minCellY = Math.floor(bounds.minY / cellSize);
  const maxCellY = Math.floor(bounds.maxY / cellSize);
  for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      const key = cellKey(cellX, cellY);
      const bucket = buckets[key] ?? [];
      bucket.push(index);
      buckets[key] = bucket;
    }
  }
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function edgeDirectionSign(edge: Pick<PreparedNetGraphEdge, 'sourceID' | 'targetID'>): number {
  return edge.sourceID <= edge.targetID ? 1 : -1;
}

function fallbackEdgeBend(edgeID: string, baseBend: number): number {
  const bendSeed = (stableHash(edgeID) % 1000) / 999 - 0.5;
  return Math.sign(bendSeed || 1) * baseBend * (0.45 + Math.abs(bendSeed));
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function distanceToSegment(point: { x: number; y: number }, source: { x: number; y: number }, target: { x: number; y: number }): number {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point.x - source.x, point.y - source.y);
  const t = Math.max(0, Math.min(1, ((point.x - source.x) * dx + (point.y - source.y) * dy) / length));
  return Math.hypot(point.x - (source.x + t * dx), point.y - (source.y + t * dy));
}
