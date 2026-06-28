import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { Activity, Search, X } from 'lucide-react';
import { clamp } from '../lib/clamp';
import { formatRelative } from '../lib/formatRelative';
import { hexToRgba } from '../lib/color';
import {
  observerActivityToGraphGlow,
  routePulseToGraphComets,
  type NetGraphComet,
  type NetGraphData,
  type NetGraphGlow,
  type NetGraphSelection
} from '../netgraph';
import {
  packedComponentCells,
} from '../netgraphLayout';
import { NODE_ROLE_VISUALS, OBSERVER_NODE_VISUAL, nodeRoleVisual } from '../nodeVisuals';
import { payloadLegendVisuals } from '../payloadVisuals';
import {
  edgeIntersectsBounds,
  netGraphSettlePlan,
  nodeIntersectsBounds,
  pointOnPreparedEdge,
  preparedEdgeByID,
  preparedGraphToData,
  preparedHitEdge,
  preparedHitNode,
  preparedNodeByID,
  preparedPositions,
  preparedSearchMatches,
  querySpatialIndex,
  refreshPreparedEdgeGeometry,
  selectionForPreparedEdge,
  selectionForPreparedNode,
  viewportWorldBounds,
  type GraphTransform,
  type PreparedNetGraph,
  type PreparedNetGraphEdge,
  type PreparedNetGraphNode
} from '../netgraphPrepared';
import { netGraphPayloadColor } from '../netgraphVisualModel';
import { recordNetGraphDraw, recordNetGraphHitCandidates, recordNetGraphWorkerError, recordNetGraphWorkerTransform } from '../perfDiagnostics';
import { createBrowserNetGraphClient } from '../workers/netgraphWorkerClient';
import { transformNetGraph } from '../workers/netgraphTransforms';
import type { PublicActivity, PublicNode, PublicRoute, PublicRoutePulse } from '../types';
import { LoadingBlock } from './LoadingPrimitives';

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

export interface NetGraphThemeTokens {
  backgroundInner: string;
  backgroundMid: string;
  backgroundOuter: string;
  selectedEdge: string;
  edgeFallback: string;
  nodeStroke: string;
  observerStroke: string;
  labelText: string;
  labelHalo: string;
  cometHead: string;
}

type DragState =
  | { mode: 'pan'; startX: number; startY: number; origin: GraphTransform; moved: boolean }
  | { mode: 'node'; node: PreparedNetGraphNode; moved: boolean };

interface PinchState {
  startDistance: number;
  origin: GraphTransform;
  worldAtStart: { x: number; y: number };
}

interface CanvasDrawState {
  width: number;
  height: number;
  themeMode: 'light' | 'dark';
  theme: NetGraphThemeTokens;
  gradient: CanvasGradient;
}

const MAX_RENDERED_NODES = 2600;
const MAX_RENDERED_EDGES = 4200;
const MAX_GRAPH_COMETS = 360;
const MAX_GRAPH_GLOWS = 220;
const MIN_ZOOM = 0.22;
const MAX_ZOOM = 4.5;
const DEFAULT_NETGRAPH_THEME: NetGraphThemeTokens = {
  backgroundInner: 'rgba(20, 32, 51, 0.96)',
  backgroundMid: 'rgba(12, 18, 28, 0.98)',
  backgroundOuter: 'rgba(5, 9, 15, 1)',
  selectedEdge: '#67e8f9',
  edgeFallback: '#1d4ed8',
  nodeStroke: 'rgba(255,255,255,0.72)',
  observerStroke: '#fbbf24',
  labelText: '#e5f7ff',
  labelHalo: 'rgba(7, 10, 18, 0.92)',
  cometHead: '#ffffff'
};

export interface NetGraphFrameState {
  pageHidden: boolean;
  activeComets: boolean;
  activeGlows: boolean;
}

export function netGraphShouldRunFrame({ pageHidden, activeComets, activeGlows }: NetGraphFrameState): boolean {
  return !pageHidden && (activeComets || activeGlows);
}

export { netGraphSettlePlan };

const netGraphClient = createBrowserNetGraphClient(transformNetGraph);

export default function NetGraphPanel({ nodes, routes, pulses, activity, socketStatus, onClose }: NetGraphPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const canvasDrawStateRef = useRef<CanvasDrawState | null>(null);
  const preparedGraphRef = useRef<PreparedNetGraph | null>(null);
  const graphDataRef = useRef<NetGraphData>(preparedGraphToData(null));
  const transformRef = useRef<GraphTransform>({ x: 0, y: 0, k: 1 });
  const rafRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<PinchState | null>(null);
  const hoveredRef = useRef<SelectedGraphItem>(null);
  const selectedRef = useRef<SelectedGraphItem>(null);
  const selectedHighlightsRef = useRef<NetGraphSelection>({ nodeIDs: new Set<string>(), edgeIDs: new Set<string>() });
  const searchMatchesRef = useRef(new Set<string>());
  const seenPulseIDsRef = useRef(new Set<string>());
  const seenActivityIDsRef = useRef(new Set<string>());
  const cometsRef = useRef<NetGraphComet[]>([]);
  const glowsRef = useRef<NetGraphGlow[]>([]);
  const hasFittedRef = useRef(false);
  const pageHiddenRef = useRef(typeof document !== 'undefined' ? document.hidden : false);
  const pendingPrepareRef = useRef(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selected, setSelected] = useState<SelectedGraphItem>(null);
  const [hovered, setHovered] = useState<SelectedGraphItem>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [preparedGraph, setPreparedGraph] = useState<PreparedNetGraph | null>(null);
  const layoutPausedRef = useRef(false);

  const selectedNode = selected?.type === 'node' ? preparedNodeByID(preparedGraph, selected.id) : null;
  const selectedEdge = selected?.type === 'edge' ? preparedEdgeByID(preparedGraph, selected.id) : null;
  const selectedHighlights = useMemo(() => {
    if (selected?.type === 'node') return selectionForPreparedNode(preparedGraph, selected.id);
    if (selected?.type === 'edge') return selectionForPreparedEdge(preparedGraph, selected.id);
    return { nodeIDs: new Set<string>(), edgeIDs: new Set<string>() };
  }, [preparedGraph, selected]);

  const scheduleDraw = useCallback(() => {
    if (pageHiddenRef.current) return;
    if (rafRef.current !== 0) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      if (pageHiddenRef.current) return;
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
    const timer = window.setTimeout(() => setDebouncedQuery(query), 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    searchMatchesRef.current = preparedSearchMatches(preparedGraphRef.current, debouncedQuery);
    scheduleDraw();
  }, [debouncedQuery, preparedGraph, scheduleDraw]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibilityChange = () => {
      pageHiddenRef.current = document.hidden;
      if (document.hidden) {
        if (rafRef.current !== 0) {
          window.cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        return;
      }
      scheduleDraw();
    };
    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [scheduleDraw]);

  const fitGraph = useCallback(() => {
    const canvas = canvasRef.current;
    const graph = preparedGraphRef.current;
    if (!canvas || !graph || graph.nodes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const bounds = boundsForNodes(graph.nodes);
    const scale = Math.max(MIN_ZOOM, Math.min(2.4, Math.min(rect.width / Math.max(1, bounds.width), rect.height / Math.max(1, bounds.height)) * 0.82));
    transformRef.current = {
      k: scale,
      x: rect.width / 2 - (bounds.x + bounds.width / 2) * scale,
      y: rect.height / 2 - (bounds.y + bounds.height / 2) * scale
    };
    scheduleDraw();
  }, [scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const next = resizeCanvas(canvas);
      canvasContextRef.current = next.ctx;
      canvasDrawStateRef.current = null;
      setCanvasReady(true);
      setCanvasSize((current) => current.width === next.width && current.height === next.height ? current : { width: next.width, height: next.height });
      scheduleDraw();
    };
    resize();
    return observeNetGraphResize(canvas, resize);
  }, [scheduleDraw]);

  useEffect(() => {
    if (!canvasReady || canvasSize.width <= 0 || canvasSize.height <= 0) return undefined;
    let cancelled = false;
    const previous = preparedGraphRef.current;
    pendingPrepareRef.current = true;
    void netGraphClient.prepare({
      nodes,
      routes,
      width: canvasSize.width,
      height: canvasSize.height,
      maxNodes: MAX_RENDERED_NODES,
      maxEdges: MAX_RENDERED_EDGES,
      previousTopologySignature: previous?.topologySignature,
      previousPositions: preparedPositions(previous),
      layoutPaused: layoutPausedRef.current
    }).then((response) => {
      if (cancelled) return;
      pendingPrepareRef.current = false;
      preparedGraphRef.current = response.graph;
      graphDataRef.current = preparedGraphToData(response.graph);
      searchMatchesRef.current = preparedSearchMatches(response.graph, debouncedQuery);
      setPreparedGraph(response.graph);
      recordNetGraphWorkerTransform(response.workerUsed, response.graph.prepMs, response.graph.layoutMs, response.graph.layoutTicks);
      scheduleDraw();
      if (!hasFittedRef.current && response.graph.nodes.length > 0) {
        hasFittedRef.current = true;
        window.setTimeout(() => {
          if (!pageHiddenRef.current) fitGraph();
        }, 40);
      }
    }).catch(() => {
      if (cancelled) return;
      pendingPrepareRef.current = false;
      recordNetGraphWorkerError();
      scheduleDraw();
    });
    return () => {
      cancelled = true;
    };
  }, [canvasReady, canvasSize.width, canvasSize.height, fitGraph, nodes, routes, scheduleDraw]);

  useEffect(() => {
    const now = performance.now();
    const nextComets = [...cometsRef.current];
    for (const pulse of pulses) {
      if (seenPulseIDsRef.current.has(pulse.id)) continue;
      seenPulseIDsRef.current.add(pulse.id);
      nextComets.push(...routePulseToGraphComets(pulse, graphDataRef.current, now));
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
      const glow = observerActivityToGraphGlow(item, graphDataRef.current, now);
      if (glow) nextGlows.push(glow);
    }
    glowsRef.current = nextGlows.slice(-MAX_GRAPH_GLOWS);
    scheduleDraw();
  }, [activity, scheduleDraw]);

  useEffect(() => () => {
    if (rafRef.current !== 0) window.cancelAnimationFrame(rafRef.current);
  }, []);

  const clearSelection = () => {
    setSelected(null);
    setHovered(null);
    scheduleDraw();
  };

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
      drag.node.x = world.x;
      drag.node.y = world.y;
      const graph = preparedGraphRef.current;
      if (graph) {
        preparedGraphRef.current = refreshPreparedEdgeGeometry(graph);
        graphDataRef.current = preparedGraphToData(preparedGraphRef.current);
      }
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
    const ctx = canvasContextRef.current ?? canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const frameStartedAt = performance.now();
    const drawState = getCanvasDrawState(canvas, ctx, canvasDrawStateRef);
    const graph = preparedGraphRef.current;
    const transform = transformRef.current;
    const now = performance.now();
    cometsRef.current = cometsRef.current.filter((comet) => now - comet.startedAt < comet.durationMs + 700);
    glowsRef.current = glowsRef.current.filter((glow) => now - glow.startedAt < glow.durationMs);
    ctx.save();
    ctx.clearRect(0, 0, drawState.width, drawState.height);
    drawBackground(ctx, drawState);
    if (!graph) {
      ctx.restore();
      return;
    }
    const bounds = viewportWorldBounds(transform, drawState.width, drawState.height);
    const edgeIndexes = querySpatialIndex(graph.edgeSpatialIndex, bounds).filter((index) => {
      const edge = graph.edges[index];
      return Boolean(edge && edgeIntersectsBounds(edge, bounds));
    });
    const nodeIndexes = querySpatialIndex(graph.nodeSpatialIndex, bounds).filter((index) => {
      const node = graph.nodes[index];
      return Boolean(node && nodeIntersectsBounds(node, bounds));
    });
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);
    const hover = hoveredRef.current;
    const hoverSelection = hover?.type === 'node' ? selectionForPreparedNode(graph, hover.id) : hover?.type === 'edge' ? selectionForPreparedEdge(graph, hover.id) : null;
    const selection = selectedHighlightsRef.current;
    drawEdges(ctx, graph, edgeIndexes, selection, hoverSelection, drawState.theme, transform.k);
    drawComets(ctx, graph, now, bounds, drawState.theme, transform.k);
    drawGlows(ctx, graph, now, bounds, transform.k);
    drawNodes(ctx, graph, nodeIndexes, selection, hoverSelection, drawState.theme, transform.k);
    drawLabels(ctx, graph, nodeIndexes, selection, hoverSelection, drawState.theme);
    ctx.restore();
    recordNetGraphDraw(performance.now() - frameStartedAt, nodeIndexes.length, edgeIndexes.length);
  }

  function hasActiveMotion(): boolean {
    const now = performance.now();
    return pendingPrepareRef.current || netGraphShouldRunFrame({
      pageHidden: pageHiddenRef.current,
      activeComets: cometsRef.current.some((comet) => now - comet.startedAt < comet.durationMs + 700),
      activeGlows: glowsRef.current.some((glow) => now - glow.startedAt < glow.durationMs)
    });
  }

  function drawEdges(ctx: CanvasRenderingContext2D, graph: PreparedNetGraph, edgeIndexes: number[], selection: NetGraphSelection, hoverSelection: NetGraphSelection | null, theme: NetGraphThemeTokens, scale: number) {
    const lowDetail = scale < 0.42;
    for (const index of edgeIndexes) {
      const edge = graph.edges[index];
      const source = graph.nodes[edge?.sourceIndex ?? -1];
      const target = graph.nodes[edge?.targetIndex ?? -1];
      if (!source || !target) continue;
      const selectedEdge = selection.edgeIDs.has(edge.id);
      const hover = hoveredRef.current;
      const hoveredEdge = hoverSelection?.edgeIDs.has(edge.id) || hover?.type === 'edge' && hover.id === edge.id;
      const dimmed = selection.edgeIDs.size > 0 && !selectedEdge;
      ctx.globalAlpha = dimmed ? 0.1 : selectedEdge || hoveredEdge ? 0.88 : 0.24;
      ctx.strokeStyle = selectedEdge || hoveredEdge ? theme.selectedEdge : edgeColor(edge, theme);
      ctx.lineWidth = selectedEdge || hoveredEdge ? 2.8 : lowDetail ? Math.max(0.45, edge.width * 0.78) : edge.width;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.quadraticCurveTo(edge.controlX, edge.controlY, target.x, target.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawComets(ctx: CanvasRenderingContext2D, graph: PreparedNetGraph, now: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }, theme: NetGraphThemeTokens, scale: number) {
    const shadowBlur = scale < 0.42 ? 8 : 20;
    for (const comet of cometsRef.current) {
      const edge = graph.edges[graph.edgeIndexByID[comet.edgeID]];
      if (!edge || !edgeIntersectsBounds(edge, bounds)) continue;
      const source = graph.nodes[edge.sourceIndex];
      const target = graph.nodes[edge.targetIndex];
      if (!source || !target) continue;
      const progress = clamp((now - comet.startedAt) / comet.durationMs, 0, 1);
      const color = netGraphPayloadColor(comet.payloadTypeName);
      const head = pointOnPreparedEdge(source, target, edge, progress);
      const tail = pointOnPreparedEdge(source, target, edge, Math.max(0, progress - 0.085));
      ctx.save();
      ctx.globalAlpha = 0.74;
      ctx.strokeStyle = color;
      ctx.lineWidth = 4.2;
      ctx.shadowBlur = shadowBlur;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = theme.cometHead;
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

  function drawGlows(ctx: CanvasRenderingContext2D, graph: PreparedNetGraph, now: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }, scale: number) {
    const shadowBlur = scale < 0.42 ? 10 : 28;
    for (const glow of glowsRef.current) {
      const node = graph.nodes[graph.nodeIndexByID[glow.nodeID]];
      if (!node || !nodeIntersectsBounds(node, bounds)) continue;
      const progress = clamp((now - glow.startedAt) / glow.durationMs, 0, 1);
      const alpha = (1 - progress) * 0.44;
      const color = netGraphPayloadColor(glow.payloadTypeName);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = shadowBlur;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + 9 + progress * 32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawNodes(ctx: CanvasRenderingContext2D, graph: PreparedNetGraph, nodeIndexes: number[], selection: NetGraphSelection, hoverSelection: NetGraphSelection | null, theme: NetGraphThemeTokens, scale: number) {
    const lowDetail = scale < 0.42;
    for (const index of nodeIndexes) {
      const node = graph.nodes[index];
      if (!node) continue;
      const selectedNode = selection.nodeIDs.has(node.id);
      const hover = hoveredRef.current;
      const matches = searchMatchesRef.current;
      const hoveredNode = hoverSelection?.nodeIDs.has(node.id) || hover?.type === 'node' && hover.id === node.id;
      const searchMatch = matches.has(node.id);
      const dimmed = (selection.nodeIDs.size > 0 && !selectedNode) || (matches.size > 0 && !searchMatch);
      const color = node.color;
      ctx.globalAlpha = dimmed ? 0.22 : 1;
      ctx.shadowBlur = lowDetail && !selectedNode && !hoveredNode && !searchMatch ? 0 : selectedNode || hoveredNode || searchMatch ? 18 : 7;
      ctx.shadowColor = color;
      drawNodeGlyph(ctx, node, node.radius + (selectedNode ? 4 : hoveredNode ? 2 : 0), color);
      ctx.shadowBlur = 0;
      ctx.lineWidth = selectedNode || hoveredNode ? 2.3 : 1;
      ctx.strokeStyle = selectedNode ? theme.cometHead : node.isObserver ? theme.observerStroke : theme.nodeStroke;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawLabels(ctx: CanvasRenderingContext2D, graph: PreparedNetGraph, nodeIndexes: number[], selection: NetGraphSelection, hoverSelection: NetGraphSelection | null, theme: NetGraphThemeTokens) {
    const scale = transformRef.current.k;
    const hasSearch = searchMatchesRef.current.size > 0;
    const hasFocus = Boolean(selectedRef.current || hoveredRef.current || selection.nodeIDs.size > 0 || hoverSelection);
    if (scale < 0.34 && !hasFocus && !hasSearch) return;
    ctx.save();
    ctx.font = `${Math.max(9, 11 / Math.sqrt(scale))}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const index of nodeIndexes) {
      const node = graph.nodes[index];
      if (!node) continue;
      const matched = searchMatchesRef.current.has(node.id);
      const focused = selection.nodeIDs.has(node.id) || Boolean(hoverSelection?.nodeIDs.has(node.id));
      const important = node.degree >= 8 || node.isObserver || focused || matched;
      if (hasSearch && !matched && !focused) continue;
      if (hasFocus && !important) continue;
      if (!important && (scale < 1.05 || node.degree < 14)) continue;
      const x = node.x + node.radius + 6;
      const y = node.y;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = theme.labelHalo;
      ctx.strokeText(node.label, x, y);
      ctx.fillStyle = theme.labelText;
      ctx.fillText(node.label, x, y);
    }
    ctx.restore();
  }

  function hitNode(point: { x: number; y: number }): PreparedNetGraphNode | null {
    const result = preparedHitNode(preparedGraphRef.current, point, transformRef.current.k);
    recordNetGraphHitCandidates(result.candidates);
    return result.item;
  }

  function hitEdge(point: { x: number; y: number }): PreparedNetGraphEdge | null {
    const result = preparedHitEdge(preparedGraphRef.current, point, transformRef.current.k);
    recordNetGraphHitCandidates(result.candidates);
    return result.item;
  }

  return (
    <section className="netgraph-panel" aria-label="Live network graph">
      <header className="netgraph-header">
        <div>
          <span className="panel-eyebrow">NetGraph</span>
          <p>{(preparedGraph?.totalNodes ?? 0).toLocaleString()} connected nodes / {(preparedGraph?.totalEdges ?? 0).toLocaleString()} public pathways</p>
        </div>
        <div className="netgraph-toolbar">
          <label className="netgraph-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes, routes, region" />
          </label>
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
        {(!canvasReady || !preparedGraph) && (
          <LoadingBlock
            variant="map"
            title="Preparing graph layout"
            message="Settling connected public routes."
            className="netgraph-loading"
          />
        )}
        {preparedGraph && preparedGraph.nodes.length === 0 && <div className="netgraph-empty">No connected public routes are available yet.</div>}
        <NetGraphLegend />
        <div className="netgraph-live-chip">
          <Activity size={14} />
          <span>{socketStatus}</span>
          <b>{cometsRef.current.length} live pulses</b>
        </div>
      </div>
      <NetGraphInspector
        selectedNode={selectedNode}
        selectedEdge={selectedEdge}
        directRouteCount={selectedNode ? selectionForPreparedNode(preparedGraph, selectedNode.id).edgeIDs.size : 0}
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
  selectedNode: PreparedNetGraphNode | null;
  selectedEdge: PreparedNetGraphEdge | null;
  directRouteCount: number;
  onClear: () => void;
}) {
  const selectedNodeVisual = selectedNode ? selectedNode.isObserver ? OBSERVER_NODE_VISUAL : nodeRoleVisual(selectedNode.role) : null;
  if (!selectedNode && !selectedEdge) {
    return null;
  }
  return (
    <aside className="netgraph-inspector">
      <button type="button" className="netgraph-inspector-close" onClick={onClear} aria-label="Clear NetGraph selection">
        <X size={15} />
      </button>
      {selectedNode && (
        <>
          <span className="panel-eyebrow">{selectedNode.isObserver ? 'Observer node' : selectedNode.role}</span>
          <h3 className="netgraph-inspector-title">
            {selectedNodeVisual && <img src={selectedNodeVisual.icon} alt="" />}
            <span>{selectedNode.label}</span>
          </h3>
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

function NetGraphLegend() {
  const roleVisuals = [...NODE_ROLE_VISUALS.slice(0, 3), OBSERVER_NODE_VISUAL, ...NODE_ROLE_VISUALS.slice(3)];
  const payloads = payloadLegendVisuals();
  return (
    <aside className="netgraph-legend" aria-label="NetGraph legend">
      <div className="netgraph-legend-group">
        <span>Devices</span>
        <div>
          {roleVisuals.map((visual) => (
            <span key={visual.key} className="netgraph-legend-item">
              <img src={visual.icon} alt="" />
              <b>{visual.label}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="netgraph-legend-group">
        <span>Packets</span>
        <div>
          {payloads.map((visual) => (
            <span
              key={visual.className}
              className="netgraph-legend-payload"
              style={{ '--payload-color': visual.color } as CSSProperties}
            >
              <i />
              <b>{visual.shortLabel}</b>
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}

function resizeCanvas(canvas: HTMLCanvasElement): { width: number; height: number; ctx: CanvasRenderingContext2D | null } {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(1.6, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: rect.width, height: rect.height, ctx };
}

export function observeNetGraphResize(element: Element, resize: () => void, win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  if (typeof ResizeObserver === 'function') {
    try {
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      return () => observer.disconnect();
    } catch {
      // Fall through to window resize events when ResizeObserver is unavailable or broken.
    }
  }
  win.addEventListener('resize', resize);
  return () => win.removeEventListener('resize', resize);
}

export function netGraphThemeFromElement(element: Element | null | undefined): NetGraphThemeTokens {
  if (typeof window === 'undefined' || !element) return DEFAULT_NETGRAPH_THEME;
  const style = window.getComputedStyle(element);
  const shell = element.closest<HTMLElement>('.app-shell');
  const mode = shell?.dataset.themeMode ?? document.documentElement.dataset.themeMode ?? 'dark';
  return netGraphThemeFromStyle(style, mode === 'light' ? 'light' : 'dark');
}

export function netGraphThemeFromStyle(style: Pick<CSSStyleDeclaration, 'getPropertyValue'> | null | undefined, mode: 'light' | 'dark' = 'dark'): NetGraphThemeTokens {
  const bgBase = cssToken(style, '--palette-bg-base', DEFAULT_NETGRAPH_THEME.backgroundOuter);
  const bgSurface = cssToken(style, '--palette-bg-surface', DEFAULT_NETGRAPH_THEME.backgroundMid);
  const bgRaised = cssToken(style, '--palette-bg-raised', DEFAULT_NETGRAPH_THEME.backgroundInner);
  const primary = cssToken(style, '--palette-primary', DEFAULT_NETGRAPH_THEME.selectedEdge);
  const secondary = cssToken(style, '--palette-secondary', '#a78bfa');
  const textBright = cssToken(style, '--palette-readable-text', cssToken(style, '--palette-text-bright', DEFAULT_NETGRAPH_THEME.labelText));
  const warn = cssToken(style, '--palette-warn', DEFAULT_NETGRAPH_THEME.observerStroke);
  if (mode === 'light') {
    return {
      backgroundInner: 'rgba(248, 251, 255, 0.98)',
      backgroundMid: 'rgba(236, 244, 252, 0.98)',
      backgroundOuter: 'rgba(218, 230, 242, 1)',
      selectedEdge: primary,
      edgeFallback: secondary,
      nodeStroke: 'rgba(15, 23, 42, 0.68)',
      observerStroke: warn,
      labelText: '#0f172a',
      labelHalo: 'rgba(255, 255, 255, 0.9)',
      cometHead: '#ffffff'
    };
  }
  return {
    backgroundInner: tintColor(bgRaised, 0.96),
    backgroundMid: tintColor(bgSurface, 0.98),
    backgroundOuter: tintColor(bgBase, 1),
    selectedEdge: primary,
    edgeFallback: secondary,
    nodeStroke: 'rgba(255,255,255,0.72)',
    observerStroke: warn,
    labelText: textBright,
    labelHalo: 'rgba(7, 10, 18, 0.92)',
    cometHead: '#ffffff'
  };
}

function cssToken(style: Pick<CSSStyleDeclaration, 'getPropertyValue'> | null | undefined, name: string, fallback: string): string {
  const value = style?.getPropertyValue(name).trim();
  return value || fallback;
}

function tintColor(color: string, alpha: number): string {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return hexToRgba(trimmed, alpha);
  return trimmed;
}

function getCanvasDrawState(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, stateRef: MutableRefObject<CanvasDrawState | null>): CanvasDrawState {
  const rect = canvas.getBoundingClientRect();
  const shell = canvas.closest<HTMLElement>('.app-shell');
  const themeMode: 'light' | 'dark' = (shell?.dataset.themeMode ?? document.documentElement.dataset.themeMode) === 'light' ? 'light' : 'dark';
  const cached = stateRef.current;
  if (cached && cached.width === rect.width && cached.height === rect.height && cached.themeMode === themeMode) return cached;
  const theme = netGraphThemeFromElement(canvas);
  const gradient = ctx.createRadialGradient(rect.width * 0.52, rect.height * 0.46, 0, rect.width * 0.52, rect.height * 0.46, Math.max(rect.width, rect.height));
  gradient.addColorStop(0, theme.backgroundInner);
  gradient.addColorStop(0.56, theme.backgroundMid);
  gradient.addColorStop(1, theme.backgroundOuter);
  const next = { width: rect.width, height: rect.height, themeMode, theme, gradient };
  stateRef.current = next;
  return next;
}

function drawBackground(ctx: CanvasRenderingContext2D, state: CanvasDrawState): void {
  ctx.fillStyle = state.gradient;
  ctx.fillRect(0, 0, state.width, state.height);
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

function boundsForNodes(nodes: PreparedNetGraphNode[]): { x: number; y: number; width: number; height: number } {
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX || 1, height: maxY - minY || 1 };
}

function drawNodeGlyph(ctx: CanvasRenderingContext2D, node: PreparedNetGraphNode, radius: number, color: string): void {
  const x = node.x;
  const y = node.y;
  const shape = node.shape;
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

function edgeColor(edge: PreparedNetGraphEdge, theme: NetGraphThemeTokens): string {
  return edge.color || theme.edgeFallback;
}

function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'unknown';
  return formatRelative(Date.now() - ageMs);
}
