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
import { payloadVisual } from '../payloadVisuals';
import type { PublicActivity, PublicNode, PublicRoute, PublicRoutePulse } from '../types';

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

interface SimLink extends SimulationLinkDatum<SimNode>, NetGraphEdge {}

interface GraphTransform {
  x: number;
  y: number;
  k: number;
}

type DragState =
  | { mode: 'pan'; startX: number; startY: number; origin: GraphTransform; moved: boolean }
  | { mode: 'node'; node: SimNode; moved: boolean };

const MAX_RENDERED_NODES = 2600;
const MAX_RENDERED_EDGES = 4200;
const MAX_GRAPH_COMETS = 360;
const MAX_GRAPH_GLOWS = 220;
const MIN_ZOOM = 0.22;
const MAX_ZOOM = 4.5;

export default function NetGraphPanel({ nodes, routes, pulses, activity, socketStatus, onClose }: NetGraphPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);
  const graphRef = useRef<NetGraphData>(buildNetGraphData([], []));
  const transformRef = useRef<GraphTransform>({ x: 0, y: 0, k: 1 });
  const rafRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
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
  const visibleGraph = useMemo(() => ({
    ...graph,
    nodes: graph.nodes.slice(0, MAX_RENDERED_NODES),
    edges: graph.edges.slice(0, MAX_RENDERED_EDGES)
  }), [graph]);
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
    const previousPositions = new Map(
      simNodesRef.current.map((node) => [node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy }])
    );
    const seedLayout = packedSeedLayout(visibleGraph, rect.width, rect.height);
    const simNodes = visibleGraph.nodes.map((node) => simNodeFromGraphNode(node, seedLayout.get(node.id)));
    for (const node of simNodes) {
      const previous = previousPositions.get(node.id);
      if (!previous) continue;
      node.x = previous.x ?? node.seedX;
      node.y = previous.y ?? node.seedY;
      node.vx = previous.vx ?? 0;
      node.vy = previous.vy ?? 0;
    }
    const nodeIDs = new Set(simNodes.map((node) => node.id));
    const simLinks = visibleGraph.edges
      .filter((edge) => nodeIDs.has(edge.sourceID) && nodeIDs.has(edge.targetID))
      .map((edge) => ({ ...edge, source: edge.sourceID, target: edge.targetID } satisfies SimLink));
    simNodesRef.current = simNodes;
    simLinksRef.current = simLinks;
    simulationRef.current?.stop();
    const simulation = forceSimulation<SimNode, SimLink>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks).id((node) => node.id).distance((link) => linkDistance(link)).strength(0.42))
      .force('charge', forceManyBody<SimNode>().strength((node) => -135 - node.degree * 12))
      .force('collide', forceCollide<SimNode>().radius((node) => node.radius + 14).strength(0.92))
      .force('x', forceX<SimNode>((node) => node.componentX).strength(0.055))
      .force('y', forceY<SimNode>((node) => node.componentY).strength(0.055))
      .force('center', forceCenter(rect.width / 2, rect.height / 2).strength(0.028))
      .alphaDecay(0.033)
      .velocityDecay(0.46)
      .stop();
    simulation.tick(150);
    simulation.on('tick', scheduleDraw);
    simulationRef.current = simulation;
    if (!layoutPausedRef.current) simulation.alpha(0.18).restart();
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
      Object.assign(edge, latest, { source, target });
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    const pointer = canvasPointer(event, canvas);
    const world = screenToWorld(pointer, transformRef.current);
    const node = hitNode(world);
    if (node) {
      dragRef.current = { mode: 'node', node, moved: false };
      node.fx = node.x;
      node.fy = node.y;
      simulationRef.current?.alphaTarget(0.18).restart();
    } else {
      dragRef.current = { mode: 'pan', startX: pointer.x, startY: pointer.y, origin: { ...transformRef.current }, moved: false };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointer = canvasPointer(event, canvas);
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
      const control = edgeControlPoint(source, target, edge);
      ctx.beginPath();
      ctx.moveTo(source.x ?? 0, source.y ?? 0);
      ctx.quadraticCurveTo(control.x, control.y, target.x ?? 0, target.y ?? 0);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawComets(ctx: CanvasRenderingContext2D, now: number) {
    for (const comet of cometsRef.current) {
      const edge = simLinksRef.current.find((item) => item.id === comet.edgeID);
      if (!edge) continue;
      const source = linkNode(edge.source);
      const target = linkNode(edge.target);
      if (!source || !target) continue;
      const progress = clamp((now - comet.startedAt) / comet.durationMs, 0, 1);
      const color = payloadVisual(comet.payloadTypeName).color;
      const head = pointOnEdgeCurve(source, target, edge, progress);
      const tail = pointOnEdgeCurve(source, target, edge, Math.max(0, progress - 0.085));
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
      ctx.fillStyle = color;
      ctx.shadowBlur = selectedNode || hoveredNode || searchMatch ? 18 : 7;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, node.radius + (selectedNode ? 4 : hoveredNode ? 2 : 0), 0, Math.PI * 2);
      ctx.fill();
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
      const distance = distanceToEdgeCurve(point, source, target, edge);
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
  if (node.isObserver) return '#f59e0b';
  if (node.role === 'repeater') return '#22c55e';
  if (node.role === 'room_server') return '#a855f7';
  if (node.role === 'companion') return '#60a5fa';
  return '#38bdf8';
}

function edgeColor(edge: NetGraphEdge): string {
  const latestPayload = edge.payloadTypeNames[0] ?? '';
  return latestPayload ? payloadVisual(latestPayload).color : '#1d4ed8';
}

function linkDistance(edge: SimLink): number {
  return Math.max(48, Math.min(132, 52 + Math.sqrt(Math.max(1, edge.distanceKm)) * 3.5));
}

function graphTopologySignature(graph: NetGraphData): string {
  const nodes = graph.nodes.map((node) => node.id).sort().join('|');
  const edges = graph.edges.map((edge) => `${edge.id}:${edge.sourceID}>${edge.targetID}`).sort().join('|');
  return `${nodes}::${edges}`;
}

function packedSeedLayout(graph: NetGraphData, width: number, height: number): Map<string, { x: number; y: number; componentID: number; componentX: number; componentY: number }> {
  const out = new Map<string, { x: number; y: number; componentID: number; componentX: number; componentY: number }>();
  const components = connectedComponents(graph);
  if (components.length === 0) return out;
  const cells = packedComponentCells(components.length, width, height);
  const largest = Math.max(1, components[0].nodes.length);
  components.forEach((component, componentID) => {
    const cell = cells[componentID] ?? { x: width / 2, y: height / 2, width: width * 0.72, height: height * 0.72 };
    const spreadBase = components.length === 1 ? Math.min(width, height) * 0.31 : Math.min(cell.width, cell.height) * 0.31;
    const spread = Math.max(34, spreadBase * Math.max(0.52, Math.sqrt(component.nodes.length / largest)));
    const bounds = latLngBounds(component.nodes);
    component.nodes
      .slice()
      .sort((a, b) => b.degree - a.degree || b.activityCount - a.activityCount || a.label.localeCompare(b.label))
      .forEach((node, index) => {
        const ranked = radialSeed(index, component.nodes.length, spread);
        const hasGeoShape = bounds.latSpan > 0.01 || bounds.lngSpan > 0.01;
        const geoX = hasGeoShape ? ((node.lng - bounds.minLng) / Math.max(bounds.lngSpan, 0.01) - 0.5) * spread * 1.8 : ranked.x;
        const geoY = hasGeoShape ? ((bounds.maxLat - node.lat) / Math.max(bounds.latSpan, 0.01) - 0.5) * spread * 1.8 : ranked.y;
        const blend = component.nodes.length > 3 && hasGeoShape ? 0.32 : 0;
        out.set(node.id, {
          x: cell.x + geoX * blend + ranked.x * (1 - blend),
          y: cell.y + geoY * blend + ranked.y * (1 - blend),
          componentID,
          componentX: cell.x,
          componentY: cell.y
        });
      });
  });
  return out;
}

function connectedComponents(graph: NetGraphData): Array<{ nodes: NetGraphNode[] }> {
  const adjacency = new Map<string, Set<string>>();
  for (const node of graph.nodes) adjacency.set(node.id, new Set<string>());
  for (const edge of graph.edges) {
    adjacency.get(edge.sourceID)?.add(edge.targetID);
    adjacency.get(edge.targetID)?.add(edge.sourceID);
  }
  const byID = graph.nodeByID;
  const visited = new Set<string>();
  const components: Array<{ nodes: NetGraphNode[] }> = [];
  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;
    const queue = [node.id];
    const ids: string[] = [];
    visited.add(node.id);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      ids.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    components.push({ nodes: ids.map((id) => byID.get(id)).filter((item): item is NetGraphNode => Boolean(item)) });
  }
  return components.sort((a, b) => b.nodes.length - a.nodes.length);
}

function packedComponentCells(count: number, width: number, height: number): Array<{ x: number; y: number; width: number; height: number }> {
  const centerX = width / 2;
  const centerY = height / 2;
  const cellSize = Math.max(118, Math.min(width, height) / Math.max(2.9, Math.sqrt(count) + 0.9));
  const radiusX = Math.max(110, width * 0.23);
  const radiusY = Math.max(90, height * 0.23);
  const cells: Array<{ x: number; y: number; width: number; height: number }> = [{ x: centerX, y: centerY, width: cellSize, height: cellSize }];
  for (let index = 1; index < count; index++) {
    const ring = Math.sqrt(index / Math.max(1, count - 1));
    const angle = index * 2.399963229728653;
    cells.push({
      x: centerX + Math.cos(angle) * radiusX * ring,
      y: centerY + Math.sin(angle) * radiusY * ring,
      width: cellSize,
      height: cellSize
    });
  }
  return cells;
}

function latLngBounds(nodes: NetGraphNode[]): { minLat: number; maxLat: number; minLng: number; maxLng: number; latSpan: number; lngSpan: number } {
  const lats = nodes.map((node) => node.lat);
  const lngs = nodes.map((node) => node.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return { minLat, maxLat, minLng, maxLng, latSpan: maxLat - minLat, lngSpan: maxLng - minLng };
}

function radialSeed(index: number, count: number, spread: number): { x: number; y: number } {
  if (count <= 1) return { x: 0, y: 0 };
  const angle = index * 2.399963229728653;
  const radius = spread * Math.sqrt((index + 0.5) / count);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function edgeControlPoint(source: Pick<SimNode, 'x' | 'y'>, target: Pick<SimNode, 'x' | 'y'>, edge: SimLink): { x: number; y: number } {
  const x1 = source.x ?? 0;
  const y1 = source.y ?? 0;
  const x2 = target.x ?? 0;
  const y2 = target.y ?? 0;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(1, Math.hypot(dx, dy));
  const bendSeed = (stableHash(edge.id) % 1000) / 999 - 0.5;
  const bend = Math.sign(bendSeed || 1) * Math.min(58, Math.max(10, length * 0.075)) * (0.45 + Math.abs(bendSeed));
  return {
    x: (x1 + x2) / 2 + (-dy / length) * bend,
    y: (y1 + y2) / 2 + (dx / length) * bend
  };
}

function pointOnEdgeCurve(source: Pick<SimNode, 'x' | 'y'>, target: Pick<SimNode, 'x' | 'y'>, edge: SimLink, progress: number): { x: number; y: number } {
  const control = edgeControlPoint(source, target, edge);
  const t = clamp(progress, 0, 1);
  const oneMinus = 1 - t;
  return {
    x: oneMinus * oneMinus * (source.x ?? 0) + 2 * oneMinus * t * control.x + t * t * (target.x ?? 0),
    y: oneMinus * oneMinus * (source.y ?? 0) + 2 * oneMinus * t * control.y + t * t * (target.y ?? 0)
  };
}

function distanceToEdgeCurve(point: { x: number; y: number }, source: Pick<SimNode, 'x' | 'y'>, target: Pick<SimNode, 'x' | 'y'>, edge: SimLink): number {
  let best = Infinity;
  let previous = pointOnEdgeCurve(source, target, edge, 0);
  for (let step = 1; step <= 18; step++) {
    const current = pointOnEdgeCurve(source, target, edge, step / 18);
    best = Math.min(best, distanceToSegment(point, previous, current));
    previous = current;
  }
  return best;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function distanceToSegment(point: { x: number; y: number }, source: Pick<SimNode, 'x' | 'y'>, target: Pick<SimNode, 'x' | 'y'>): number {
  const x1 = source.x ?? 0;
  const y1 = source.y ?? 0;
  const x2 = target.x ?? 0;
  const y2 = target.y ?? 0;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point.x - x1, point.y - y1);
  const t = clamp(((point.x - x1) * dx + (point.y - y1) * dy) / length, 0, 1);
  return Math.hypot(point.x - (x1 + t * dx), point.y - (y1 + t * dy));
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
