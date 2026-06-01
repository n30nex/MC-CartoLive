import type { NetGraphData, NetGraphEdge, NetGraphNode } from './netgraph';

export interface VisibleGraphLimits {
  maxNodes: number;
  maxEdges: number;
}

export interface NetGraphSeed {
  x: number;
  y: number;
  componentID: number;
  componentX: number;
  componentY: number;
}

export interface NetGraphEdgeRenderPlan {
  edgeID: string;
  corridorKey: string;
  laneIndex: number;
  laneCount: number;
  laneOffset: number;
}

interface Point {
  x?: number;
  y?: number;
}

export function stableVisibleGraph(graph: NetGraphData, limits: VisibleGraphLimits): NetGraphData {
  const visibleNodes = graph.nodes
    .slice()
    .sort(compareNodesForStableLayout)
    .slice(0, limits.maxNodes);
  const visibleNodeIDs = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges
    .filter((edge) => visibleNodeIDs.has(edge.sourceID) && visibleNodeIDs.has(edge.targetID))
    .sort(compareEdgesForStableLayout)
    .slice(0, limits.maxEdges);

  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    nodeByID: new Map(visibleNodes.map((node) => [node.id, node])),
    edgeByID: new Map(visibleEdges.map((edge) => [edge.id, edge]))
  };
}

export function graphTopologySignature(graph: NetGraphData): string {
  const nodes = graph.nodes.map((node) => node.id).sort().join('|');
  const edges = graph.edges.map((edge) => `${edge.id}:${edge.sourceID}>${edge.targetID}`).sort().join('|');
  return `${nodes}::${edges}`;
}

export function buildEdgeRenderPlans(edges: NetGraphEdge[]): Map<string, NetGraphEdgeRenderPlan> {
  const groups = new Map<string, NetGraphEdge[]>();
  for (const edge of edges) {
    const key = edgeCorridorKey(edge);
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }

  const out = new Map<string, NetGraphEdgeRenderPlan>();
  for (const [corridorKey, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = group.slice().sort(compareEdgesForStableLayout);
    const laneCount = ordered.length;
    ordered.forEach((edge, index) => {
      out.set(edge.id, {
        edgeID: edge.id,
        corridorKey,
        laneIndex: index,
        laneCount,
        laneOffset: laneCount === 1 ? 0 : index - (laneCount - 1) / 2
      });
    });
  }
  return out;
}

export function packedSeedLayout(graph: NetGraphData, width: number, height: number): Map<string, NetGraphSeed> {
  const out = new Map<string, NetGraphSeed>();
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
      .sort(compareNodesForStableLayout)
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

export function packedComponentCells(count: number, width: number, height: number): Array<{ x: number; y: number; width: number; height: number }> {
  const centerX = width / 2;
  const centerY = height / 2;
  if (count <= 0) return [];
  const columns = Math.max(1, Math.ceil(Math.sqrt(count * Math.max(0.72, width / Math.max(height, 1)))));
  const rows = Math.max(1, Math.ceil(count / columns));
  const usedWidth = width * Math.min(0.72, count <= 2 ? 0.36 : 0.68);
  const usedHeight = height * Math.min(0.7, count <= 2 ? 0.36 : 0.66);
  const cellWidth = usedWidth / columns;
  const cellHeight = usedHeight / rows;
  const cellSize = Math.max(96, Math.min(cellWidth, cellHeight, Math.min(width, height) * 0.24));
  const orderedSlots: Array<{ column: number; row: number; distance: number }> = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      orderedSlots.push({
        column,
        row,
        distance: Math.hypot(column - (columns - 1) / 2, row - (rows - 1) / 2)
      });
    }
  }
  orderedSlots.sort((a, b) => a.distance - b.distance || a.row - b.row || a.column - b.column);
  const cells: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let index = 0; index < count; index++) {
    const slot = orderedSlots[index] ?? { column: index % columns, row: Math.floor(index / columns), distance: 0 };
    cells.push({
      x: centerX - usedWidth / 2 + (slot.column + 0.5) * cellWidth,
      y: centerY - usedHeight / 2 + (slot.row + 0.5) * cellHeight,
      width: cellSize,
      height: cellSize
    });
  }
  return cells;
}

export function edgeControlPoint(source: Point, target: Point, edge: Pick<NetGraphEdge, 'id' | 'sourceID' | 'targetID'>, plan?: NetGraphEdgeRenderPlan): { x: number; y: number } {
  const x1 = source.x ?? 0;
  const y1 = source.y ?? 0;
  const x2 = target.x ?? 0;
  const y2 = target.y ?? 0;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(1, Math.hypot(dx, dy));
  const baseBend = Math.min(58, Math.max(10, length * 0.075));
  const bend = plan && plan.laneCount > 1
    ? plan.laneOffset * baseBend * 0.9 * edgeDirectionSign(edge)
    : fallbackEdgeBend(edge.id, baseBend);
  return {
    x: (x1 + x2) / 2 + (-dy / length) * bend,
    y: (y1 + y2) / 2 + (dx / length) * bend
  };
}

export function pointOnEdgeCurve(source: Point, target: Point, edge: Pick<NetGraphEdge, 'id' | 'sourceID' | 'targetID'>, progress: number, plan?: NetGraphEdgeRenderPlan): { x: number; y: number } {
  const control = edgeControlPoint(source, target, edge, plan);
  const t = clamp(progress, 0, 1);
  const oneMinus = 1 - t;
  return {
    x: oneMinus * oneMinus * (source.x ?? 0) + 2 * oneMinus * t * control.x + t * t * (target.x ?? 0),
    y: oneMinus * oneMinus * (source.y ?? 0) + 2 * oneMinus * t * control.y + t * t * (target.y ?? 0)
  };
}

export function distanceToEdgeCurve(point: { x: number; y: number }, source: Point, target: Point, edge: Pick<NetGraphEdge, 'id' | 'sourceID' | 'targetID'>, plan?: NetGraphEdgeRenderPlan): number {
  let best = Infinity;
  let previous = pointOnEdgeCurve(source, target, edge, 0, plan);
  for (let step = 1; step <= 18; step++) {
    const current = pointOnEdgeCurve(source, target, edge, step / 18, plan);
    best = Math.min(best, distanceToSegment(point, previous, current));
    previous = current;
  }
  return best;
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
  return components.sort((a, b) => b.nodes.length - a.nodes.length || compareNodesForStableLayout(a.nodes[0], b.nodes[0]));
}

function compareNodesForStableLayout(a: NetGraphNode, b: NetGraphNode): number {
  return b.degree - a.degree || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

function compareEdgesForStableLayout(a: NetGraphEdge, b: NetGraphEdge): number {
  return edgeCorridorKey(a).localeCompare(edgeCorridorKey(b)) || a.id.localeCompare(b.id);
}

function edgeCorridorKey(edge: Pick<NetGraphEdge, 'sourceID' | 'targetID'>): string {
  return edge.sourceID <= edge.targetID ? `${edge.sourceID}|${edge.targetID}` : `${edge.targetID}|${edge.sourceID}`;
}

function edgeDirectionSign(edge: Pick<NetGraphEdge, 'sourceID' | 'targetID'>): number {
  return edge.sourceID <= edge.targetID ? 1 : -1;
}

function fallbackEdgeBend(edgeID: string, baseBend: number): number {
  const bendSeed = (stableHash(edgeID) % 1000) / 999 - 0.5;
  return Math.sign(bendSeed || 1) * baseBend * (0.45 + Math.abs(bendSeed));
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

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function distanceToSegment(point: { x: number; y: number }, source: Point, target: Point): number {
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
