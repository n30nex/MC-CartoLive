import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, Pause, Play, RadioTower, RotateCcw, Search, Share2, X } from 'lucide-react';
import { fetchPublicState } from './api';
import { connectPublicSocket } from './ws';
import {
  applyPublicEnvelope,
  emptyState,
  filterNodes,
  filterRoutes,
  initialAppState,
  liveCoverageStats,
  summarizeRouteActivity,
  type AppState
} from './state';
import CanadaMap, { type MapAction } from './map/CanadaMap';
import HotRoutes from './components/HotRoutes';
import Legend from './components/Legend';
import LinkBar from './components/LinkBar';
import PlotRoutesPanel, { type PlotMode, type PlotResult } from './components/PlotRoutesPanel';
import SelectionDrawer from './components/SelectionDrawer';
import StatusBar from './components/StatusBar';
import {
  buildConnectivityGraph,
  directConnectivity,
  highlightedPathForTarget,
  phonebookGroupsForNode,
  shortestPathBetween
} from './connectivity';
import { boundsFromPoints, meshcorePathCopyText, messageHistoryForNode, routeNodeIDs, routesInBounds, type MapPoint } from './routeTools';
import {
  clearSelection as clearSelectionState,
  selectNodeSelection,
  selectPathTargetSelection,
  selectRouteSelection,
  type SelectionState
} from './selection';
import { buildSharedViewURL, parseSharedView, type MapViewState } from './shareView';
import type { PublicActivity, PublicLiveEnvelope } from './types';

export default function App() {
  const sharedViewRef = useRef(parseSharedView(window.location.search));
  const [state, setState] = useState<AppState>(emptyState);
  const [socketStatus, setSocketStatus] = useState('starting');
  const [paused, setPaused] = useState(false);
  const [followTraffic, setFollowTraffic] = useState(false);
  const [query, setQuery] = useState(() => sharedViewRef.current?.q ?? '');
  const [clearToken, setClearToken] = useState(0);
  const [mapAction, setMapAction] = useState<MapAction>(null);
  const [selectedNodeID, setSelectedNodeID] = useState<string | null>(() => sharedViewRef.current?.node ?? null);
  const [selectedRouteID, setSelectedRouteID] = useState<string | null>(() => sharedViewRef.current?.route ?? null);
  const [highlightedPathTargetID, setHighlightedPathTargetID] = useState<string | null>(null);
  const [plotMode, setPlotMode] = useState<PlotMode>('off');
  const [plotFirstNodeID, setPlotFirstNodeID] = useState<string | null>(null);
  const [plotAreaFirstPoint, setPlotAreaFirstPoint] = useState<MapPoint | null>(null);
  const [plotResult, setPlotResult] = useState<PlotResult | null>(null);
  const [pathCopyToast, setPathCopyToast] = useState<string | null>(null);
  const [mapView, setMapView] = useState<MapViewState | null>(() => {
    const shared = sharedViewRef.current;
    return shared ? { lat: shared.lat, lng: shared.lng, z: shared.z } : null;
  });
  const [initialLoadGateOpen, setInitialLoadGateOpen] = useState(true);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [liveClock, setLiveClock] = useState(() => Date.now());
  const [initialNodesReceived, setInitialNodesReceived] = useState(false);
  const [positionedNodesRendered, setPositionedNodesRendered] = useState(false);
  const [nodeLoadFailed, setNodeLoadFailed] = useState(false);
  const actionTokenRef = useRef(0);
  const pendingMessagesRef = useRef<PublicLiveEnvelope[]>([]);
  const flushMessagesRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (initialNodesReceived) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    const loadState = () => {
      fetchPublicState()
        .then((liveState) => {
          if (cancelled) return;
          setState(initialAppState(liveState));
          if ((liveState.nodes?.length ?? 0) > 0) {
            setInitialNodesReceived(true);
          } else {
            retryTimer = window.setTimeout(loadState, 1500);
          }
          setNodeLoadFailed(false);
        })
        .catch(() => {
          if (cancelled) return;
          setSocketStatus('state-error');
          setNodeLoadFailed(true);
          retryTimer = window.setTimeout(loadState, 2000);
        });
    };
    loadState();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [initialNodesReceived]);

  useEffect(() => {
    let openedOnce = false;
    let active = true;
    const flushMessages = () => {
      flushMessagesRafRef.current = null;
      if (!active || pendingMessagesRef.current.length === 0) return;
      const messages = pendingMessagesRef.current
        .slice()
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || (a.displayAt ?? 0) - (b.displayAt ?? 0));
      pendingMessagesRef.current = [];
      setState((current) => messages.reduce((next, message) => applyPublicEnvelope(next, message), current));
    };
    const enqueueMessage = (message: PublicLiveEnvelope) => {
      pendingMessagesRef.current.push(message);
      if (flushMessagesRafRef.current !== null) return;
      flushMessagesRafRef.current = window.requestAnimationFrame(flushMessages);
    };
    const refreshState = () => {
      fetchPublicState().then((liveState) => {
        if (!active) return;
        setState(initialAppState(liveState));
        if ((liveState.nodes?.length ?? 0) > 0) {
          setInitialNodesReceived(true);
          setNodeLoadFailed(false);
        }
      }).catch(() => {
        if (!active) return;
        setSocketStatus('state-error');
        if (!initialNodesReceived) setNodeLoadFailed(true);
      });
    };
    const socket = connectPublicSocket((message) => {
      if (message.type === 'lagged') {
        pendingMessagesRef.current = [];
        if (flushMessagesRafRef.current !== null) {
          window.cancelAnimationFrame(flushMessagesRafRef.current);
          flushMessagesRafRef.current = null;
        }
        refreshState();
        return;
      }
      enqueueMessage(message);
    }, setSocketStatus, () => {
      if (openedOnce) refreshState();
      openedOnce = true;
    });
    return () => {
      active = false;
      if (flushMessagesRafRef.current !== null) window.cancelAnimationFrame(flushMessagesRafRef.current);
      flushMessagesRafRef.current = null;
      pendingMessagesRef.current = [];
      socket.close();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = () => {
      if (inFlight) return;
      inFlight = true;
      fetchPublicState()
        .then((liveState) => {
          if (!active) return;
          setState(initialAppState(liveState));
          if ((liveState.nodes?.length ?? 0) > 0) {
            setInitialNodesReceived(true);
            setNodeLoadFailed(false);
          }
          setSocketStatus((current) => (current === 'live' ? current : 'polling'));
        })
        .catch(() => {
          if (!active) return;
          if (!initialNodesReceived) setNodeLoadFailed(true);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    const interval = window.setInterval(refresh, socketStatus === 'live' ? 15_000 : 3_500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [initialNodesReceived, socketStatus]);

  useEffect(() => {
    if (!initialNodesReceived || positionedNodesRendered) return;
    const fallback = window.setTimeout(() => setPositionedNodesRendered(true), 1800);
    return () => window.clearTimeout(fallback);
  }, [initialNodesReceived, positionedNodesRendered]);

  useEffect(() => {
    const fallback = window.setTimeout(() => setInitialLoadGateOpen(false), 4500);
    return () => window.clearTimeout(fallback);
  }, []);

  useEffect(() => {
    if (positionedNodesRendered) setInitialLoadGateOpen(false);
  }, [positionedNodesRendered]);

  useEffect(() => {
    const interval = window.setInterval(() => setLiveClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const visibleNodes = useMemo(() => filterNodes(state.nodes, query), [state.nodes, query]);
  const visibleNodeIDs = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleRoutes = useMemo(() => filterRoutes(state.routes, visibleNodeIDs, query), [state.routes, visibleNodeIDs, query]);
  const selectedNode = useMemo(() => state.nodes.find((node) => node.id === selectedNodeID) ?? null, [state.nodes, selectedNodeID]);
  const selectedRoute = useMemo(() => state.routes.find((route) => route.id === selectedRouteID) ?? null, [state.routes, selectedRouteID]);
  const connectivityGraph = useMemo(() => buildConnectivityGraph(visibleNodes, visibleRoutes), [visibleNodes, visibleRoutes]);
  const selectedConnectivity = useMemo(() => directConnectivity(connectivityGraph, selectedNodeID), [connectivityGraph, selectedNodeID]);
  const phonebookGroups = useMemo(() => phonebookGroupsForNode(connectivityGraph, selectedNodeID), [connectivityGraph, selectedNodeID]);
  const highlightedPath = useMemo(() => highlightedPathForTarget(phonebookGroups, highlightedPathTargetID), [phonebookGroups, highlightedPathTargetID]);
  const selectedPhonebookPath = useMemo(
    () => phonebookGroups.flatMap((group) => group.nodes).find((item) => item.node.id === highlightedPathTargetID) ?? null,
    [phonebookGroups, highlightedPathTargetID]
  );
  const plotFirstNode = useMemo(() => state.nodes.find((node) => node.id === plotFirstNodeID) ?? null, [plotFirstNodeID, state.nodes]);
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
  const highlightedPathRouteIDs = useMemo(() => new Set([...(highlightedPath?.routeIDs ?? []), ...plotHighlightedRouteIDs]), [highlightedPath, plotHighlightedRouteIDs]);
  const highlightedPathNodeIDs = useMemo(() => new Set([...(highlightedPath?.nodeIDs ?? []), ...plotHighlightedNodeIDs]), [highlightedPath, plotHighlightedNodeIDs]);
  const selectedNodeMessageHistory = useMemo(
    () => messageHistoryForNode(selectedNode, visibleRoutes, state.activity),
    [selectedNode, state.activity, visibleRoutes]
  );

  const activityClock = Math.max(liveClock, state.serverTime, state.activity[0]?.heardAt ?? 0, state.routeTraces.at(-1)?.heardAt ?? 0);
  const routeActivityByID = useMemo(() => summarizeRouteActivity(state.routeTraces, activityClock), [state.routeTraces, activityClock]);
  const coverage = useMemo(() => liveCoverageStats(state.activity, activityClock), [state.activity, activityClock]);
  const latestPacketActivity = useMemo(() => state.activity.find(isPacketActivity) ?? null, [state.activity]);
  const loadingPositionedNodes = initialLoadGateOpen && (!initialNodesReceived || !positionedNodesRendered);
  const handlePositionedNodesRendered = useCallback(() => setPositionedNodesRendered(true), []);
  const handleViewChange = useCallback((view: MapViewState) => setMapView(view), []);
  const hotRoutes = useMemo(
    () =>
      [...visibleRoutes].sort((a, b) => {
        const recentDelta = (routeActivityByID.get(b.id)?.total ?? 0) - (routeActivityByID.get(a.id)?.total ?? 0);
        if (recentDelta !== 0) return recentDelta;
        return b.packetCount - a.packetCount || b.lastHeard - a.lastHeard;
      }),
    [visibleRoutes, routeActivityByID]
  );

  const dispatchMapAction = useCallback((next: Exclude<MapAction, null>['type'], value?: string) => {
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    if (next === 'route' && value) setMapAction({ type: 'route', routeID: value, token });
    else if (next === 'node' && value) setMapAction({ type: 'node', nodeID: value, token });
    else if (next === 'latest-route') setMapAction({ type: 'latest-route', token });
    else setMapAction({ type: 'reset', token });
  }, []);

  const applySelection = useCallback((next: SelectionState) => {
    setSelectedNodeID(next.selectedNodeID);
    setSelectedRouteID(next.selectedRouteID);
    setHighlightedPathTargetID(next.highlightedPathTargetID);
  }, []);

  const clearSelection = useCallback(() => {
    applySelection(clearSelectionState());
  }, [applySelection]);

  const selectNode = useCallback((nodeID: string) => {
    applySelection(selectNodeSelection(nodeID));
  }, [applySelection]);

  const selectRoute = useCallback((routeID: string) => {
    applySelection(selectRouteSelection(routeID));
    dispatchMapAction('route', routeID);
  }, [applySelection, dispatchMapAction]);

  const selectPhonebookPath = useCallback((nodeID: string) => {
    applySelection(selectPathTargetSelection({ selectedNodeID, selectedRouteID, highlightedPathTargetID }, nodeID));
  }, [applySelection, highlightedPathTargetID, selectedNodeID, selectedRouteID]);

  const startNodePlot = useCallback(() => {
    setPlotMode('node');
    setPlotFirstNodeID(null);
    setPlotAreaFirstPoint(null);
    setPlotResult(null);
  }, []);

  const startAreaPlot = useCallback(() => {
    setPlotMode('area');
    setPlotFirstNodeID(null);
    setPlotAreaFirstPoint(null);
    setPlotResult(null);
  }, []);

  const clearPlotRoutes = useCallback(() => {
    setPlotMode('off');
    setPlotFirstNodeID(null);
    setPlotAreaFirstPoint(null);
    setPlotResult(null);
  }, []);

  const handlePlotNodePick = useCallback((nodeID: string) => {
    if (plotMode !== 'node') return;
    if (!plotFirstNodeID) {
      setPlotFirstNodeID(nodeID);
      return;
    }
    if (plotFirstNodeID === nodeID) return;
    const source = state.nodes.find((node) => node.id === plotFirstNodeID);
    const target = state.nodes.find((node) => node.id === nodeID);
    if (!source || !target) return;
    setPlotResult({ type: 'path', source, target, path: shortestPathBetween(connectivityGraph, source.id, target.id) });
    setPlotMode('off');
    setPlotFirstNodeID(null);
  }, [connectivityGraph, plotFirstNodeID, plotMode, state.nodes]);

  const handlePlotMapPoint = useCallback((point: MapPoint) => {
    if (plotMode !== 'area') return;
    if (!plotAreaFirstPoint) {
      setPlotAreaFirstPoint(point);
      return;
    }
    const bounds = boundsFromPoints(plotAreaFirstPoint, point);
    setPlotResult({ type: 'area', bounds, routes: routesInBounds(visibleRoutes, bounds) });
    setPlotMode('off');
    setPlotAreaFirstPoint(null);
  }, [plotAreaFirstPoint, plotMode, visibleRoutes]);

  const copyMeshcorePath = useCallback(async (path: Parameters<typeof meshcorePathCopyText>[0]) => {
    const text = meshcorePathCopyText(path);
    if (!text) {
      setPathCopyToast('No 3-byte path available');
      window.setTimeout(() => setPathCopyToast(null), 2200);
      return;
    }
    try {
      await copyTextToClipboard(text);
      setPathCopyToast('3-byte path copied');
    } catch {
      setPathCopyToast('Copy failed');
    }
    window.setTimeout(() => setPathCopyToast(null), 2200);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearSelection();
        clearPlotRoutes();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearPlotRoutes, clearSelection]);

  const shareView = useCallback(async () => {
    const view = mapView ?? (sharedViewRef.current ? { lat: sharedViewRef.current.lat, lng: sharedViewRef.current.lng, z: sharedViewRef.current.z } : null);
    if (!view) {
      setShareToast('Map view not ready');
      window.setTimeout(() => setShareToast(null), 2200);
      return;
    }
    const url = buildSharedViewURL(window.location.href, view, {
      route: selectedRouteID,
      node: selectedNodeID,
      q: query
    });
    try {
      await copyTextToClipboard(url);
      setShareToast('View link copied');
    } catch {
      setShareToast('Copy failed');
    }
    window.setTimeout(() => setShareToast(null), 2200);
  }, [mapView, query, selectedNodeID, selectedRouteID]);

  return (
    <div className="app-shell public-dashboard">
      <CanadaMap
        nodes={visibleNodes}
        routes={visibleRoutes}
        pulses={state.pulses}
        observerBursts={state.observerBursts}
        paused={paused}
        followTraffic={followTraffic}
        clearToken={clearToken}
        selectedNodeID={selectedNodeID}
        selectedRouteID={selectedRouteID}
        highlightedPathRouteIDs={highlightedPathRouteIDs}
        highlightedPathNodeIDs={highlightedPathNodeIDs}
        plotMode={plotMode}
        mapAction={mapAction}
        initialView={sharedViewRef.current}
        loading={loadingPositionedNodes}
        onPositionedNodesRendered={handlePositionedNodesRendered}
        onViewChange={handleViewChange}
        onSelectNode={selectNode}
        onSelectRoute={selectRoute}
        onPlotNodePick={handlePlotNodePick}
        onPlotMapPoint={handlePlotMapPoint}
        onClearSelection={clearSelection}
      />
      {loadingPositionedNodes && <NodeLoadingToast failed={nodeLoadFailed} drawing={initialNodesReceived} />}
      <LinkBar />
      <StatusBar
        stats={state.stats}
        socketStatus={socketStatus}
        nodeCount={visibleNodes.length}
        routeCount={visibleRoutes.length}
        coverage={coverage}
        latestPayloadTypeName={latestPacketActivity?.payloadTypeName ?? null}
        latestPacketID={latestPacketActivity?.id ?? null}
      />

      <div className="top-actions">
        <button className="icon-button" type="button" title={paused ? 'Resume packet flow' : 'Pause packet flow'} onClick={() => setPaused((value) => !value)}>
          {paused ? <Play size={18} /> : <Pause size={18} />}
        </button>
        <button className="icon-button" type="button" title="Clear active pulses" onClick={() => setClearToken((value) => value + 1)}>
          <RotateCcw size={18} />
        </button>
        <button className="icon-button route-focus" type="button" title="Focus latest route" onClick={() => dispatchMapAction('latest-route')}>
          <LocateFixed size={18} />
        </button>
        <button className="icon-button" type="button" title="Share this view" onClick={shareView}>
          <Share2 size={18} />
        </button>
        <button className="icon-button" type="button" title="Reset map" onClick={() => dispatchMapAction('reset')}>
          <X size={18} />
        </button>
      </div>
      {shareToast && <div className="share-toast" role="status">{shareToast}</div>}

      <button
        className={`follow-traffic-button ${followTraffic ? 'active' : ''}`}
        type="button"
        aria-pressed={followTraffic}
        title={followTraffic ? 'Stop following live packet movement' : 'Follow live packet movement'}
        onClick={() => setFollowTraffic((value) => !value)}
      >
        <RadioTower size={15} />
        <span>Live Follow</span>
      </button>

      <PlotRoutesPanel
        mode={plotMode}
        firstNode={plotFirstNode}
        areaPointCount={plotAreaFirstPoint ? 1 : 0}
        result={plotResult}
        copyStatus={pathCopyToast}
        onStartNodePlot={startNodePlot}
        onStartAreaPlot={startAreaPlot}
        onCancel={clearPlotRoutes}
        onCopyPath={copyMeshcorePath}
        onSelectRoute={selectRoute}
      />

      <section className="search-panel">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes, roles, regions" />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
            <X size={15} />
          </button>
        )}
      </section>

      <Legend />
      <HotRoutes routes={hotRoutes} selectedRouteID={selectedRouteID} routeActivityByID={routeActivityByID} onSelect={selectRoute} />
      <SelectionDrawer
        node={selectedNode}
        route={selectedRoute}
        connectedRoutes={selectedConnectivity.routes}
        phonebookGroups={phonebookGroups}
        selectedPath={selectedPhonebookPath}
        selectedPathTargetID={highlightedPathTargetID}
        messageHistory={selectedNodeMessageHistory}
        copyStatus={pathCopyToast}
        onRouteSelect={selectRoute}
        onPhonebookSelect={selectPhonebookPath}
        onCopyPath={copyMeshcorePath}
        onClose={clearSelection}
      />
    </div>
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for browser contexts where the Clipboard API is present but denied.
    }
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  document.body.appendChild(textArea);

  const selection = document.getSelection();
  const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  textArea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('copy command failed');
  } finally {
    document.body.removeChild(textArea);
    if (selectedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(selectedRange);
    }
  }
}

function isPacketActivity(item: PublicActivity): boolean {
  return item.kind === 'packet' || item.kind === 'route';
}

function NodeLoadingToast({ failed, drawing }: { failed: boolean; drawing: boolean }) {
  const title = failed ? 'Retrying positioned nodes' : drawing ? 'Drawing positioned nodes' : 'Loading positioned nodes';
  const message = failed
    ? 'Waiting for the public state feed to return map-safe node positions.'
    : drawing
      ? 'Placing the public node layer before showing the live map.'
      : 'Preparing the map before showing live node markers.';
  return (
    <div className={`node-loading-toast ${failed ? 'warn' : ''}`} role="status" aria-live="polite">
      <span className="node-loading-spinner" />
      <span>
        <strong>{title}</strong>
        <em>{message}</em>
      </span>
    </div>
  );
}
