import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force';
import { buildNetGraphData, type NetGraphData, type NetGraphEdge, type NetGraphNode } from '../netgraph';
import {
  buildEdgeRenderPlans,
  graphTopologySignature,
  packedSeedLayout,
  stableVisibleGraph,
  type NetGraphEdgeRenderPlan
} from '../netgraphLayout';
import {
  createEdgeSpatialIndex,
  createNodeSpatialIndex,
  netGraphSettlePlan,
  preparedEdgeControlPoint,
  preparedEdgeSearchText,
  preparedNodeSearchText,
  type NetGraphPrepareInput,
  type NetGraphPreviousPosition,
  type PreparedNetGraph,
  type PreparedNetGraphEdge,
  type PreparedNetGraphNode
} from '../netgraphPrepared';
import { netGraphNodeColor, netGraphNodeShape, netGraphPayloadColor } from '../netgraphVisualModel';

interface SimNode extends NetGraphNode, SimulationNodeDatum {
  seedX: number;
  seedY: number;
  componentID: number;
  componentX: number;
  componentY: number;
  radius: number;
}

interface SimLink extends SimulationLinkDatum<SimNode>, NetGraphEdge {
  renderPlan: NetGraphEdgeRenderPlan;
}

export interface NetGraphTransformRequest {
  id: string;
  type: 'prepare';
  payload: NetGraphPrepareInput;
}

export interface NetGraphTransformResponse {
  id: string;
  graph: PreparedNetGraph;
}

export function transformNetGraph(request: NetGraphTransformRequest): NetGraphTransformResponse {
  if (request.type !== 'prepare') throw new Error(`unsupported netgraph transform: ${request.type}`);
  return {
    id: request.id,
    graph: prepareNetGraph(request.payload)
  };
}

export function prepareNetGraph(input: NetGraphPrepareInput): PreparedNetGraph {
  const prepStartedAt = performanceNow();
  const graph = buildNetGraphData(input.nodes, input.routes);
  const visibleGraph = stableVisibleGraph(graph, { maxNodes: input.maxNodes, maxEdges: input.maxEdges });
  const topologySignature = graphTopologySignature(visibleGraph);
  const previousPositions = new Map((input.previousPositions ?? []).map((position) => [position.id, position]));
  const previousNodeIDs = new Set(previousPositions.keys());
  const topologyReused = Boolean(input.previousTopologySignature && input.previousTopologySignature === topologySignature);

  const layoutStartedAt = performanceNow();
  const settled = settleVisibleGraph({
    graph: visibleGraph,
    width: input.width,
    height: input.height,
    previousPositions,
    previousNodeIDs,
    topologyReused,
    layoutPaused: input.layoutPaused === true
  });
  const layoutMs = performanceNow() - layoutStartedAt;

  const prepared = preparedGraphFromSettledGraph(graph, visibleGraph, topologySignature, settled.nodes, settled.links, performanceNow() - prepStartedAt, layoutMs, settled.layoutTicks, topologyReused);
  return prepared;
}

function settleVisibleGraph({
  graph,
  width,
  height,
  previousPositions,
  previousNodeIDs,
  topologyReused,
  layoutPaused
}: {
  graph: NetGraphData;
  width: number;
  height: number;
  previousPositions: Map<string, NetGraphPreviousPosition>;
  previousNodeIDs: Set<string>;
  topologyReused: boolean;
  layoutPaused: boolean;
}): { nodes: SimNode[]; links: SimLink[]; layoutTicks: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const seedLayout = packedSeedLayout(graph, safeWidth, safeHeight);
  const simNodes = graph.nodes.map((node) => simNodeFromGraphNode(node, seedLayout.get(node.id)));
  let addedNodes = 0;
  for (const node of simNodes) {
    const previous = previousPositions.get(node.id);
    if (previous) {
      node.x = previous.x;
      node.y = previous.y;
      node.vx = previous.vx ?? 0;
      node.vy = previous.vy ?? 0;
      continue;
    }
    addedNodes += 1;
    const neighborSeed = seedNodeNearKnownNeighbors(node, graph, previousPositions);
    if (neighborSeed) {
      node.x = neighborSeed.x;
      node.y = neighborSeed.y;
    }
  }
  const removedNodes = [...previousNodeIDs].filter((id) => !graph.nodeByID.has(id)).length;
  const edgeRenderPlans = buildEdgeRenderPlans(graph.edges);
  const nodeIDs = new Set(simNodes.map((node) => node.id));
  const simLinks = graph.edges
    .filter((edge) => nodeIDs.has(edge.sourceID) && nodeIDs.has(edge.targetID))
    .map((edge) => ({ ...edge, source: edge.sourceID, target: edge.targetID, renderPlan: edgeRenderPlans.get(edge.id)! } satisfies SimLink));

  const settlePlan = topologyReused
    ? { ticks: 0 }
    : netGraphSettlePlan(previousPositions.size, simNodes.length, addedNodes + removedNodes, layoutPaused);
  if (settlePlan.ticks <= 0) return { nodes: simNodes, links: resolveLinkNodes(simLinks, simNodes), layoutTicks: 0 };

  const simulation = forceSimulation<SimNode, SimLink>(simNodes)
    .force('link', forceLink<SimNode, SimLink>(simLinks).id((node) => node.id).distance((link) => linkDistance(link)).strength(0.42))
    .force('charge', forceManyBody<SimNode>().strength((node) => -72 - Math.min(node.degree, 18) * 7))
    .force('collide', forceCollide<SimNode>().radius((node) => node.radius + 14).strength(0.92))
    .force('x', forceX<SimNode>((node) => node.componentX).strength(0.11))
    .force('y', forceY<SimNode>((node) => node.componentY).strength(0.11))
    .force('center', forceCenter(safeWidth / 2, safeHeight / 2).strength(0.018))
    .alphaDecay(0.033)
    .velocityDecay(0.46)
    .stop();
  simulation.tick(settlePlan.ticks);
  simulation.stop();
  return { nodes: simNodes, links: resolveLinkNodes(simLinks, simNodes), layoutTicks: settlePlan.ticks };
}

function preparedGraphFromSettledGraph(
  sourceGraph: NetGraphData,
  visibleGraph: NetGraphData,
  topologySignature: string,
  simNodes: SimNode[],
  simLinks: SimLink[],
  prepMs: number,
  layoutMs: number,
  layoutTicks: number,
  layoutReused: boolean
): PreparedNetGraph {
  const nodeIndexByID: Record<string, number> = {};
  const nodes: PreparedNetGraphNode[] = simNodes.map((node, index) => {
    nodeIndexByID[node.id] = index;
    return {
      ...node,
      x: node.x ?? node.seedX,
      y: node.y ?? node.seedY,
      radius: node.radius,
      color: netGraphNodeColor(node.role, node.isObserver),
      shape: netGraphNodeShape(node.role, node.isObserver),
      searchText: preparedNodeSearchText(node)
    };
  });

  const edgeIndexByID: Record<string, number> = {};
  const edges: PreparedNetGraphEdge[] = simLinks.flatMap((edge) => {
    const sourceIndex = nodeIndexByID[edge.sourceID];
    const targetIndex = nodeIndexByID[edge.targetID];
    const source = nodes[sourceIndex];
    const target = nodes[targetIndex];
    if (!source || !target) return [];
    const { source: _source, target: _target, renderPlan: _renderPlan, ...plainEdge } = edge;
    const control = preparedEdgeControlPoint(source, target, {
      id: edge.id,
      sourceID: edge.sourceID,
      targetID: edge.targetID,
      laneCount: edge.renderPlan.laneCount,
      laneOffset: edge.renderPlan.laneOffset
    });
    const width = edgeWidth(edge);
    const padding = Math.max(16, width + 10);
    const prepared: PreparedNetGraphEdge = {
      ...plainEdge,
      sourceIndex,
      targetIndex,
      laneOffset: edge.renderPlan.laneOffset,
      laneCount: edge.renderPlan.laneCount,
      controlX: control.x,
      controlY: control.y,
      minX: Math.min(source.x, target.x, control.x) - padding,
      minY: Math.min(source.y, target.y, control.y) - padding,
      maxX: Math.max(source.x, target.x, control.x) + padding,
      maxY: Math.max(source.y, target.y, control.y) + padding,
      width,
      color: netGraphPayloadColor(edge.payloadTypeNames[0]),
      searchText: preparedEdgeSearchText(edge)
    };
    return [prepared];
  });
  edges.forEach((edge, index) => {
    edgeIndexByID[edge.id] = index;
  });

  return {
    nodes,
    edges,
    nodeIndexByID,
    edgeIndexByID,
    nodeSpatialIndex: createNodeSpatialIndex(nodes),
    edgeSpatialIndex: createEdgeSpatialIndex(edges),
    topologySignature,
    totalNodes: sourceGraph.nodes.length,
    totalEdges: sourceGraph.edges.length,
    visibleNodes: visibleGraph.nodes.length,
    visibleEdges: visibleGraph.edges.length,
    prepMs: roundMs(prepMs),
    layoutMs: roundMs(layoutMs),
    layoutTicks,
    layoutReused
  };
}

function simNodeFromGraphNode(node: NetGraphNode, seed = { x: 0, y: 0, componentID: 0, componentX: 0, componentY: 0 }): SimNode {
  return {
    ...node,
    x: seed.x,
    y: seed.y,
    seedX: seed.x,
    seedY: seed.y,
    componentID: seed.componentID,
    componentX: seed.componentX,
    componentY: seed.componentY,
    radius: nodeRadius(node)
  };
}

function seedNodeNearKnownNeighbors(node: NetGraphNode, graph: NetGraphData, previousPositions: Map<string, NetGraphPreviousPosition>): { x: number; y: number } | null {
  const neighbors: NetGraphPreviousPosition[] = [];
  for (const edge of graph.edges) {
    const neighborID = edge.sourceID === node.id ? edge.targetID : edge.targetID === node.id ? edge.sourceID : '';
    if (!neighborID) continue;
    const previous = previousPositions.get(neighborID);
    if (typeof previous?.x === 'number' && typeof previous.y === 'number') neighbors.push(previous);
  }
  if (neighbors.length === 0) return null;
  const center = neighbors.reduce<{ x: number; y: number }>(
    (acc, item) => ({ x: acc.x + item.x, y: acc.y + item.y }),
    { x: 0, y: 0 }
  );
  const angle = stableNodeAngle(node.id);
  const radius = 32 + (stableNodeHash(node.id) % 24);
  return {
    x: center.x / neighbors.length + Math.cos(angle) * radius,
    y: center.y / neighbors.length + Math.sin(angle) * radius
  };
}

function resolveLinkNodes(links: SimLink[], nodes: SimNode[]): SimLink[] {
  const byID = new Map(nodes.map((node) => [node.id, node]));
  for (const link of links) {
    link.source = byID.get(link.sourceID) ?? link.sourceID;
    link.target = byID.get(link.targetID) ?? link.targetID;
  }
  return links;
}

function nodeRadius(node: NetGraphNode): number {
  return Math.max(4.5, Math.min(16, 4.5 + Math.sqrt(node.degree) * 2.2 + Math.log1p(node.activityCount) * 0.55 + (node.isObserver ? 1.5 : 0)));
}

function edgeWidth(edge: NetGraphEdge): number {
  return Math.max(0.55, Math.min(1.8, Math.log1p(edge.packetCount) * 0.24));
}

function linkDistance(edge: SimLink): number {
  return Math.max(48, Math.min(132, 52 + Math.sqrt(Math.max(1, edge.distanceKm)) * 3.5));
}

function stableNodeAngle(value: string): number {
  return ((stableNodeHash(value) % 3600) / 3600) * Math.PI * 2;
}

function stableNodeHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function performanceNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function roundMs(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}
