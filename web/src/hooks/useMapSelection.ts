import { useCallback, useMemo, useState } from 'react';
import {
  buildConnectivityGraph,
  directConnectivity,
  highlightedPathForTarget,
  phonebookGroupsForNode
} from '../connectivity';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { packetNodeIDs, packetRouteIDs } from '../packets';
import { messageHistoryForNode, routeNodeIDs } from '../routeTools';
import {
  clearSelection as emptySelection,
  selectNodeSelection,
  selectPathTargetSelection,
  selectRouteSelection,
  type SelectionState
} from '../selection';
import { filterNodes, filterRoutes, type AppState } from '../state';
import type { PlotResult } from '../components/PlotRoutesPanel';
import type { PublicPacketPath } from '../types';

interface MapSelectionOptions {
  state: AppState;
  query: string;
  initialNodeID: string | null;
  initialRouteID: string | null;
  plotResult: PlotResult | null;
}

/**
 * Owns the public map's mutually-exclusive node/route/packet selection and all
 * derived connectivity/highlight data consumed by the map and selection drawer.
 */
export function useMapSelection({
  state,
  query,
  initialNodeID,
  initialRouteID,
  plotResult
}: MapSelectionOptions) {
  const [selectedNodeID, setSelectedNodeID] = useState<string | null>(initialNodeID);
  const [selectedRouteID, setSelectedRouteID] = useState<string | null>(initialRouteID);
  const [selectedPacket, setSelectedPacket] = useState<PublicPacketPath | null>(null);
  const [highlightedPathTargetID, setHighlightedPathTargetID] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 200);

  const visibleNodes = useMemo(() => filterNodes(state.nodes, debouncedQuery), [state.nodes, debouncedQuery]);
  const visibleNodeIDs = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleRoutes = useMemo(() => filterRoutes(state.routes, visibleNodeIDs, debouncedQuery), [state.routes, visibleNodeIDs, debouncedQuery]);
  const routeViewRevision = useMemo(
    () => debouncedQuery
      ? `${state.routeTopologyRevision}:${debouncedQuery}:${visibleRoutes.map((route) => route.id).join(',')}`
      : String(state.routeTopologyRevision),
    [debouncedQuery, state.routeTopologyRevision, visibleRoutes]
  );
  const selectedNode = useMemo(() => state.nodes.find((node) => node.id === selectedNodeID) ?? null, [state.nodes, selectedNodeID]);
  const selectedRoute = useMemo(() => state.routes.find((route) => route.id === selectedRouteID) ?? null, [state.routes, selectedRouteID]);
  // Packet counts update frequently but do not change graph topology. Keep the
  // expensive connectivity model stable until nodes, route membership, or the
  // active filter actually changes.
  const connectivityGraph = useMemo(
    () => buildConnectivityGraph(visibleNodes, visibleRoutes),
    [visibleNodes, state.routeTopologyRevision, debouncedQuery]
  );
  const selectedConnectivity = useMemo(() => directConnectivity(connectivityGraph, selectedNodeID), [connectivityGraph, selectedNodeID]);
  const phonebookGroups = useMemo(() => phonebookGroupsForNode(connectivityGraph, selectedNodeID), [connectivityGraph, selectedNodeID]);
  const highlightedPath = useMemo(() => highlightedPathForTarget(phonebookGroups, highlightedPathTargetID), [phonebookGroups, highlightedPathTargetID]);
  const selectedPhonebookPath = useMemo(
    () => phonebookGroups.flatMap((group) => group.nodes).find((item) => item.node.id === highlightedPathTargetID) ?? null,
    [phonebookGroups, highlightedPathTargetID]
  );
  const plotHighlightedRouteIDs = useMemo(() => {
    if (plotResult?.type === 'path') return new Set(plotResult.path?.pathRouteIDs ?? []);
    if (plotResult?.type === 'area') return new Set(plotResult.routes.map((route) => route.id));
    return new Set<string>();
  }, [plotResult]);
  const plotHighlightedNodeIDs = useMemo(() => {
    if (plotResult?.type === 'path') return new Set(plotResult.path?.pathNodeIDs ?? []);
    if (plotResult?.type === 'area') return routeNodeIDs(plotResult.routes);
    return new Set<string>();
  }, [plotResult]);
  const selectedPacketRouteIDs = useMemo(() => packetRouteIDs(selectedPacket), [selectedPacket]);
  const selectedPacketNodeIDs = useMemo(() => packetNodeIDs(selectedPacket), [selectedPacket]);
  const highlightedPathRouteIDs = useMemo(
    () => new Set([...(highlightedPath?.routeIDs ?? []), ...plotHighlightedRouteIDs, ...selectedPacketRouteIDs]),
    [highlightedPath, plotHighlightedRouteIDs, selectedPacketRouteIDs]
  );
  const highlightedPathNodeIDs = useMemo(
    () => new Set([...(highlightedPath?.nodeIDs ?? []), ...plotHighlightedNodeIDs, ...selectedPacketNodeIDs]),
    [highlightedPath, plotHighlightedNodeIDs, selectedPacketNodeIDs]
  );
  const selectedNodeMessageHistory = useMemo(
    () => messageHistoryForNode(selectedNode, visibleRoutes, state.activity),
    [selectedNode, state.activity, visibleRoutes]
  );

  const applySelection = useCallback((next: SelectionState) => {
    setSelectedNodeID(next.selectedNodeID);
    setSelectedRouteID(next.selectedRouteID);
    setHighlightedPathTargetID(next.highlightedPathTargetID);
  }, []);

  const clearResolvedSelection = useCallback(() => applySelection(emptySelection()), [applySelection]);
  const clearSelection = useCallback(() => {
    setSelectedPacket(null);
    clearResolvedSelection();
  }, [clearResolvedSelection]);
  const selectNode = useCallback((nodeID: string) => {
    setSelectedPacket(null);
    applySelection(selectNodeSelection(nodeID));
  }, [applySelection]);
  const selectRoute = useCallback((routeID: string) => {
    setSelectedPacket(null);
    applySelection(selectRouteSelection(routeID));
  }, [applySelection]);
  const selectPhonebookPath = useCallback((nodeID: string) => {
    setSelectedPacket(null);
    applySelection(selectPathTargetSelection({ selectedNodeID, selectedRouteID, highlightedPathTargetID }, nodeID));
  }, [applySelection, highlightedPathTargetID, selectedNodeID, selectedRouteID]);
  const selectPacket = useCallback((packet: PublicPacketPath) => {
    setSelectedPacket(packet);
    clearResolvedSelection();
  }, [clearResolvedSelection]);
  return {
    visibleNodes,
    visibleRoutes,
    routeViewRevision,
    selectedNodeID,
    selectedRouteID,
    selectedPacket,
    highlightedPathTargetID,
    selectedNode,
    selectedRoute,
    connectivityGraph,
    selectedConnectivity,
    phonebookGroups,
    selectedPhonebookPath,
    highlightedPathRouteIDs,
    highlightedPathNodeIDs,
    selectedNodeMessageHistory,
    clearSelection,
    clearResolvedSelection,
    selectNode,
    selectRoute,
    selectPhonebookPath,
    selectPacket
  };
}
