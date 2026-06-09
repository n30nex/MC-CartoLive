import type { PublicNode } from '../types';
import { isMappableNode } from './geo';
import type { NodeFocus } from './nodeFocus';
import { nodeFreshLevel, nodeStaleLevel } from './nodeLabels';

export function nodeSourceSignature(
  nodes: PublicNode[],
  focus: NodeFocus,
  now: number,
  meshActivityAtByNodeID: Map<string, number>
): string {
  return [
    focus.selectedNodeID ?? '',
    stableSetSignature(focus.neighbourNodeIDs),
    stableSetSignature(focus.pathNodeIDs),
    stableSetSignature(focus.pathRouteIDs),
    nodes.filter(isMappableNode).map((node) => nodeRenderIdentity(node, focus, now, meshActivityAtByNodeID)).sort().join('|')
  ].join('~');
}

function nodeRenderIdentity(
  node: PublicNode,
  focus: NodeFocus,
  now: number,
  meshActivityAtByNodeID: Map<string, number>
): string {
  const selected = node.id === focus.selectedNodeID;
  const neighbor = focus.neighbourNodeIDs.has(node.id);
  const path = focus.pathNodeIDs.has(node.id);
  const focusActive = Boolean(focus.selectedNodeID) || focus.pathNodeIDs.size > 0;
  return [
    node.id,
    node.label,
    node.role,
    node.isObserver === true ? 1 : 0,
    roundCoord(node.latitude),
    roundCoord(node.longitude),
    selected ? 1 : 0,
    neighbor ? 1 : 0,
    path ? 1 : 0,
    focusActive && !selected && !neighbor && !path ? 1 : 0,
    nodeStaleLevel(node, now, meshActivityAtByNodeID.get(node.id)),
    nodeFreshLevel(node, now, meshActivityAtByNodeID.get(node.id))
  ].join(':');
}

function stableSetSignature(values: Set<string>): string {
  return [...values].sort().join(',');
}

function roundCoord(value: number): string {
  return Number.isFinite(value) ? value.toFixed(5) : '';
}
