import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Maximize2, Pause, Play, RotateCcw, Search, X } from 'lucide-react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force';
import {
  buildNetGraphData,
  graphSearchMatches,
  observerActivityToGraphGlow,
  routePulseToGraphComets,
  selectionForEdge,
  selectionForNode,
  type NetGraphComet,
  type NetGraphData,
  type NetGraphEdge,
  type NetGraphGlow,
  type NetGraphNode
} from '../netgraph';
import {
  buildEdgeRenderPlans,
  distanceToEdgeCurve,
  edgeControlPoint,
  graphTopologySignature,
  packedComponentCells,
  packedSeedLayout,
  pointOnEdgeCurve,
  stableVisibleGraph,
  type NetGraphEdgeRenderPlan
} from '../netgraphLayout';
import { OBSERVER_NODE_VISUAL, nodeRoleVisual, type NodeIconShape } from '../nodeVisuals';
import { payloadVisual } from '../payloadVisuals';
import type { PublicActivity, PublicNode, PublicRoute, PublicRoutePulse } from '../types';

export { packedComponentCells };

interface NetGraphPanelProps {
  nodes: PublicNode[];
  routes: PublicRoute[];
  pulses: PublicRoutePulse[];
  activity: PublicActivity[];
  socketStatus: string;
  onClose: () => void;
}

type SelectedGraphItem = { type: 'node'; id: string } | { type: 'edge'; id: string } | null;

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

interface GraphTransform {
  x: number;
  y: number;
  k: number;
}

type DragState =
  | { mode: 'pan'; startX: number; startY: number; origin: GraphTransform; moved: boolean }
  | { mode: 'node'; node: SimNode; moved: boolean };

interface PinchState {
  startDistance: number;
  origin: GraphTransform;
  worldAtStart: { x: number; y: number };
}

const MAX_RENDERED_NODES = 2600;
const MAX_RENDERED_EDGES = 4200;
const MAX_GRAPH_COMETS = 360;
const MAX_GRAPH_GLOWS = 220;
const MIN_ZOOM = 0.22;
const MAX_ZOOM = 4.5;
const NETGRAPH_INITIAL_SETTLE_TICKS = 90;
const NETGRAPH_MAJOR_SETTLE_TICKS = 48;
const NETGRAPH_INCREMENTAL_SETTLE_TICKS = 16;

interface PreviousNodePosition {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface NetGraphSettlePlan {
  ticks: number;
  alpha: number;
  restart: boolean;
}

export default function NetGraphPanel({ nodes, routes, pulses, activity, socketStatus, onClose }: NetGraphPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);
  const simLinksByIDRef = useRef(new Map<string, SimLink>());
  const graphRef = useRef<NetGraphData>(buildNetGraphData([], []));
  const transformRef = useRef<GraphTransform>({ x: 0, y: 0, k: 1 });
  const rafRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<PinchState | null>(null);
  const hoveredRef = useRef<SelectedGraphItem>(null);
  const selectedRef = useRef<SelectedGraphItem>(null);
  const selectedHighlightsRef = useRef<ReturnType<typeof selectionForNode>>({ nodeIDs: new Set<string>(), edgeIDs: new Set<string>() });
  const searchMatchesRef = useRef(new Set<string>());
  const seenPulseIDsRef = useRef(new Set<string>());
  const seenActivityIDsRef = useRef(new Set<string>());
  const cometsRef = useRef<NetGraphComet[]>([]);
  const glowsRef = useRef<NetGraphGlow[]>([]);
  const hasFittedRef = useRef(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SelectedGraphItem>(null);
  const [hovered, setHovered] = useState<SelectedGraphItem>(null);
  const [layoutPaused, setLayoutPaused] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const layoutPausedRef = useRef(false);

  const graph = useMemo(() => buildNetGraphData(nodes, routes), [nodes, routes]);
  const visibleGraph = useMemo(() => stableVisibleGraph(graph, { maxNodes: MAX_RENDERED_NODES, maxEdges: MAX_RENDERED_EDGES }), [graph]);
  const topologySignature = useMemo(() => graphTopologySignature(visibleGraph), [visibleGraph]);
  const searchMatches = useMemo(() => graphSearchMatches(graph, query), [graph, query]);
  const selectedNode = selected?.type === 'node' ? graph.nodeByID.get(selected.id) ?? null : null;
  const selectedEdge = selected?.type === 'edge' ? graph.edgeByID.get(selected.id) ?? null : null;
  const selectedHighlights = useMemo(() => {
    if (selected?.type === 'node') return selectionForNode(graph, selected.id);
    if (selected?.type === 'edge') return selectionForEdge(graph, selected.id);
    return { nodeIDs: new Set<string>(), edgeIDs: new Set<string>() };
  }, [graph, selected]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== 0) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      drawGraph();
      if (hasActiveMotion()) scheduleDraw();
    });
  }, []);

  useEffect(() => {
    hoveredRef.current = hovered;
    scheduleDraw();
  }, [hovered, scheduleDraw]);

  useEffect(() => {
    selectedRef.current = selected;
    selectedHighlightsRef.current = selectedHighlights;
    scheduleDraw();
  }, [selected, selectedHighlights, scheduleDraw]);

  useEffect(() => {
    searchMatchesRef.current = searchMatches;
    scheduleDraw();
  }, [searchMatches, scheduleDraw]);

  useEffect(() => {
    layoutPausedRef.current = layoutPaused;
    if (layoutPaused) simulationRef.current?.stop();
  }, [layoutPaused]);

  const fitGraph = useCallback(() => {
    const canvas = canvasRef.current;
    const simNodes = simNodesRef.current;
    if (!canvas || simNodes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const bounds = boundsForNodes(simNodes);
    const scale = Math.max(MIN_ZOOM, Math.min(2.4, Math.min(rect.width / Math.max(1, bounds.width), rect.height / Math.max(1, bounds.height)) * 0.82));
    transformRef.current = {
      k: scale,
      x: rect.width / 2 - (bounds.x + bounds.width / 2) * scale,
      y: rect.height / 2 - (bounds.y + bounds.height / 2) * scale
    };
    scheduleDraw();
  }, [scheduleDraw]);

  const resetLayout = useCallback(() => {
    const simNodes = simNodesRef.current;
    for (const node of simNodes) {
      node.x = node.seedX;
      node.y = node.seedY;
      node.vx = 0;
      node.vy = 0;
      node.fx = null;
      node.fy = null;
    }
    simulationRef.current?.alpha(0.9).restart();
    setLayoutPaused(false);
    fitGraph();
  }, [fitGraph]);

  useEffect(() => {
    graphRef.current = graph;
    mergeGraphMetadataIntoSimulation(graph);
    scheduleDraw();
  }, [graph, scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      resizeCanvas(canvas);
      setCanvasReady(true);
      scheduleDraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const previousPositions = new Map<string, PreviousNodePosition>(
      simNodesRef.current.map((node) => [node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy }])
    );
    const seedLayout = packedSeedLayout(visibleGraph, rect.width, rect.height);
    const simNodes = visibleGraph.nodes.map((node) => simNodeFromGraphNode(node, seedLayout.get(node.id)));
    let addedNodes = 0;
    for (const node of simNodes) {
      const previous = previousPositions.get(node.id);
      if (previous) {
        node.x = previous.x ?? node.seedX;
        node.y = previous.y ?? node.seedY;
        node.vx = previous.vx ?? 0;
        node.vy = previous.vy ?? 0;
        continue;
      }
      addedNodes += 1;
      const neighborSeed = seedNodeNearKnownNeighbors(node, visibleGraph, previousPositions);
      if (neighborSeed) {
        node.x = neighborSeed.x;
        node.y = neighborSeed.y;
      }
    }
    const removedNodes = [...previousPositions.keys()].filter((id) => !visibleGraph.nodeByID.has(id)).length;
    const settlePlan = netGraphSettlePlan(previousPositions.size, simNodes.length, addedNodes + removedNodes, layoutPausedRef.current);
    const nodeIDs = new Set(simNodes.map((node) => node.id));
    const edgeRenderPlans = buildEdgeRenderPlans(visibleGraph.edges);
    const simLinks = visibleGraph.edges
      .filter((edge) => nodeIDs.has(edge.sourceID) && nodeIDs.has(edge.targetID))
      .map((edge) => ({ ...edge, source: edge.sourceID, target: edge.targetID, renderPlan: edgeRenderPlans.get(edge.id)! } satisfies SimLink));
    simNodesRef.current = simNodes;
    simLinksRef.current = simLinks;
    simLinksByIDRef.current = new Map(simLinks.map((edge) => [edge.id, edge]));
    simulationRef.current?.stop();
    const simulation = forceSimulation<SimNode, SimLink>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks).id((node) => node.id).distance((link) => linkDistance(link)).strength(0.42))
      .force('charge', forceManyBody<SimNode>().strength((node) => -72 - Math.min(node.degree, 18) * 7))
      .force('collide', forceCollide<SimNode>().radius((node) => node.radius + 14).strength(0.92))
      .force('x', forceX<SimNode>((node) => node.componentX).strength(0.11))
      .force('y', forceY<SimNode>((node) => node.componentY).strength(0.11))
      .force('center', forceCenter(rect.width / 2, rect.height / 2).strength(0.018))
      .alphaDecay(0.033)
      .velocityDecay(0.46)
      .stop();
    if (settlePlan.ticks > 0) simulation.tick(settlePlan.ticks);
    simulation.on('tick', scheduleDraw);
    simulationRef.current = simulation;
    if (settlePlan.restart) simulation.alpha(settlePlan.alpha).restart();
    scheduleDraw();
    if (!hasFittedRef.current) {
      hasFittedRef.current = true;
      window.setTimeout(fitGraph, 40);
    }
    return () => {
      simulationRef.current?.stop();
      simulationRef.current = null;
    };
  }, [fitGraph, scheduleDraw, topologySignature]);

  useEffect(() => {
    const now = performance.now();
    const nextComets = [...cometsRef.current];
    for (const pulse of pulses) {
      if (seenPulseIDsRef.current.has(pulse.id)) continue;
      seenPulseIDsRef.current.add(pulse.id);
      nextComets.push(...routePulseToGraphComets(pulse, graphRef.current, now));
    }
    cometsRef.current = nextComets.slice(-MAX_GRAPH_COMETS);
    scheduleDraw();
  }, [pulses, scheduleDraw]);

  useEffect(() => {
    const now = performance.now();
    const nextGlows = [...glowsRef.current];
    for (const item of activity) {
      if (seenActivityIDsRef.current.has(item.id)) continue;
      seenActivityIDsRef.current.add(item.id);
      const glow = observerActivityToGraphGlow(item, graphRef.current, now);
      if (glow) nextGlows.push(glow);
    }
    glowsRef.current = nextGlows.slice(-MAX_GRAPH_GLOWS);
    scheduleDraw();
  }, [activity, scheduleDraw]);

  useEffect(() => () => {
    if (rafRef.current !== 0) window.cancelAnimationFrame(rafRef.current);
    simulationRef.current?.stop();
  }, []);

  const toggleLayoutPaused = () => {
    setLayoutPaused((value) => {
      const next = !value;
      if (next) simulationRef.current?.stop();
      else simulationRef.current?.alphaTarget(0.04).restart();
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(null);
    setHovered(null);
    scheduleDraw();
  };

  function mergeGraphMetadataIntoSimulation(latestGraph: NetGraphData) {
    const latestNodes = new Map(latestGraph.nodes.map((node) => [node.id, node]));
    for (const node of simNodesRef.current) {
      const latest = latestNodes.get(node.id);
      if (!latest) continue;
      Object.assign(node, latest, { radius: nodeRadius(latest) });
    }
    const latestEdges = new Map(latestGraph.edges.map((edge) => [edge.id, edge]));
    for (const edge of simLinksRef.current) {
      const latest = latestEdges.get(edge.id);
      if (!latest) continue;
      const source = edge.source;
      const target = edge.target;
      const renderPlan = edge.renderPlan;
      Object.assign(edge, latest, { source, target });
      edge.renderPlan = renderPlan;
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    const pointer = canvasPointer(event, canvas);
    activePointersRef.current.set(event.pointerId, pointer);
    if (activePointersRef.current.size >= 2) {
      pinchRef.current = pinchStateFromPointers(activePointersRef.current, transformRef.current);
      dragRef.current = null;
      return;
    }
    const world = screenToWorld(pointer, transformRef.current);
    const node = hitNode(world);
    if (node) {
      dragRef.current = { mode: 'node', node, moved: false };
      node.fx = node.x;
      node.fy = node.y;
      if (!layoutPausedRef.current) simulationRef.current?.alphaTarget(0.18).restart();
    } else {
      dragRef.current = { mode: 'pan', startX: pointer.x, startY: pointer.y, origin: { ...transformRef.current }, moved: false };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointer = canvasPointer(event, canvas);
    activePointersRef.current.set(event.pointerId, pointer);
    const pinch = pinchRef.current;
    if (pinch && activePointersRef.current.size >= 2) {
      const gesture = twoPointerGesture(activePointersRef.current);
      if (gesture && pinch.startDistance > 0) {
        const nextK = clamp(pinch.origin.k * (gesture.distance / pinch.startDistance), MIN_ZOOM, MAX_ZOOM);
        transformRef.current = {
          k: nextK,
          x: gesture.midpoint.x - pinch.worldAtStart.x * nextK,
          y: gesture.midpoint.y - pinch.worldAtStart.y * nextK
        };
        scheduleDraw();
      }
      return;
    }
    const world = screenToWorld(pointer, transformRef.current);
    const drag = dragRef.current;
    if (drag?.mode === 'node') {
      drag.node.fx = world.x;
      drag.node.fy = world.y;
      drag.moved = true;
      scheduleDraw();
      return;
    }
    if (drag?.mode === 'pan') {
      const dx = pointer.x - drag.startX;
      const dy = pointer.y - drag.startY;
      drag.moved = drag.moved || Math.hypot(dx, dy) > 3;
      transformRef.current = { ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy };
      scheduleDraw();
      return;
    }
    const hoverNode = hitNode(world);
    const hoverEdge = hoverNode ? null : hitEdge(world);
    setHovered(hoverNode ? { type: 'node', id: hoverNode.id } : hoverEdge ? { type: 'edge', id: hoverEdge.id } : null);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointer = canvasPointer(event, canvas);
    activePointersRef.current.delete(event.pointerId);
    if (pinchRef.current) {
      if (activePointersRef.current.size < 2) pinchRef.current = null;
      dragRef.current = null;
      scheduleDraw();
      return;
    }
    const world = screenToWorld(pointer, transformRef.current);
    const drag = dragRef.current;
    if (drag?.mode === 'node') {
      drag.node.fx = null;
      drag.node.fy = null;
      simulationRef.current?.alphaTarget(0);
      if (!drag.moved) setSelected({ type: 'node', id: drag.node.id });
    } else if (drag?.mode === 'pan' && !drag.moved) {
      const node = hitNode(world);
      const edge = node ? null : hitEdge(world);
      setSelected(node ? { type: 'node', id: node.id } : edge ? { type: 'edge', id: edge.id } : null);
    }
    dragRef.current = null;
    scheduleDraw();
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointer = canvasPointer(event, canvas);
    const current = transformRef.current;
    const nextK = clamp(current.k * Math.exp(-event.deltaY * 0.001), MIN_ZOOM, MAX_ZOOM);
    const world = screenToWorld(pointer, current);
    transformRef.current = {
      k: nextK,
      x: pointer.x - world.x * nextK,
      y: pointer.y - world.y * nextK
    };
    scheduleDraw();
  };

  function drawGraph() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const transform = transformRef.current;
    const now = performance.now();
    cometsRef.current = cometsRef.current.filter((comet) => now - comet.startedAt < comet.durationMs + 700);
    glowsRef.current = glowsRef.current.filter((glow) => now - glow.startedAt < glow.durationMs);
    ctx.save();
    ctx.clearRect(0, 0, rect.width, rect.height);
    drawBackground(ctx, rect.width, rect.height);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);
    const hover = hoveredRef.current;
    const hoverSelection = hover?.type === 'node' ? selectionForNode(graphRef.current, hover.id) : hover?.type === 'edge' ? selectionForEdge(graphRef.current, hover.id) : null;
    const selection = selectedHighlightsRef.current;
    drawEdges(ctx, selection, hoverSelection);
    drawComets(ctx, now);
    drawGlows(ctx, now);
    drawNodes(ctx, selection, hoverSelection);
    drawLabels(ctx, selection, hoverSelection);
    ctx.restore();
  }

  function hasActiveMotion(): boolean {
    const now = performance.now();
    return cometsRef.current.some((comet) => now - comet.startedAt < comet.durationMs + 700) || glowsRef.current.some((glow) => now - glow.startedAt < glow.durationMs);
  }

  function drawEdges(ctx: CanvasRenderingContext2D, selection: ReturnType<typeof selectionForNode>, hoverSelection: ReturnType<typeof selectionForNode> | null) {
    for (const edge of simLinksRef.current) {
      const source = linkNode(edge.source);
      const target = linkNode(edge.target);
      if (!source || !target) continue;
      const selectedEdge = selection.edgeIDs.has(edge.id);
      const hover = hoveredRef.current;
      const hoveredEdge = hoverSelection?.edgeIDs.has(edge.id) || hover?.type === 'edge' && hover.id === edge.id;
      const dimmed = selection.edgeIDs.size > 0 && !selectedEdge;
      ctx.globalAlpha = dimmed ? 0.1 : selectedEdge || hoveredEdge ? 0.88 : 0.24;
      ctx.strokeStyle = selectedEdge || hoveredEdge ? '#67e8f9' : edgeColor(edge);
      ctx.lineWidth = selectedEdge || hoveredEdge ? 2.8 : Math.max(0.55, Math.min(1.8, Math.log1p(edge.packetCount) * 0.24));
      const control = edgeControlPoint(source, target, edge, edge.renderPlan);
      ctx.beginPath();
      ctx.moveTo(source.x ?? 0, source.y ?? 0);
      ctx.quadraticCurveTo(control.x, control.y, target.x ?? 0, target.y ?? 0);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawComets(ctx: CanvasRenderingContext2D, now: number) {
    for (const comet of cometsRef.current) {
      const edge = simLinksByIDRef.current.get(comet.edgeID);
      if (!edge) continue;
      const source = linkNode(edge.source);
      const target = linkNode(edge.target);
      if (!source || !target) continue;
      const progress = clamp((now - comet.startedAt) / comet.durationMs, 0, 1);
      const color = payloadVisual(comet.payloadTypeName).color;
      const head = pointOnEdgeCurve(source, target, edge, progress, edge.renderPlan);
      const tail = pointOnEdgeCurve(source, target, edge, Math.max(0, progress - 0.085), edge.renderPlan);
      ctx.save();
      ctx.globalAlpha = 0.74;
      ctx.strokeStyle = color;
      ctx.lineWidth = 4.2;
      ctx.shadowBlur = 20;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawGlows(ctx: CanvasRenderingContext2D, now: number) {
    const nodeByID = new Map(simNodesRef.current.map((node) => [node.id, node]));
    for (const glow of glowsRef.current) {
      const node = nodeByID.get(glow.nodeID);
      if (!node) continue;
      const progress = clamp((now - glow.startedAt) / glow.durationMs, 0, 1);
      const alpha = (1 - progress) * 0.44;
      const color = payloadVisual(glow.payloadTypeName).color;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 28;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, node.radius + 9 + progress * 32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawNodes(ctx: CanvasRenderingContext2D, selection: ReturnType<typeof selectionForNode>, hoverSelection: ReturnType<typeof selectionForNode> | null) {
    for (const node of simNodesRef.current) {
      const selectedNode = selection.nodeIDs.has(node.id);
      const hover = hoveredRef.current;
      const matches = searchMatchesRef.current;
      const hoveredNode = hoverSelection?.nodeIDs.has(node.id) || hover?.type === 'node' && hover.id === node.id;
      const searchMatch = matches.has(node.id);
      const dimmed = (selection.nodeIDs.size > 0 && !selectedNode) || (matches.size > 0 && !searchMatch);
      const color = nodeColor(node);
      ctx.globalAlpha = dimmed ? 0.22 : 1;
      ctx.shadowBlur = selectedNode || hoveredNode || searchMatch ? 18 : 7;
      ctx.shadowColor = color;
      drawNodeGlyph(ctx, node, node.radius + (selectedNode ? 4 : hoveredNode ? 2 : 0), color);
      ctx.shadowBlur = 0;
      ctx.lineWidth = selectedNode || hoveredNode ? 2.3 : 1;
      ctx.strokeStyle = selectedNode ? '#ffffff' : node.isObserver ? '#fbbf24' : 'rgba(255,255,255,0.7)';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawLabels(ctx: CanvasRenderingContext2D, selection: ReturnType<typeof selectionForNode>, hoverSelection: ReturnType<typeof selectionForNode> | null) {
    const scale = transformRef.current.k;
    const hasSearch = searchMatchesRef.current.size > 0;
    const hasFocus = Boolean(selectedRef.current || hoveredRef.current || selection.nodeIDs.size > 0 || hoverSelection);
    if (scale < 0.34 && !hasFocus && !hasSearch) return;
    ctx.save();
    ctx.font = `${Math.max(9, 11 / Math.sqrt(scale))}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const node of simNodesRef.current) {
      const important = node.degree >= 4 || node.isObserver || selection.nodeIDs.has(node.id) || hoverSelection?.nodeIDs.has(node.id) || searchMatchesRef.current.has(node.id);
      if (!important && (hasSearch || hasFocus || scale < 0.62 || node.degree < 8)) continue;
      const x = (node.x ?? 0) + node.radius + 6;
      const y = node.y ?? 0;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(7, 10, 18, 0.92)';
      ctx.strokeText(node.label, x, y);
      ctx.fillStyle = '#e5f7ff';
      ctx.fillText(node.label, x, y);
    }
    ctx.restore();
  }

  function hitNode(point: { x: number; y: number }): SimNode | null {
    let best: SimNode | null = null;
    let bestDistance = Infinity;
    const allowance = 8 / transformRef.current.k;
    for (const node of simNodesRef.current) {
      const distance = Math.hypot(point.x - (node.x ?? 0), point.y - (node.y ?? 0));
      if (distance <= node.radius + allowance && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  function hitEdge(point: { x: number; y: number }): SimLink | null {
    let best: SimLink | null = null;
    let bestDistance = Infinity;
    const threshold = 14 / transformRef.current.k;
    for (const edge of simLinksRef.current) {
      const source = linkNode(edge.source);
      const target = linkNode(edge.target);
      if (!source || !target) continue;
      const distance = distanceToEdgeCurve(point, source, target, edge, edge.renderPlan);
      if (distance <= threshold && distance < bestDistance) {
        best = edge;
        bestDistance = distance;
      }
    }
    return best;
  }

  return (
    <section className="netgraph-panel" aria-label="Live network graph">
      <header className="netgraph-header">
        <div>
          <span className="panel-eyebrow">NetGraph</span>
          <h2>Live Network Graph</h2>
          <p>{graph.nodes.length.toLocaleString()} connected nodes / {graph.edges.length.toLocaleString()} public pathways</p>
        </div>
        <div className="netgraph-toolbar">
          <label className="netgraph-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes, routes, region" />
          </label>
          <button type="button" onClick={fitGraph} title="Fit graph">
            <Maximize2 size={16} />
            <span>Fit</span>
          </button>
          <button type="button" onClick={resetLayout} title="Reset force layout">
            <RotateCcw size={16} />
            <span>Reset</span>
          </button>
          <button type="button" onClick={toggleLayoutPaused} title={layoutPaused ? 'Resume graph layout' : 'Pause graph layout'}>
            {layoutPaused ? <Play size={16} /> : <Pause size={16} />}
            <span>{layoutPaused ? 'Resume' : 'Pause'}</span>
          </button>
          <button type="button" onClick={onClose} title="Close NetGraph">
            <X size={16} />
            <span>Close</span>
          </button>
        </div>
      </header>
      <div className="netgraph-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="netgraph-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        />
        {!canvasReady && <div className="netgraph-empty">Preparing graph layout...</div>}
        {graph.nodes.length === 0 && <div className="netgraph-empty">No connected public routes are available yet.</div>}
        <div className="netgraph-live-chip">
          <Activity size={14} />
          <span>{socketStatus}</span>
          <b>{cometsRef.current.length} live pulses</b>
        </div>
      </div>
      <NetGraphInspector
        selectedNode={selectedNode}
        selectedEdge={selectedEdge}
        directRouteCount={selectedNode ? selectionForNode(graph, selectedNode.id).edgeIDs.size : 0}
        onClear={clearSelection}
      />
    </section>
  );
}

function NetGraphInspector({
  selectedNode,
  selectedEdge,
  directRouteCount,
  onClear
}: {
  selectedNode: NetGraphNode | null;
  selectedEdge: NetGraphEdge | null;
  directRouteCount: number;
  onClear: () => void;
}) {
  if (!selectedNode && !selectedEdge) {
    return (
      <aside className="netgraph-inspector empty">
        <strong>Select a node or pathway</strong>
        <p>Click a graph node to inspect direct RF neighbors, or click a pathway to inspect public route activity.</p>
      </aside>
    );
  }
  return (
    <aside className="netgraph-inspector">
      <button type="button" className="netgraph-inspector-close" onClick={onClear} aria-label="Clear NetGraph selection">
        <X size={15} />
      </button>
      {selectedNode && (
        <>
          <span className="panel-eyebrow">{selectedNode.isObserver ? 'Observer node' : selectedNode.role}</span>
          <h3>{selectedNode.label}</h3>
          <dl>
            <div><dt>Role</dt><dd>{selectedNode.role}</dd></div>
            <div><dt>Observer</dt><dd>{selectedNode.isObserver ? 'Yes' : 'No'}</dd></div>
            <div><dt>Direct routes</dt><dd>{directRouteCount.toLocaleString()}</dd></div>
            <div><dt>Activity</dt><dd>{selectedNode.activityCount.toLocaleString()} packets</dd></div>
            <div><dt>Region</dt><dd>{selectedNode.iatasHeardIn.join(', ') || 'unknown'}</dd></div>
            <div><dt>Last seen</dt><dd>{formatAge(Date.now() - selectedNode.lastSeen)}</dd></div>
          </dl>
        </>
      )}
      {selectedEdge && (
        <>
          <span className="panel-eyebrow">Public pathway</span>
          <h3>{selectedEdge.sourceLabel}{' -> '}{selectedEdge.targetLabel}</h3>
          <dl>
            <div><dt>Route ID</dt><dd>{selectedEdge.id}</dd></div>
            <div><dt>Distance</dt><dd>{selectedEdge.distanceKm.toFixed(1)} km</dd></div>
            <div><dt>Packets</dt><dd>{selectedEdge.packetCount.toLocaleString()}</dd></div>
            <div><dt>Payloads</dt><dd>{selectedEdge.payloadTypeNames.join(', ') || 'unknown'}</dd></div>
            <div><dt>Last heard</dt><dd>{formatAge(Date.now() - selectedEdge.lastHeard)}</dd></div>
          </dl>
        </>
      )}
    </aside>
  );
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

function seedNodeNearKnownNeighbors(node: NetGraphNode, graph: NetGraphData, previousPositions: Map<string, PreviousNodePosition>): { x: number; y: number } | null {
  const neighbors: PreviousNodePosition[] = [];
  for (const edge of graph.edges) {
    const neighborID = edge.sourceID === node.id ? edge.targetID : edge.targetID === node.id ? edge.sourceID : '';
    if (!neighborID) continue;
    const previous = previousPositions.get(neighborID);
    if (typeof previous?.x === 'number' && typeof previous.y === 'number') {
      neighbors.push(previous);
    }
  }
  if (neighbors.length === 0) return null;
  const center = neighbors.reduce<{ x: number; y: number }>(
    (acc, item) => ({ x: acc.x + (item.x ?? 0), y: acc.y + (item.y ?? 0) }),
    { x: 0, y: 0 }
  );
  const angle = stableNodeAngle(node.id);
  const radius = 32 + (stableNodeHash(node.id) % 24);
  return {
    x: center.x / neighbors.length + Math.cos(angle) * radius,
    y: center.y / neighbors.length + Math.sin(angle) * radius
  };
}

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(1.6, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = ctx.createRadialGradient(width * 0.52, height * 0.46, 0, width * 0.52, height * 0.46, Math.max(width, height));
  gradient.addColorStop(0, 'rgba(20, 32, 51, 0.96)');
  gradient.addColorStop(0.56, 'rgba(12, 18, 28, 0.98)');
  gradient.addColorStop(1, 'rgba(5, 9, 15, 1)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function canvasPointer(event: React.PointerEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function twoPointerGesture(pointers: Map<number, { x: number; y: number }>): { midpoint: { x: number; y: number }; distance: number } | null {
  const points = [...pointers.values()];
  if (points.length < 2) return null;
  const [a, b] = points;
  return {
    midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
  };
}

function pinchStateFromPointers(pointers: Map<number, { x: number; y: number }>, transform: GraphTransform): PinchState | null {
  const gesture = twoPointerGesture(pointers);
  if (!gesture) return null;
  return {
    startDistance: gesture.distance,
    origin: { ...transform },
    worldAtStart: screenToWorld(gesture.midpoint, transform)
  };
}

function screenToWorld(point: { x: number; y: number }, transform: GraphTransform): { x: number; y: number } {
  return { x: (point.x - transform.x) / transform.k, y: (point.y - transform.y) / transform.k };
}

function boundsForNodes(nodes: SimNode[]): { x: number; y: number; width: number; height: number } {
  const xs = nodes.map((node) => node.x ?? 0);
  const ys = nodes.map((node) => node.y ?? 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX || 1, height: maxY - minY || 1 };
}

function linkNode(value: string | number | SimNode | undefined): SimNode | null {
  return typeof value === 'object' && value !== null ? value : null;
}

function nodeRadius(node: NetGraphNode): number {
  return Math.max(4.5, Math.min(16, 4.5 + Math.sqrt(node.degree) * 2.2 + Math.log1p(node.activityCount) * 0.55 + (node.isObserver ? 1.5 : 0)));
}

function nodeColor(node: NetGraphNode): string {
  return node.isObserver ? OBSERVER_NODE_VISUAL.color : nodeRoleVisual(node.role).color;
}

function nodeShape(node: NetGraphNode): NodeIconShape {
  return node.isObserver ? OBSERVER_NODE_VISUAL.shape : nodeRoleVisual(node.role).shape;
}

function drawNodeGlyph(ctx: CanvasRenderingContext2D, node: SimNode, radius: number, color: string): void {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const shape = nodeShape(node);
  ctx.beginPath();
  switch (shape) {
    case 'diamond':
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(x, y - radius * 1.05);
      ctx.lineTo(x + radius * 0.96, y + radius * 0.72);
      ctx.lineTo(x - radius * 0.96, y + radius * 0.72);
      ctx.closePath();
      break;
    case 'square':
      ctx.rect(x - radius * 0.82, y - radius * 0.82, radius * 1.64, radius * 1.64);
      break;
    case 'pentagon':
      for (let index = 0; index < 5; index++) {
        const angle = -Math.PI / 2 + index * (Math.PI * 2 / 5);
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    case 'observer':
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      break;
    default:
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      break;
  }
  ctx.fillStyle = color;
  ctx.fill();
  if (shape === 'observer') {
    ctx.save();
    ctx.globalAlpha *= 0.38;
    ctx.lineWidth = Math.max(1, radius * 0.24);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
  }
}

function edgeColor(edge: NetGraphEdge): string {
  const latestPayload = edge.payloadTypeNames[0] ?? '';
  return latestPayload ? payloadVisual(latestPayload).color : '#1d4ed8';
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
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'unknown';
  if (ageMs < 60_000) return `${Math.max(1, Math.round(ageMs / 1000))}s ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  return `${Math.round(ageMs / 86_400_000)}d ago`;
}
