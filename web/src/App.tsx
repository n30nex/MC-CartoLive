import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, CloudSun, Columns3, Eye, EyeOff, List, MessageSquareText, Monitor, Moon, MoreHorizontal, Palette, Pause, Play, RadioTower, RotateCcw, Route, Search, Share2, SlidersHorizontal, Sun, X } from 'lucide-react';
import { fetchPublicBootstrap, fetchPublicEvents, fetchPublicPropagation, fetchPublicState, fetchPublicStateWithFallback, type PublicStateFetchResult } from './api';
import { recoverPublicEventPages } from './eventRecovery';
import { connectPublicSocket } from './ws';
import {
  applyPublicEnvelope,
  applyPublicEnvelopes,
  applyPublicEvents,
  emptyState,
  hydrateSnapshotTopology,
  initialAppState,
  isPacketActivity,
  liveCoverageStats,
  publicLiveStateSignature,
  summarizeRouteActivity,
  type AppState,
  type RouteActivitySummary
} from './state';
import CanadaMap, { type MapAction } from './map/CanadaMap';
import ErrorBoundary from './components/ErrorBoundary';
import PanelSkeleton from './components/PanelSkeleton';
import { LoadingSpinner } from './components/LoadingPrimitives';
import HotRoutes from './components/HotRoutes';
import Legend from './components/Legend';
import LinkBar from './components/LinkBar';
import PlotRoutesPanel, { type PlotMode, type PlotResult } from './components/PlotRoutesPanel';
import SelectionDrawer from './components/SelectionDrawer';
import StatusBar from './components/StatusBar';
import PropagationPanel from './components/PropagationPanel';
import VisitorGuide from './components/VisitorGuide';
import ChromePanel from './components/ChromePanel';
import { lazyWithReload } from './lazyWithReload';
const PacketsPanel = lazyWithReload(() => import('./components/PacketsPanel'), 'PacketsPanel');
const NetGraphPanel = lazyWithReload(() => import('./components/NetGraphPanel'), 'NetGraphPanel');
const ChatPanel = lazyWithReload(() => import('./components/ChatPanel'), 'ChatPanel');
const LabPanel = lazyWithReload(() => import('./components/LabPanel'), 'LabPanel');
const SetupPanel = lazyWithReload(() => import('./components/SetupPanel'), 'SetupPanel');
const CommandPalette = lazyWithReload(() => import('./components/CommandPalette'), 'CommandPalette');
import type { CommandPaletteRegionFocus } from './components/CommandPalette';
import MapSettingsDrawer from './components/MapSettingsDrawer';
import RouteGifExportButton, { type RouteGifExportStatus } from './components/RouteGifExportButton';
import { ToastProvider, useToasts } from './components/ToastProvider';
import { DEFAULT_LAB_EXPERIMENT_ID, labExperimentPath } from './lab';
import {
  DEFAULT_CHROME_PANEL_ANCHORS,
  INITIAL_CHROME_PANEL_VISIBILITY,
  chromePanelVisible,
  normalizePanelAnchor,
  reduceChromeVisibility,
  useViewportBounds,
  type ChromePanelAnchor,
  type ChromePanelID,
  type ChromeVisibilityState,
  type ViewportBounds
} from './components/panelChrome';
import { capLiveEnvelopeQueue, takeDueLiveEnvelopes } from './livePacing';
import { classifyLiveEnvelopeSequence, helloRequiresCursorResetProbe, liveCursorResetTarget, retainLiveEnvelopesAfterCursor, shouldQueueDurableLiveSequence, takeIncreasingLiveEnvelopes } from './liveCursor';
import { shortestPathBetween } from './connectivity';
import { boundsFromPoints, meshcorePathCopyText, routesInBounds, type MapPoint } from './routeTools';
import { livePacketsFromActivity, packetToPulse } from './packets';
import { downloadRouteGifBlob, routeGifAnimationDurationMs, type RouteMapGifExportRequest } from './routeGifExport';
import { buildSharedViewURL, parseSharedView, type MapViewState } from './shareView';
import type { DashboardAction } from './uiActions';
import { SERVICE_WORKER_UPDATE_EVENT, activateWaitingServiceWorker, waitingServiceWorkerUpdateAvailable } from './serviceWorker';
import { useAccessibleDialog } from './lib/useAccessibleDialog';
import { bootstrapToLiveState, publicStateSnapshotIsCurrent, startBootstrapFirstHydration } from './bootstrapHydration';
import { installResumeRecovery } from './resumeRecovery';
import { installLongTaskObserver, recordLivePendingQueueSize, recordLiveStateApplied, recordSnapshotReplacement, recordVisibilityPause } from './perfDiagnostics';
import { useMapSelection } from './hooks/useMapSelection';
import { useWorkspaceNavigation } from './hooks/useWorkspaceNavigation';
import { beginOwnedPause, markOwnedPauseUserOverride, pausedAfterOwnedPause, type OwnedPauseSession } from './pauseOwnership';
import { applyMapMode, MAP_MODES, mapModeForSettings, normalizeMapSettings, readStoredMapSettings, writeStoredMapSettings, type MapModeID, type MapSettings } from './mapSettings';
import { mapStyleProfileByID, type MapStyleProfileID } from './map/styles/styleRegistry';
import {
  THEME_PALETTES,
  applyDocumentTheme,
  readStoredThemePreference,
  resolveThemeMode,
  themePaletteByID,
  themeStyleVariables,
  toggleThemeMode,
  writeStoredThemePreference,
  type ThemeMode,
  type ThemePalette
} from './theme';
import type { PublicActivity, PublicLiveEnvelope, PublicLiveState, PublicMapCluster, PublicMapConfig, PublicPacketPath, PublicPropagationConditions, PublicPropagationEvent, PublicRoute, PublicRoutePulse } from './types';

const NodeListPanel = lazyWithReload(() => import('./components/NodeListPanel'), 'NodeListPanel');
const ShortcutHelp = lazyWithReload(() => import('./components/ShortcutHelp'), 'ShortcutHelp');

const PANEL_MENU_ITEMS: readonly { id: ChromePanelID; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'legend', label: 'Legend' },
  { id: 'hotRoutes', label: 'Busy Pathways' }
] as const;

const PUBLIC_STATE_FALLBACK_POLL_MS = 5_000;
const LIVE_CLOCK_IDLE_MS = 5_000;
const DERIVED_ACTIVITY_BUCKET_MS = 5_000;
const EMPTY_ROUTE_ACTIVITY = new Map<string, RouteActivitySummary>();
const EMPTY_HOT_ROUTES: PublicRoute[] = [];

function publicSequence(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export default function App() {
  return (
    <ToastProvider>
      <PublicDashboardApp />
    </ToastProvider>
  );
}

function PublicDashboardApp() {
  const { showToast } = useToasts();
  const sharedViewRef = useRef(parseSharedView(window.location.search));
  const [state, setState] = useState<AppState>(emptyState);
  const [publicMapConfig, setPublicMapConfig] = useState<PublicMapConfig | null>(null);
  const [bootstrapClusters, setBootstrapClusters] = useState<PublicMapCluster[]>([]);
  const [socketStatus, setSocketStatus] = useState('starting');
  const [paused, setPaused] = useState(false);
  const gifExportPauseSessionRef = useRef<OwnedPauseSession | null>(null);
  const [followTraffic, setFollowTraffic] = useState(false);
  const [query, setQuery] = useState(() => sharedViewRef.current?.q ?? '');
  const [clearToken, setClearToken] = useState(0);
  const [mapAction, setMapAction] = useState<MapAction>(null);
  const [plotMode, setPlotMode] = useState<PlotMode>('off');
  const [plotFirstNodeID, setPlotFirstNodeID] = useState<string | null>(null);
  const [plotAreaFirstPoint, setPlotAreaFirstPoint] = useState<MapPoint | null>(null);
  const [plotResult, setPlotResult] = useState<PlotResult | null>(null);
  const [pathCopyToast, setPathCopyToast] = useState<string | null>(null);
  const [mapView, setMapView] = useState<MapViewState | null>(() => {
    const shared = sharedViewRef.current;
    return shared ? { lat: shared.lat, lng: shared.lng, z: shared.z, pitch: shared.pitch, bearing: shared.bearing } : null;
  });
  const initialThemeRef = useRef(readStoredThemePreference());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => initialThemeRef.current.mode);
  const [themePaletteID, setThemePaletteID] = useState(() => initialThemeRef.current.palette.id);
  const [paletteMenuOpen, setPaletteMenuOpen] = useState(false);
  const [panelsMenuOpen, setPanelsMenuOpen] = useState(false);
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [fullStateHydrated, setFullStateHydrated] = useState(false);
  const [serviceWorkerUpdateReady, setServiceWorkerUpdateReady] = useState(false);
  const [serviceWorkerActivating, setServiceWorkerActivating] = useState(false);
  const [mapSettings, setMapSettings] = useState<MapSettings>(() => readStoredMapSettings());
  const [propagationOpen, setPropagationOpen] = useState(false);
  const [propagationEvents, setPropagationEvents] = useState<PublicPropagationEvent[]>([]);
  const [propagationConditions, setPropagationConditions] = useState<PublicPropagationConditions | null>(null);
  const [propagationLoading, setPropagationLoading] = useState(true);
  const [propagationError, setPropagationError] = useState<string | null>(null);
  const [initialLoadGateOpen, setInitialLoadGateOpen] = useState(true);
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
  const [routeGifExport, setRouteGifExport] = useState<{ status: RouteGifExportStatus; progress: number; remainingExports: number; cooldownUntil: number }>({ status: 'idle', progress: 0, remainingExports: 5, cooldownUntil: 0 });
  const [routeGifExportRequest, setRouteGifExportRequest] = useState<RouteMapGifExportRequest | null>(null);
  const [liveClock, setLiveClock] = useState(() => Date.now());
  const [initialNodesReceived, setInitialNodesReceived] = useState(false);
  const [positionedNodesRendered, setPositionedNodesRendered] = useState(false);
  const [nodeLoadFailed, setNodeLoadFailed] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [chromeVisibility, setChromeVisibility] = useState<ChromeVisibilityState>({
    chromeHidden: false,
    panels: { ...INITIAL_CHROME_PANEL_VISIBILITY }
  });
  const viewportBounds = useViewportBounds();
  const [panelAnchors, setPanelAnchors] = useState<Record<ChromePanelID, ChromePanelAnchor>>({ ...DEFAULT_CHROME_PANEL_ANCHORS });
  const closeWorkspaceMenus = useCallback(() => {
    setPaletteMenuOpen(false);
    setPanelsMenuOpen(false);
    setMapSettingsOpen(false);
    setMobileControlsOpen(false);
  }, []);
  const markPauseUserOverride = useCallback(() => {
    gifExportPauseSessionRef.current = markOwnedPauseUserOverride(gifExportPauseSessionRef.current);
  }, []);
  const finishGifExportPause = useCallback(() => {
    const session = gifExportPauseSessionRef.current;
    gifExportPauseSessionRef.current = null;
    setPaused((current) => pausedAfterOwnedPause(session, current));
  }, []);
  const togglePausedByUser = useCallback(() => {
    markPauseUserOverride();
    setPaused((value) => !value);
  }, [markPauseUserOverride]);
  const {
    packetsOpen,
    setPacketsOpen,
    netGraphOpen,
    chatOpen,
    labOpen,
    labExperimentID,
    setupOpen,
    nodeListOpen,
    packetsPanelMode,
    setPacketsPanelMode,
    workspacePresentation,
    setWorkspacePresentation,
    closePackets,
    closeNetGraph,
    closeChat,
    closeLab,
    closeSetup,
    closeNodeList,
    closeAllWorkspaceSurfaces,
    openPackets,
    openChat,
    openNodeList,
    selectLabExperiment
  } = useWorkspaceNavigation({
    onWorkspaceRouteOpened: closeWorkspaceMenus
  });
  const {
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
    selectRoute: selectRouteSelectionOnly,
    selectPhonebookPath,
    selectPacket
  } = useMapSelection({
    state,
    query,
    initialNodeID: sharedViewRef.current?.node ?? null,
    initialRouteID: sharedViewRef.current?.route ?? null,
    plotResult
  });
  const closeMobileControls = useCallback(() => setMobileControlsOpen(false), []);
  const mobileControlsRef = useAccessibleDialog<HTMLElement>(mobileControlsOpen, closeMobileControls);
  const actionTokenRef = useRef(0);
  const gifExportTimestampsRef = useRef<number[]>([]);
  const gifCooldownUntilRef = useRef(0);
  const GIF_EXPORT_MAX_PER_WINDOW = 5;
  const GIF_EXPORT_WINDOW_MS = 10 * 60_000;
  const GIF_EXPORT_COOLDOWN_MS = 30_000;
  const stateRef = useRef<AppState>(emptyState);
  const latestObservedSeqRef = useRef(0);
  const latestInboundSeqRef = useRef(0);
  const lastAppliedEventSeqRef = useRef(0);
  const lastQueuedEventSeqRef = useRef(0);
  const eventCursorGenerationRef = useRef(0);
  const cursorEpochResetActiveRef = useRef(false);
  const eventRecoveryRef = useRef<((latestSeq?: number) => void) | null>(null);
  const lastSnapshotSignatureRef = useRef('');
  const pendingMessagesRef = useRef<PublicLiveEnvelope[]>([]);
  const flushMessagesFrameRef = useRef<number | null>(null);
  const initialNodesReceivedRef = useRef(false);
  const selectedThemePalette = useMemo(() => themePaletteByID(themePaletteID), [themePaletteID]);
  const resolvedThemeMode = useMemo(() => resolveThemeMode(themeMode), [themeMode]);
  const mapThemeMode = useMemo(() => themeModeForMapStyle(mapSettings.style.profileID, resolvedThemeMode), [mapSettings.style.profileID, resolvedThemeMode]);
  const appThemeStyle = useMemo(() => themeStyleVariables(selectedThemePalette, resolvedThemeMode) as CSSProperties, [selectedThemePalette, resolvedThemeMode]);

  useEffect(() => {
    stateRef.current = state;
    if (!cursorEpochResetActiveRef.current) {
      latestObservedSeqRef.current = Math.max(latestObservedSeqRef.current, publicSequence(state.latestSeq));
    }
  }, [state]);

  useEffect(() => {
    initialNodesReceivedRef.current = initialNodesReceived;
  }, [initialNodesReceived]);

  useEffect(() => installLongTaskObserver(), []);

  const applyPublicSnapshot = useCallback((liveState: PublicLiveState, recoveryFloor?: number): boolean => {
    const requiredSeq = recoveryFloor === undefined
      ? Math.max(publicSequence(stateRef.current.latestSeq), latestObservedSeqRef.current)
      : Math.max(0, recoveryFloor);
    if (!publicStateSnapshotIsCurrent(requiredSeq, liveState)) {
      recordSnapshotReplacement(true);
      return false;
    }
    const signature = publicLiveStateSignature(liveState);
    if (recoveryFloor === undefined && signature === lastSnapshotSignatureRef.current) {
      recordSnapshotReplacement(true);
      return false;
    }
    lastSnapshotSignatureRef.current = signature;
    const snapshotSeq = publicSequence(liveState.stats?.latestSeq);
    latestObservedSeqRef.current = Math.max(latestObservedSeqRef.current, snapshotSeq);
    latestInboundSeqRef.current = Math.max(latestInboundSeqRef.current, snapshotSeq);
    eventCursorGenerationRef.current += 1;
    if (flushMessagesFrameRef.current !== null) {
      window.cancelAnimationFrame(flushMessagesFrameRef.current);
      flushMessagesFrameRef.current = null;
    }
    pendingMessagesRef.current = [];
    recordLivePendingQueueSize(0);
    const nextState = initialAppState(liveState);
    nextState.routeTopologyRevision = stateRef.current.routeTopologyRevision + 1;
    nextState.routeTrafficRevision = stateRef.current.routeTrafficRevision + 1;
    nextState.routeVisualRevision = stateRef.current.routeVisualRevision + 1;
    stateRef.current = nextState;
    lastAppliedEventSeqRef.current = snapshotSeq;
    lastQueuedEventSeqRef.current = snapshotSeq;
    setState(nextState);
    recordSnapshotReplacement(false);
    return true;
  }, []);

  const openMapHome = useCallback(() => {
    closeAllWorkspaceSurfaces();
    setPropagationOpen(false);
    setShortcutHelpOpen(false);
    setMapSettingsOpen(false);
    setMobileControlsOpen(false);
    setCommandPaletteOpen(false);
  }, [closeAllWorkspaceSurfaces]);

  useEffect(() => {
    writeStoredMapSettings(mapSettings);
  }, [mapSettings]);

  useEffect(() => {
    setRouteGifExport((current) => (current.status === 'rendering' ? current : { ...current, status: 'idle', progress: 0 }));
  }, [selectedPacket?.id]);

  const toggleChromeVisibility = useCallback(() => {
    setChromeVisibility((current) => reduceChromeVisibility(current, { type: current.chromeHidden ? 'show-all' : 'hide-all' }));
  }, []);

  const hideChromePanel = useCallback((panel: ChromePanelID) => {
    setChromeVisibility((current) => reduceChromeVisibility(current, { type: 'hide-panel', panel }));
  }, []);

  const toggleChromePanel = useCallback((panel: ChromePanelID) => {
    setChromeVisibility((current) => reduceChromeVisibility(current, { type: chromePanelVisible(current, panel) ? 'hide-panel' : 'show-panel', panel }));
  }, []);

  const setChromePanelAnchor = useCallback((panel: ChromePanelID, anchor: ChromePanelAnchor) => {
    setPanelAnchors((current) => ({ ...current, [panel]: normalizePanelAnchor(panel, anchor) }));
    setChromeVisibility((current) => reduceChromeVisibility(current, { type: 'show-panel', panel }));
  }, []);

  useEffect(() => {
    const preference = { mode: themeMode, palette: selectedThemePalette };
    applyDocumentTheme(preference);
    writeStoredThemePreference(preference);
  }, [selectedThemePalette, themeMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (themeMode === 'system') {
        applyDocumentTheme({ mode: 'system', palette: selectedThemePalette });
      }
    };
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [selectedThemePalette, themeMode]);

  useEffect(() => {
    let cancelled = false;
    let cancelDeferredState: () => void = () => undefined;
    let topologySeqFloor = 0;
    let hydrationRetryTimer: number | null = null;
    let hydrationRetryAttempt = 0;
    const reportStateHydrationError = () => {
      if (cancelled) return;
      setSocketStatus('state-error');
      setNodeLoadFailed(true);
    };
    const scheduleCurrentStateRetry = () => {
      if (cancelled || hydrationRetryTimer !== null) return;
      if (hydrationRetryAttempt >= 8) {
        reportStateHydrationError();
        return;
      }
      const delay = Math.min(1_000, 100 * (2 ** hydrationRetryAttempt));
      hydrationRetryAttempt += 1;
      hydrationRetryTimer = window.setTimeout(() => {
        hydrationRetryTimer = null;
        void fetchPublicStateWithFallback().then(applyFullState).catch(reportStateHydrationError);
      }, delay);
    };
    function applyFullState(result: PublicStateFetchResult) {
      if (cancelled) return;
      const liveState = result.state;
      const snapshotSeq = publicSequence(liveState.stats?.latestSeq);
      if (result.source === 'network' && snapshotSeq < topologySeqFloor) {
        scheduleCurrentStateRetry();
        return;
      }
      hydrationRetryAttempt = 0;
      setFullStateHydrated(true);
      if (!applyPublicSnapshot(liveState)) {
        // Bootstrap and WebSocket activity can advance beyond the cached full
        // snapshot before it arrives. Hydrate its complete topology without
        // rolling the live sequence or newer node/route updates backward.
        setState((current) => {
          const hydrated = hydrateSnapshotTopology(current, liveState);
          stateRef.current = hydrated;
          return hydrated;
        });
      }
      setPublicMapConfig(liveState.map ?? null);
      setInitialNodesReceived((liveState.nodes?.length ?? 0) > 0);
      setNodeLoadFailed(false);
      if (result.source === 'offline-cache') setSocketStatus('offline-cache');
    };
    void startBootstrapFirstHydration({
      fetchBootstrap: fetchPublicBootstrap,
      fetchState: fetchPublicStateWithFallback,
      applyBootstrap: (bootstrap) => {
        if (cancelled) return;
        topologySeqFloor = Math.max(topologySeqFloor, publicSequence(bootstrap.latestSeq));
        setPublicMapConfig(bootstrap.map ?? null);
        setBootstrapClusters(bootstrap.clusters);
        if (stateRef.current.latestSeq <= bootstrap.latestSeq) applyPublicSnapshot(bootstrapToLiveState(bootstrap));
        setNodeLoadFailed(false);
      },
      applyState: applyFullState,
      deferState: (task) => {
        if (cancelled) return;
        cancelDeferredState = deferStateHydration(task);
      },
      onDeferredStateError: () => {
        reportStateHydrationError();
      }
    }).catch(() => {
      if (cancelled) return;
      setSocketStatus('state-error');
      setNodeLoadFailed(true);
    });
    return () => {
      cancelled = true;
      cancelDeferredState();
      if (hydrationRetryTimer !== null) window.clearTimeout(hydrationRetryTimer);
    };
  }, [applyPublicSnapshot]);

  useEffect(() => {
    let active = true;
    let recoveryInFlight = false;
    let queuedRecoveryTarget = 0;
    let queuedRecoveryPoll = false;
    let recoveryRetryTimer: number | null = null;
    let stateRefreshRetryTimer: number | null = null;
    let stateRefreshInFlight = false;
    let stateRefreshFloor = 0;
    let stateRefreshIsCursorReset = false;
    let resetRecoveryActive = false;
    const scheduleMessagesFlush = () => {
      if (flushMessagesFrameRef.current !== null || pendingMessagesRef.current.length === 0) return;
      flushMessagesFrameRef.current = window.requestAnimationFrame(flushMessages);
    };
    const flushMessages = () => {
      flushMessagesFrameRef.current = null;
      if (!active || pendingMessagesRef.current.length === 0) return;
      const { due, pending } = takeDueLiveEnvelopes(pendingMessagesRef.current, Date.now());
      const batch = takeIncreasingLiveEnvelopes(due, lastAppliedEventSeqRef.current);
      if (batch.invalid) {
        const recoveryTarget = Math.max(
          latestObservedSeqRef.current,
          ...due.map((message) => publicSequence(message.latestSeq) || publicSequence(message.seq)),
          ...pending.map((message) => publicSequence(message.latestSeq) || publicSequence(message.seq))
        );
        pendingMessagesRef.current = [];
        lastQueuedEventSeqRef.current = lastAppliedEventSeqRef.current;
        recordLivePendingQueueSize(0);
        backfillOrRefresh(recoveryTarget > 0 ? recoveryTarget : undefined);
        return;
      }
      if (batch.accepted.length > 0) {
        lastAppliedEventSeqRef.current = batch.cursor;
        recordLiveStateApplied(batch.accepted);
        setState((current) => {
          const next = applyPublicEnvelopes(current, batch.accepted, { animate: true });
          stateRef.current = next;
          return next;
        });
      }
      pendingMessagesRef.current = retainLiveEnvelopesAfterCursor(pending, lastAppliedEventSeqRef.current);
      recordLivePendingQueueSize(pendingMessagesRef.current.length);
      if (pendingMessagesRef.current.length > 0) scheduleMessagesFlush();
    };
    const enqueueMessage = (message: PublicLiveEnvelope) => {
      if (message.type !== 'event') return;
      const sequence = classifyLiveEnvelopeSequence(message);
      const recoveryTarget = Math.max(
        sequence.kind === 'durable' ? sequence.seq : 0,
        publicSequence(message.latestSeq)
      );
      if (sequence.kind === 'invalid') {
        pendingMessagesRef.current = [];
        lastQueuedEventSeqRef.current = lastAppliedEventSeqRef.current;
        recordLivePendingQueueSize(0);
        backfillOrRefresh(recoveryTarget > 0 ? recoveryTarget : undefined);
        return;
      }
      if (sequence.kind === 'durable' && resetRecoveryActive) {
        backfillOrRefresh(recoveryTarget > 0 ? recoveryTarget : undefined);
        return;
      }
      if (sequence.kind === 'durable') {
        if (!shouldQueueDurableLiveSequence(sequence.seq, lastAppliedEventSeqRef.current, lastQueuedEventSeqRef.current)) return;
      }
      const nextPending = [...pendingMessagesRef.current, message];
      const cappedPending = capLiveEnvelopeQueue(nextPending);
      if (cappedPending.length !== nextPending.length) {
        pendingMessagesRef.current = [];
        lastQueuedEventSeqRef.current = lastAppliedEventSeqRef.current;
        recordLivePendingQueueSize(0);
        backfillOrRefresh(recoveryTarget > 0 ? recoveryTarget : undefined);
        return;
      }
      pendingMessagesRef.current = cappedPending;
      if (sequence.kind === 'durable') lastQueuedEventSeqRef.current = sequence.seq;
      recordLivePendingQueueSize(pendingMessagesRef.current.length);
      scheduleMessagesFlush();
    };
    const scheduleStateRefresh = (delayMs: number) => {
      if (stateRefreshRetryTimer !== null || !active) return;
      stateRefreshRetryTimer = window.setTimeout(() => {
        stateRefreshRetryTimer = null;
        refreshState(stateRefreshFloor);
      }, delayMs);
    };
    const refreshState = (minimumSeq = 0, resetCursorEpoch = false) => {
      if (resetCursorEpoch) {
        stateRefreshFloor = Math.max(0, minimumSeq);
        stateRefreshIsCursorReset = true;
      } else if (!stateRefreshIsCursorReset) {
        stateRefreshFloor = Math.max(stateRefreshFloor, minimumSeq);
      }
      resetRecoveryActive = stateRefreshIsCursorReset || stateRefreshFloor > 0;
      if (stateRefreshInFlight) {
        // A scheduled stale-snapshot retry may fire before the previous
        // request's finally handler. Keep a retry armed instead of losing the
        // required sequence floor until some unrelated visibility event.
        scheduleStateRefresh(250);
        return;
      }
      stateRefreshInFlight = true;
      fetchPublicState().then((liveState) => {
        if (!active) return;
        const snapshotSeq = publicSequence(liveState.stats?.latestSeq);
        if (snapshotSeq < stateRefreshFloor) {
          scheduleStateRefresh(1_000);
          return;
        }
        setFullStateHydrated(true);
        const applied = applyPublicSnapshot(liveState, stateRefreshFloor);
        if (!applied) {
          scheduleStateRefresh(1_000);
          return;
        }
        setPublicMapConfig(liveState.map ?? null);
        if ((liveState.nodes?.length ?? 0) > 0) {
          setInitialNodesReceived(true);
          setNodeLoadFailed(false);
        }
        stateRefreshFloor = 0;
        stateRefreshIsCursorReset = false;
        resetRecoveryActive = false;
        cursorEpochResetActiveRef.current = false;
        eventRecoveryRef.current?.(latestObservedSeqRef.current);
      }).catch(() => {
        if (!active) return;
        setSocketStatus('state-error');
        if (!initialNodesReceivedRef.current) setNodeLoadFailed(true);
        scheduleStateRefresh(PUBLIC_STATE_FALLBACK_POLL_MS);
      }).finally(() => {
        stateRefreshInFlight = false;
      });
    };
    const backfillOrRefresh = (latestSeq?: number) => {
      const recoveryTarget = publicSequence(latestSeq);
      if (recoveryTarget > 0) {
        queuedRecoveryTarget = Math.max(queuedRecoveryTarget, recoveryTarget);
      } else {
        queuedRecoveryPoll = true;
      }
      if (recoveryInFlight || resetRecoveryActive) return;
      if (recoveryRetryTimer !== null) {
        window.clearTimeout(recoveryRetryTimer);
        recoveryRetryTimer = null;
      }
      recoveryInFlight = true;

      const recover = async () => {
        while (active && (queuedRecoveryPoll || queuedRecoveryTarget > lastAppliedEventSeqRef.current)) {
          const requestedTarget = queuedRecoveryTarget > 0 ? queuedRecoveryTarget : undefined;
          queuedRecoveryTarget = 0;
          queuedRecoveryPoll = false;
          const recoveryGeneration = eventCursorGenerationRef.current;
          let result;
          try {
            result = await recoverPublicEventPages({
              afterSeq: lastAppliedEventSeqRef.current,
              targetSeq: requestedTarget,
              fetchPage: (afterSeq, limit) => fetchPublicEvents({ afterSeq, limit }),
              applyPage: (events) => {
                if (!active || recoveryGeneration !== eventCursorGenerationRef.current) return;
                const unapplied = events
                  .filter((event) => publicSequence(event.seq) > lastAppliedEventSeqRef.current)
                  .sort((left, right) => left.seq - right.seq);
                if (unapplied.length === 0) return;
                const confirmedCursor = unapplied[unapplied.length - 1]?.seq ?? lastAppliedEventSeqRef.current;
                lastAppliedEventSeqRef.current = confirmedCursor;
                pendingMessagesRef.current = retainLiveEnvelopesAfterCursor(pendingMessagesRef.current, confirmedCursor);
                lastQueuedEventSeqRef.current = Math.max(
                  confirmedCursor,
                  ...pendingMessagesRef.current.map((message) => publicSequence(message.seq))
                );
                recordLivePendingQueueSize(pendingMessagesRef.current.length);
                setState((current) => {
                  const next = applyPublicEvents(current, unapplied);
                  stateRef.current = next;
                  return next;
                });
              },
              isActive: () => active
            });
          } catch (error) {
            if (requestedTarget !== undefined) queuedRecoveryTarget = Math.max(queuedRecoveryTarget, requestedTarget);
            else queuedRecoveryPoll = true;
            throw error;
          }
          if (recoveryGeneration !== eventCursorGenerationRef.current) {
            queuedRecoveryTarget = Math.max(queuedRecoveryTarget, requestedTarget ?? latestObservedSeqRef.current);
            continue;
          }
          if (result.status === 'reset-required' || result.status === 'unrecoverable-gap') {
            const resetTarget = liveCursorResetTarget(
              result.latestSeq,
              lastAppliedEventSeqRef.current,
              latestInboundSeqRef.current
            );
            cursorEpochResetActiveRef.current = true;
            latestObservedSeqRef.current = resetTarget;
            latestInboundSeqRef.current = resetTarget;
            queuedRecoveryTarget = resetTarget;
            queuedRecoveryPoll = false;
            pendingMessagesRef.current = [];
            lastQueuedEventSeqRef.current = resetTarget;
            recordLivePendingQueueSize(0);
            if (flushMessagesFrameRef.current !== null) {
              window.cancelAnimationFrame(flushMessagesFrameRef.current);
              flushMessagesFrameRef.current = null;
            }
            resetRecoveryActive = true;
            refreshState(resetTarget, true);
            return;
          }
          if (result.status === 'caught-up') {
            lastAppliedEventSeqRef.current = Math.max(lastAppliedEventSeqRef.current, result.cursor);
            pendingMessagesRef.current = retainLiveEnvelopesAfterCursor(
              pendingMessagesRef.current,
              lastAppliedEventSeqRef.current
            );
            lastQueuedEventSeqRef.current = Math.max(
              lastAppliedEventSeqRef.current,
              ...pendingMessagesRef.current.map((message) => publicSequence(message.seq))
            );
            recordLivePendingQueueSize(pendingMessagesRef.current.length);
          }
          latestObservedSeqRef.current = Math.max(latestObservedSeqRef.current, result.latestSeq);
          if (result.status === 'empty') {
            setState((current) => applyPublicEnvelope(current, {
              v: 1,
              type: 'hello',
              seq: 0,
              latestSeq: 0,
              serverTime: Date.now(),
              connectionId: 'empty-recovery'
            }));
          }
        }
      };

      let recoveryFailed = false;
      void recover()
        .catch(() => {
          // Transient transport failures stay on cursor polling. A complete
          // snapshot is reserved for a server-declared reset or proven gap.
          recoveryFailed = true;
          if (active) setSocketStatus((current) => (current === 'live' ? current : 'polling'));
          if (active && recoveryRetryTimer === null) {
            recoveryRetryTimer = window.setTimeout(() => {
              recoveryRetryTimer = null;
              backfillOrRefresh(queuedRecoveryTarget || undefined);
            }, PUBLIC_STATE_FALLBACK_POLL_MS);
          }
        })
        .finally(() => {
          recoveryInFlight = false;
          if (!recoveryFailed && !resetRecoveryActive && active && (queuedRecoveryPoll || queuedRecoveryTarget > lastAppliedEventSeqRef.current)) {
            backfillOrRefresh(queuedRecoveryTarget || undefined);
          }
        });
    };
    eventRecoveryRef.current = backfillOrRefresh;
    const socket = connectPublicSocket((message) => {
      const observedSeq = Math.max(publicSequence(message.latestSeq), publicSequence(message.seq));
      if (message.type === 'hello') latestInboundSeqRef.current = observedSeq;
      else if (observedSeq > 0) latestInboundSeqRef.current = Math.max(latestInboundSeqRef.current, observedSeq);
      latestObservedSeqRef.current = Math.max(latestObservedSeqRef.current, observedSeq);
      if (message.type === 'hello') {
        setState((current) => applyPublicEnvelope(current, message));
        const resetProbe = helloRequiresCursorResetProbe(observedSeq, lastAppliedEventSeqRef.current);
        backfillOrRefresh(resetProbe ? undefined : (observedSeq > 0 ? observedSeq : undefined));
        return;
      }
      if (message.type === 'pong') {
        setState((current) => applyPublicEnvelope(current, message));
        return;
      }
      if (message.type === 'lagged') {
        pendingMessagesRef.current = [];
        lastQueuedEventSeqRef.current = lastAppliedEventSeqRef.current;
        recordLivePendingQueueSize(0);
        if (flushMessagesFrameRef.current !== null) {
          window.cancelAnimationFrame(flushMessagesFrameRef.current);
          flushMessagesFrameRef.current = null;
        }
        setState((current) => applyPublicEnvelope(current, message));
        const laggedTarget = Math.max(observedSeq, publicSequence(message.toSeq));
        backfillOrRefresh(laggedTarget > 0 ? laggedTarget : undefined);
        return;
      }
      enqueueMessage(message);
    }, setSocketStatus);
    return () => {
      active = false;
      if (eventRecoveryRef.current === backfillOrRefresh) eventRecoveryRef.current = null;
      if (recoveryRetryTimer !== null) window.clearTimeout(recoveryRetryTimer);
      if (stateRefreshRetryTimer !== null) window.clearTimeout(stateRefreshRetryTimer);
      if (flushMessagesFrameRef.current !== null) window.cancelAnimationFrame(flushMessagesFrameRef.current);
      flushMessagesFrameRef.current = null;
      pendingMessagesRef.current = [];
      lastQueuedEventSeqRef.current = lastAppliedEventSeqRef.current;
      recordLivePendingQueueSize(0);
      socket.close();
    };
  }, [applyPublicSnapshot]);

  useEffect(() => {
    return installResumeRecovery({
      document,
      window,
      shouldRehydrate: () => true,
      // An untargeted recovery polls after the durable applied cursor. Passing
      // the already-observed cursor would make the recovery loop a no-op and
      // could miss traffic received while the page was suspended.
      rehydrate: () => eventRecoveryRef.current?.(),
      onSuspend: recordVisibilityPause
    });
  }, []);

  useEffect(() => {
    if (socketStatus === 'live') return;
    let active = true;
    let interval: number | null = null;
    const recover = () => {
      if (!active) return;
      eventRecoveryRef.current?.();
    };
    const startPolling = () => {
      recover();
      interval = window.setInterval(recover, PUBLIC_STATE_FALLBACK_POLL_MS);
    };
    const negotiating = socketStatus === 'starting' || socketStatus === 'connecting';
    const initialTimer = window.setTimeout(startPolling, negotiating ? PUBLIC_STATE_FALLBACK_POLL_MS : 0);
    return () => {
      active = false;
      window.clearTimeout(initialTimer);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [socketStatus]);

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
    const interval = window.setInterval(() => setLiveClock(Date.now()), LIVE_CLOCK_IDLE_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const shouldLoadPropagation = propagationOpen || mapSettings.layers.propagationInsights;
    if (!shouldLoadPropagation) {
      setPropagationLoading(false);
      setPropagationError(null);
      return;
    }
    let active = true;
    let controller: AbortController | null = null;
    const loadPropagation = () => {
      controller?.abort();
      controller = new AbortController();
      const requestController = controller;
      const to = Date.now();
      const from = Math.max(0, to - 24 * 60 * 60_000);
      setPropagationLoading(true);
      fetchPublicPropagation({ from, to, limit: 80, signal: requestController.signal })
        .then((response) => {
          if (!active || requestController.signal.aborted) return;
          setPropagationEvents(response.events);
          setPropagationConditions(response.conditions);
          setPropagationError(null);
        })
        .catch((error) => {
          if (!active || requestController.signal.aborted || error?.name === 'AbortError') return;
          setPropagationError('Propagation history unavailable');
        })
        .finally(() => {
          if (!active || requestController.signal.aborted) return;
          setPropagationLoading(false);
        });
    };
    loadPropagation();
    const interval = window.setInterval(loadPropagation, 300_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, [mapSettings.layers.propagationInsights, propagationOpen]);

  const plotFirstNode = useMemo(() => state.nodes.find((node) => node.id === plotFirstNodeID) ?? null, [plotFirstNodeID, state.nodes]);
  const activityClock = Math.max(liveClock, state.serverTime, state.activity[0]?.heardAt ?? 0, state.routeTraces.at(-1)?.heardAt ?? 0);
  const activityClockBucket = Math.floor(activityClock / DERIVED_ACTIVITY_BUCKET_MS) * DERIVED_ACTIVITY_BUCKET_MS;
  const chromeHidden = chromeVisibility.chromeHidden;
  const chromePanelsMounted = !packetsOpen && !netGraphOpen && !chatOpen && !labOpen && !setupOpen && !propagationOpen;
  const hotRoutesPanelActive = chromePanelsMounted && !chromeHidden && chromeVisibility.panels.hotRoutes;
  const routeActivityByID = useMemo(
    () => hotRoutesPanelActive ? summarizeRouteActivity(state.routeTraces, activityClockBucket) : EMPTY_ROUTE_ACTIVITY,
    [activityClockBucket, hotRoutesPanelActive, state.routeTraces]
  );
  const coverage = useMemo(() => liveCoverageStats(state.activity, activityClockBucket), [state.activity, activityClockBucket]);
  const latestPacketActivity = useMemo(() => state.activity.find(isPacketActivity) ?? null, [state.activity]);
  const livePackets = useMemo(() => livePacketsFromActivity(state.activity, state.pulses), [state.activity, state.pulses]);
  const loadingPositionedNodes = initialLoadGateOpen && (!initialNodesReceived || !positionedNodesRendered);
  const handlePositionedNodesRendered = useCallback(() => setPositionedNodesRendered(true), []);
  const handleViewChange = useCallback((view: MapViewState) => setMapView(view), []);
  const hotRoutes = useMemo(
    () => {
      if (!hotRoutesPanelActive) return EMPTY_HOT_ROUTES;
      return [...visibleRoutes].sort((a, b) => {
        const recentDelta = (routeActivityByID.get(b.id)?.total ?? 0) - (routeActivityByID.get(a.id)?.total ?? 0);
        if (recentDelta !== 0) return recentDelta;
        return b.packetCount - a.packetCount || b.lastHeard - a.lastHeard;
      });
    },
    [hotRoutesPanelActive, visibleRoutes, routeActivityByID]
  );

  const dispatchMapAction = useCallback((next: 'reset' | 'latest-route' | 'route' | 'node', value?: string) => {
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    if (next === 'route' && value) setMapAction({ type: 'route', routeID: value, token });
    else if (next === 'node' && value) setMapAction({ type: 'node', nodeID: value, token });
    else if (next === 'latest-route') setMapAction({ type: 'latest-route', token });
    else setMapAction({ type: 'reset', token });
  }, []);

  const focusPublicRegion = useCallback((region: CommandPaletteRegionFocus) => {
    clearSelection();
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    setMapAction({
      type: 'region',
      token,
      label: region.label,
      latitude: region.latitude,
      longitude: region.longitude
    });
  }, [clearSelection]);

  const selectNodeFromList = useCallback((id: string) => {
    selectNode(id);
    closeNodeList();
  }, [closeNodeList, selectNode]);

  const selectRoute = useCallback((routeID: string) => {
    selectRouteSelectionOnly(routeID);
    dispatchMapAction('route', routeID);
  }, [dispatchMapAction, selectRouteSelectionOnly]);

  const focusPacketPath = useCallback((packet: PublicPacketPath) => {
    selectPacket(packet);
    setPacketsOpen(false);
    setPacketsPanelMode('expanded');
    if (window.location.hash === '#/packets') {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    setMapAction({ type: 'packet', token, segments: packet.segments });
  }, [selectPacket, setPacketsOpen, setPacketsPanelMode]);

  const replayPacketPath = useCallback((packet: PublicPacketPath, speedOverride?: number, forceCanvas = false) => {
    setPlotMode('off');
    setPlotFirstNodeID(null);
    setPlotAreaFirstPoint(null);
    setFollowTraffic(false);
    selectPacket(packet);
    setPacketsOpen(true);
    setPacketsPanelMode('compactTray');
    if (window.location.hash === '#/packets') {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    const travelDurationMs = cinematicPacketReplayDuration(packet.segmentCount, speedOverride ?? mapSettings.packets.speed);
    const pulse = packetToPulse(packet, Date.now(), {
      force: true,
      travelDurationMs,
      brightness: mapSettings.packets.brightness,
      trailScale: mapSettings.packets.trail,
      animationStyle: mapSettings.packets.animationStyle
    });
    setMapAction({
      type: 'packet-replay',
      token,
      segments: packet.segments,
      pulse,
      settleMs: 650,
      travelDurationMs,
      forceCanvas
    });
  }, [mapSettings.packets, selectPacket, setPacketsOpen, setPacketsPanelMode]);

  const focusPropagationEvent = useCallback((event: PublicPropagationEvent) => {
    setPropagationOpen(true);
    setPacketsOpen(false);
    setPacketsPanelMode('expanded');
    clearResolvedSelection();
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    setMapAction({ type: 'packet', token, segments: event.segments });
  }, [clearResolvedSelection, setPacketsOpen, setPacketsPanelMode]);

  const replayPropagationEvent = useCallback((event: PublicPropagationEvent) => {
    setPlotMode('off');
    setPlotFirstNodeID(null);
    setPlotAreaFirstPoint(null);
    setFollowTraffic(false);
    setPropagationOpen(true);
    setPacketsOpen(false);
    setPacketsPanelMode('expanded');
    clearResolvedSelection();
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    const travelDurationMs = cinematicPacketReplayDuration(event.segments.length, mapSettings.packets.speed);
    const pulse: PublicRoutePulse = {
      id: `propagation:${event.id}:${token}`,
      region: event.region,
      payloadTypeName: event.classification === 'tropo_possible' ? 'Tropo possible' : 'Long-distance event',
      heardAt: event.at,
      receivedAt: Date.now(),
      displayAt: Date.now(),
      segments: event.segments,
      replayOptions: {
        force: true,
        travelDurationMs,
        brightness: Math.max(1.15, mapSettings.packets.brightness),
        trailScale: Math.max(1.1, mapSettings.packets.trail),
        animationStyle: mapSettings.packets.animationStyle
      }
    };
    setMapAction({
      type: 'packet-replay',
      token,
      segments: event.segments,
      pulse,
      settleMs: 650,
      travelDurationMs
    });
  }, [clearResolvedSelection, mapSettings.packets, setPacketsOpen, setPacketsPanelMode]);

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
      showToast({ tone: 'warning', title: 'No route copy path', message: 'This public path has no 3-byte MeshCore prefix.' });
      window.setTimeout(() => setPathCopyToast(null), 2200);
      return;
    }
    try {
      await copyTextToClipboard(text);
      setPathCopyToast('3-byte path copied');
      showToast({ tone: 'success', title: '3-byte path copied' });
    } catch {
      setPathCopyToast('Copy failed');
      showToast({ tone: 'error', title: 'Copy failed', message: 'Clipboard access was blocked by the browser.' });
    }
    window.setTimeout(() => setPathCopyToast(null), 2200);
  }, [showToast]);

  const toggleKnownPathways = useCallback(() => {
    setMapSettings((current) => normalizeMapSettings({
      ...current,
      customized: true,
      layers: { ...current.layers, routes: !current.layers.routes }
    }));
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleUpdate = () => {
      setServiceWorkerActivating(false);
      setServiceWorkerUpdateReady(true);
    };
    window.addEventListener(SERVICE_WORKER_UPDATE_EVENT, handleUpdate);
    if (waitingServiceWorkerUpdateAvailable()) handleUpdate();
    return () => window.removeEventListener(SERVICE_WORKER_UPDATE_EVENT, handleUpdate);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyK') {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        clearSelection();
        clearPlotRoutes();
      }
      if (event.code === 'Space') {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        event.preventDefault();
        togglePausedByUser();
      }
      if (event.code === 'KeyL') {
        setFollowTraffic((value) => !value);
      }
      if (event.key === '?' && !event.ctrlKey && !event.metaKey) {
        setShortcutHelpOpen(true);
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearPlotRoutes, clearSelection, togglePausedByUser]);

  const shareView = useCallback(async () => {
    const view = mapView ?? (sharedViewRef.current ? { lat: sharedViewRef.current.lat, lng: sharedViewRef.current.lng, z: sharedViewRef.current.z } : null);
    if (!view) {
      showToast({ tone: 'warning', title: 'Map view not ready', message: 'Wait for the map camera to settle, then share again.' });
      return;
    }
    const url = buildSharedViewURL(window.location.href, view, {
      route: selectedRouteID,
      node: selectedNodeID,
      q: query
    });
    try {
      await copyTextToClipboard(url);
      showToast({ tone: 'success', title: 'View link copied' });
    } catch {
      showToast({ tone: 'error', title: 'Copy failed', message: 'Clipboard access was blocked by the browser.' });
    }
  }, [mapView, query, selectedNodeID, selectedRouteID, showToast]);

  const exportSelectedPacketGif = useCallback(async (packetOverride?: PublicPacketPath) => {
    const packet = packetOverride ?? selectedPacket;
    if (!packet || routeGifExport.status === 'rendering') return;
    const now = Date.now();
    if (now < gifCooldownUntilRef.current) return;
    const windowStart = now - GIF_EXPORT_WINDOW_MS;
    gifExportTimestampsRef.current = gifExportTimestampsRef.current.filter(t => t > windowStart);
    if (gifExportTimestampsRef.current.length >= GIF_EXPORT_MAX_PER_WINDOW) {
      setRouteGifExport(s => ({ ...s, status: 'error', progress: 0 }));
      showToast({ tone: 'warning', title: 'GIF limit reached', message: 'Try another route export in a few minutes.' });
      window.setTimeout(() => {
        setRouteGifExport((current) => (current.status === 'error' ? { ...current, status: 'idle', progress: 0 } : current));
      }, 3600);
      return;
    }
    gifExportTimestampsRef.current.push(now);
    gifCooldownUntilRef.current = now + GIF_EXPORT_COOLDOWN_MS;
    const remaining = GIF_EXPORT_MAX_PER_WINDOW - gifExportTimestampsRef.current.filter(t => t > now - GIF_EXPORT_WINDOW_MS).length;
    setFollowTraffic(false);
    gifExportPauseSessionRef.current = beginOwnedPause(paused);
    setPaused(true);
    setRouteGifExport({ status: 'rendering', progress: 0.02, remainingExports: remaining, cooldownUntil: gifCooldownUntilRef.current });
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    const travelDurationMs = routeGifAnimationDurationMs();
    const pulse = packetToPulse(packet, Date.now(), {
      force: true,
      travelDurationMs,
      brightness: Math.max(1.35, mapSettings.packets.brightness),
      trailScale: Math.max(1.2, mapSettings.packets.trail),
      animationStyle: mapSettings.packets.animationStyle
    });
    setRouteGifExportRequest({
      token,
      packet,
      pulse,
      settleMs: 650,
      travelDurationMs,
      onProgress: (progress) => setRouteGifExport(s => ({ ...s, progress })),
      onComplete: (blob) => {
        downloadRouteGifBlob(packet, blob);
        setRouteGifExportRequest(null);
        finishGifExportPause();
        setRouteGifExport(s => ({ ...s, status: 'done', progress: 1 }));
        showToast({ tone: 'success', title: 'Route GIF exported' });
        window.setTimeout(() => {
          setRouteGifExport((current) => (current.status === 'done' ? { ...current, status: 'idle', progress: 0 } : current));
        }, 2600);
      },
      onError: () => {
        gifExportTimestampsRef.current.pop();
        const rem = GIF_EXPORT_MAX_PER_WINDOW - gifExportTimestampsRef.current.filter(t => t > Date.now() - GIF_EXPORT_WINDOW_MS).length;
        setRouteGifExportRequest(null);
        finishGifExportPause();
        setRouteGifExport(s => ({ ...s, status: 'error', progress: 0, remainingExports: rem }));
        showToast({ tone: 'error', title: 'GIF export failed', message: 'The map was busy. Try again after it settles.' });
        window.setTimeout(() => {
          setRouteGifExport((current) => (current.status === 'error' ? { ...current, status: 'idle', progress: 0 } : current));
        }, 3600);
      }
    });
  }, [finishGifExportPause, mapSettings.packets, paused, routeGifExport.status, selectedPacket, showToast]);

  const showRouteGifExport = Boolean(selectedPacket && !packetsOpen && !netGraphOpen && !chatOpen && !labOpen && !setupOpen && !propagationOpen);
  const activeMapMode = mapModeForSettings(mapSettings);
  const selectMapMode = useCallback((modeID: MapModeID) => {
    setMapSettings((current) => applyMapMode(current, modeID));
    const mode = MAP_MODES.find((item) => item.id === modeID);
    if (mode) showToast({ tone: 'success', title: `${mode.label} mode`, message: mode.hint, durationMs: 1800 });
    setPanelsMenuOpen(false);
    setMobileControlsOpen(false);
  }, [showToast]);
  const followRecentActive = followTraffic;
  const toggleFollowRecent = useCallback(() => {
    if (followRecentActive) {
      setFollowTraffic(false);
      showToast({ tone: 'info', title: 'Follow off', message: 'The map will stay where you leave it.', durationMs: 1600 });
      return;
    }
    setFollowTraffic(true);
    dispatchMapAction('latest-route');
    showToast({ tone: 'success', title: 'Following recent activity', message: 'The camera will ease toward fresh routed traffic.', durationMs: 1800 });
  }, [dispatchMapAction, followRecentActive, showToast]);
  const openReplayWaterfall = useCallback(() => {
    window.location.hash = labExperimentPath(DEFAULT_LAB_EXPERIMENT_ID);
  }, []);
  const dashboardActions = useMemo<DashboardAction[]>(() => [
    { id: 'packets', label: 'PacketTV', description: 'Browse routed public packets', group: 'Explore', keywords: ['packet', 'traffic'], run: openPackets },
    { id: 'nodes', label: 'Browse nodes', description: 'Search the public node phonebook', group: 'Explore', keywords: ['radio', 'repeater'], run: openNodeList },
    { id: 'waterfall', label: 'Waterfall Labs', description: 'Open the audiovisual public traffic lab', group: 'Explore', keywords: ['lab', 'audio'], run: openReplayWaterfall },
    { id: 'propagation', label: 'Propagation', description: 'Open public RF condition history', group: 'Explore', keywords: ['weather', 'los'], run: () => setPropagationOpen(true) },
    { id: 'map-settings', label: 'Map settings', description: 'Change map mode, layers, and motion', group: 'View', keywords: ['terrain', '3d', 'style'], run: () => setMapSettingsOpen(true) },
    { id: 'share', label: 'Share current view', description: 'Copy a privacy-safe map link', group: 'Utility', keywords: ['link', 'copy'], run: shareView },
    { id: 'pause', label: paused ? 'Resume feed' : 'Pause feed', description: paused ? 'Resume live visual updates' : 'Pause live visual updates', group: 'Playback', run: togglePausedByUser },
    { id: 'toggle-ui', label: chromeHidden ? 'Show map UI' : 'Hide map UI', description: 'Toggle map panels and status chrome', group: 'View', run: toggleChromeVisibility }
  ], [chromeHidden, openNodeList, openPackets, openReplayWaterfall, paused, shareView, toggleChromeVisibility, togglePausedByUser]);
  const knownPathwaysOn = mapSettings.layers.routes;
  const workspaceSurfaceOpen = packetsOpen || netGraphOpen || chatOpen || labOpen || nodeListOpen;
  const visitorGuideSuppressed = chromeHidden || packetsOpen || netGraphOpen || chatOpen || labOpen || setupOpen || propagationOpen || nodeListOpen || shortcutHelpOpen || mapSettingsOpen || mobileControlsOpen || commandPaletteOpen || Boolean(selectedNode || selectedRoute || selectedPacket);

  return (
    <div
      className="app-shell public-dashboard"
      data-topology-hydrated={fullStateHydrated ? 'true' : 'false'}
      data-topology-node-count={visibleNodes.length}
      data-topology-route-count={visibleRoutes.length}
      data-live-seq={state.latestSeq}
      data-latest-pulse-id={state.pulses[0]?.id ?? ''}
      data-theme-mode={themeMode}
      data-theme-palette={selectedThemePalette.id}
      data-live-flow={paused ? 'paused' : 'live'}
      data-packets-mode={packetsOpen ? packetsPanelMode : 'closed'}
      style={appThemeStyle}
    >
      {isOffline && <div className="offline-banner">You are offline — reconnecting...</div>}
      {serviceWorkerUpdateReady && (
        <div className="app-update-banner" role="status">
          <span><strong>Update ready</strong><small>A new verified map build is available.</small></span>
          <button type="button" disabled={serviceWorkerActivating} onClick={() => {
            setServiceWorkerActivating(true);
            if (!activateWaitingServiceWorker()) window.location.reload();
          }}>{serviceWorkerActivating ? 'Activating…' : 'Reload now'}</button>
          <button type="button" disabled={serviceWorkerActivating} aria-label="Dismiss update notice" onClick={() => setServiceWorkerUpdateReady(false)}><X size={14} /></button>
        </div>
      )}
      <ErrorBoundary fallback={<div className="panel-error">Something went wrong. <button onClick={() => window.location.reload()}>Reload</button></div>}>
      <ErrorBoundary>
        <CanadaMap
        nodes={visibleNodes}
        routes={visibleRoutes}
        routeTopologyRevision={state.routeTopologyRevision}
        routeVisualRevision={state.routeVisualRevision}
        routeViewRevision={routeViewRevision}
        pulses={state.pulses}
        observerBursts={state.observerBursts}
        propagationEvents={propagationEvents}
        paused={paused}
        followTraffic={followTraffic}
        clearToken={clearToken}
        selectedNodeID={selectedNodeID}
        selectedRouteID={selectedRouteID}
        highlightedPathRouteIDs={highlightedPathRouteIDs}
        highlightedPathNodeIDs={highlightedPathNodeIDs}
        analysisSegments={selectedPacket?.segments ?? []}
        styleProfileID={mapSettings.style.profileID}
        styleSettings={mapSettings.style}
        layerSettings={mapSettings.layers}
        packetVisualSettings={mapSettings.packets}
        plotMode={plotMode}
        mapAction={mapAction}
        routeGifExportRequest={routeGifExportRequest}
        themeMode={mapThemeMode}
        initialView={sharedViewRef.current}
        mapConfig={publicMapConfig}
        loading={loadingPositionedNodes}
        onPositionedNodesRendered={handlePositionedNodesRendered}
        onViewChange={handleViewChange}
        onSelectNode={selectNode}
        onPlotNodePick={handlePlotNodePick}
        onPlotMapPoint={handlePlotMapPoint}
          onClearSelection={clearSelection}
        />
      </ErrorBoundary>
      {loadingPositionedNodes && <NodeLoadingToast failed={nodeLoadFailed} drawing={initialNodesReceived} />}
      {!initialNodesReceived && bootstrapClusters.length > 0 && (
        <div className="bootstrap-cluster-summary" role="status" aria-live="polite">
          <strong>{bootstrapClusters.reduce((sum, cluster) => sum + cluster.count, 0).toLocaleString()}</strong>
          <span>public nodes across {bootstrapClusters.length.toLocaleString()} regions</span>
          <small>Loading detailed pathways…</small>
        </div>
      )}
      <LinkBar packetsOpen={packetsOpen} netGraphOpen={netGraphOpen} chatOpen={chatOpen} labOpen={labOpen} nodeListOpen={nodeListOpen} activeLabExperimentID={labExperimentID} />
      {!chromeHidden && (
        <StatusBar
          stats={state.stats}
          socketStatus={socketStatus}
          nodeCount={visibleNodes.length}
          routeCount={visibleRoutes.length}
          coverage={coverage}
          latestPayloadTypeName={latestPacketActivity?.payloadTypeName ?? null}
          latestPacketID={latestPacketActivity?.id ?? null}
        />
      )}

      <div className="top-actions operator-toolbar" aria-label="Map actions">
        <div className="map-mode-switcher" role="group" aria-label="Map mode">
          {MAP_MODES.map((mode) => (
            <button
              key={mode.id}
              className={activeMapMode.id === mode.id && !mapSettings.customized ? 'active' : ''}
              type="button"
              aria-pressed={activeMapMode.id === mode.id && !mapSettings.customized}
              title={mode.hint}
              onClick={() => selectMapMode(mode.id)}
            >
              <span>{mode.shortLabel}</span>
            </button>
          ))}
        </div>
        <button
          className={`operator-action follow-recent-toggle ${followRecentActive ? 'active' : ''}`}
          type="button"
          aria-pressed={followRecentActive}
          title={followRecentActive ? 'Stop following recent traffic' : 'Follow recent traffic'}
          onClick={toggleFollowRecent}
        >
          <RadioTower size={16} />
          <span>Follow</span>
        </button>
        <button className={`operator-action known-pathways-toggle ${knownPathwaysOn ? 'on' : 'off'}`} type="button" aria-pressed={knownPathwaysOn} title={knownPathwaysOn ? 'Routes on' : 'Routes off'} onClick={toggleKnownPathways}>
          <Route size={16} />
          <span>Routes</span>
        </button>
        <button
          className={`operator-action map-settings-toggle ${mapSettingsOpen ? 'active' : ''}`}
          type="button"
          aria-pressed={mapSettingsOpen}
          title="Map"
          onClick={() => {
            setMapSettingsOpen((value) => !value);
            setPanelsMenuOpen(false);
            setPaletteMenuOpen(false);
          }}
        >
          <SlidersHorizontal size={16} />
          <span>Map</span>
        </button>
        <button className="operator-action command-palette-toggle" type="button" aria-keyshortcuts="Control+K Meta+K" title="Search commands, regions, nodes, and routes (Ctrl/Command K)" onClick={() => setCommandPaletteOpen(true)}>
          <Search size={16} />
          <span>Search</span>
        </button>
        <div className="top-action-menu">
          <button
            className={`operator-action ${panelsMenuOpen ? 'active' : ''}`}
            type="button"
            aria-haspopup="menu"
            aria-expanded={panelsMenuOpen}
            title="More"
            onClick={() => {
              setPanelsMenuOpen((value) => !value);
              setMapSettingsOpen(false);
            }}
          >
            <MoreHorizontal size={16} />
            <span>More</span>
          </button>
          {panelsMenuOpen && (
            <div className="top-popover operator-more-menu" role="menu" aria-label="More map actions">
              <div className="operator-menu-section">
                <span>Tools</span>
                {dashboardActions.filter((action) => ['nodes', 'propagation', 'share'].includes(action.id)).map((action) => (
                  <button key={action.id} type="button" disabled={action.disabled} onClick={() => { void action.run(); setPanelsMenuOpen(false); }}>
                    {dashboardActionIcon(action.id, 14)}
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
              <div className="operator-menu-section">
                <span>View</span>
                <button type="button" onClick={toggleChromeVisibility}>
                  {chromeHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                  <span>{chromeHidden ? 'Show UI' : 'Hide UI'}</span>
                </button>
                <button type="button" onClick={() => setThemeMode((value) => toggleThemeMode(value))}>
                  {themeMode === 'system' ? <Monitor size={14} /> : themeMode === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
                  <span>Theme</span>
                </button>
                <button type="button" onClick={() => setPaletteMenuOpen((value) => !value)}>
                  <Palette size={14} />
                  <span>Palettes</span>
                </button>
                {paletteMenuOpen && THEME_PALETTES.map((palette) => {
                  const selected = palette.id === selectedThemePalette.id;
                  return (
                    <button key={palette.id} className={selected ? 'active' : ''} type="button" role="menuitemradio" aria-checked={selected} onClick={() => setThemePaletteID(palette.id)}>
                      <span className="palette-swatch" style={paletteSwatchStyle(palette)}>
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>{palette.name}</span>
                      {selected && <Check size={14} />}
                    </button>
                  );
                })}
              </div>
              <div className="operator-menu-section">
                <span>Panels</span>
                {PANEL_MENU_ITEMS.map((item) => {
                  const visible = chromePanelVisible(chromeVisibility, item.id);
                  return (
                    <button key={item.id} className={visible ? 'active' : ''} type="button" role="menuitemcheckbox" aria-checked={visible} onClick={() => toggleChromePanel(item.id)}>
                      <Columns3 size={14} />
                      <span>{item.label}</span>
                      {visible && <Check size={14} />}
                    </button>
                  );
                })}
              </div>
              <div className="operator-menu-section">
                <span>Utility</span>
                <button type="button" onClick={() => setClearToken((value) => value + 1)}>
                  <RotateCcw size={14} />
                  <span>Clear pulses</span>
                </button>
                <button type="button" onClick={togglePausedByUser}>
                  {paused ? <Play size={14} /> : <Pause size={14} />}
                  <span>{paused ? 'Resume feed' : 'Pause feed'}</span>
                </button>
                <button type="button" onClick={() => dispatchMapAction('reset')}>
                  <X size={14} />
                  <span>Reset map</span>
                </button>
                <button type="button" onClick={() => { setShortcutHelpOpen(true); setPanelsMenuOpen(false); }}>
                  <MoreHorizontal size={14} />
                  <span>Help</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <VisitorGuide
        knownPathwaysOn={knownPathwaysOn}
        suppressed={visitorGuideSuppressed}
        onOpenSettings={() => {
          setMapSettingsOpen(true);
          setPanelsMenuOpen(false);
          setPaletteMenuOpen(false);
          setMobileControlsOpen(false);
        }}
        onOpenHelp={() => setShortcutHelpOpen(true)}
        onToggleKnownPathways={toggleKnownPathways}
      />
      <nav className="mobile-control-dock mobile-tabbar" aria-label="Mobile app tabs">
        <button
          className={`mobile-control-button ${!workspaceSurfaceOpen && !setupOpen && !propagationOpen ? 'active' : ''}`}
          type="button"
          aria-current={!workspaceSurfaceOpen && !setupOpen && !propagationOpen ? 'page' : undefined}
          title="Map"
          onClick={openMapHome}
        >
          <RadioTower size={20} />
          <span>Map</span>
        </button>
        <button
          className={`mobile-control-button ${packetsOpen ? 'active' : ''}`}
          type="button"
          aria-current={packetsOpen ? 'page' : undefined}
          title="Packets"
          onClick={openPackets}
        >
          <List size={20} />
          <span>Packets</span>
        </button>
        <button
          className={`mobile-control-button ${nodeListOpen ? 'active' : ''}`}
          type="button"
          aria-current={nodeListOpen ? 'page' : undefined}
          title="Nodes"
          onClick={openNodeList}
        >
          <Route size={20} />
          <span>Nodes</span>
        </button>
        <button
          className={`mobile-control-button ${chatOpen ? 'active' : ''}`}
          type="button"
          aria-current={chatOpen ? 'page' : undefined}
          title="Chat"
          onClick={openChat}
        >
          <MessageSquareText size={20} />
          <span>Chat</span>
        </button>
        <button
          className={`mobile-control-button ${mobileControlsOpen ? 'active' : ''}`}
          type="button"
          aria-expanded={mobileControlsOpen}
          title="More"
          onClick={() => {
            setMobileControlsOpen((value) => !value);
            setPanelsMenuOpen(false);
            setPaletteMenuOpen(false);
            setMapSettingsOpen(false);
          }}
        >
          <MoreHorizontal size={20} />
          <span>More</span>
        </button>
      </nav>
      {mobileControlsOpen && (
        <section ref={mobileControlsRef} className="mobile-control-sheet" role="dialog" aria-modal="true" aria-label="More map controls" tabIndex={-1}>
          <header className="mobile-control-sheet-header">
            <div>
              <span className="panel-eyebrow">Map</span>
              <h2>More</h2>
            </div>
            <button type="button" className="icon-button" title="Close map controls" onClick={() => setMobileControlsOpen(false)}>
              <X size={18} />
            </button>
          </header>
          <section className="mobile-control-section mobile-mode-section">
            <h3>Mode</h3>
            <div className="mobile-mode-grid">
              {MAP_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={activeMapMode.id === mode.id && !mapSettings.customized ? 'active' : ''}
                  type="button"
                  aria-pressed={activeMapMode.id === mode.id && !mapSettings.customized}
                  onClick={() => selectMapMode(mode.id)}
                >
                  <strong>{mode.shortLabel}</strong>
                  <span>{mode.hint}</span>
                </button>
              ))}
            </div>
          </section>
          <div className="mobile-control-grid">
            <button type="button" onClick={() => { setCommandPaletteOpen(true); setMobileControlsOpen(false); }}>
              <Search size={18} />
              <span>Search</span>
            </button>
            <button
              type="button"
              aria-pressed={followRecentActive}
              onClick={toggleFollowRecent}
            >
              <RadioTower size={18} />
              <span>{followRecentActive ? 'Following' : 'Follow'}</span>
            </button>
            <button
              type="button"
              aria-pressed={knownPathwaysOn}
              onClick={toggleKnownPathways}
            >
              <Route size={18} />
              <span>{knownPathwaysOn ? 'Routes on' : 'Routes off'}</span>
            </button>
            {dashboardActions.filter((action) => ['map-settings', 'propagation', 'pause', 'share', 'nodes'].includes(action.id)).map((action) => (
              <button key={action.id} type="button" disabled={action.disabled} onClick={() => { void action.run(); setMobileControlsOpen(false); }}>
                {dashboardActionIcon(action.id, 18)}
                <span>{action.label}</span>
              </button>
            ))}
            <button type="button" onClick={() => setClearToken((value) => value + 1)}>
              <RotateCcw size={18} />
              <span>Clear</span>
            </button>
            <button type="button" onClick={() => { setShortcutHelpOpen(true); setMobileControlsOpen(false); }}>
              <MoreHorizontal size={18} />
              <span>Help</span>
            </button>
          </div>
          <section className="mobile-control-section">
            <h3>Panels</h3>
            <div className="mobile-panel-grid">
              {PANEL_MENU_ITEMS.map((item) => {
                const visible = chromePanelVisible(chromeVisibility, item.id);
                return (
                  <button
                    key={item.id}
                    className={visible ? 'active' : ''}
                    type="button"
                    aria-pressed={visible}
                    onClick={() => toggleChromePanel(item.id)}
                  >
                    <span>{item.label}</span>
                    {visible && <Check size={14} />}
                  </button>
                );
              })}
            </div>
          </section>
          <section className="mobile-control-section">
            <h3>Palette</h3>
            <div className="mobile-panel-grid palette-mobile-grid">
              {THEME_PALETTES.map((palette) => {
                const selected = palette.id === selectedThemePalette.id;
                return (
                  <button
                    key={palette.id}
                    className={selected ? 'active' : ''}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setThemePaletteID(palette.id)}
                  >
                    <span className="palette-swatch" style={paletteSwatchStyle(palette)}>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>{palette.name}</span>
                    {selected && <Check size={14} />}
                  </button>
                );
              })}
            </div>
          </section>
        </section>
      )}
      {commandPaletteOpen && (
        <ErrorBoundary fallback={<div className="panel-error">Search failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}>
          <Suspense fallback={<LoadingSpinner label="Opening search" />}>
            <CommandPalette
              actions={dashboardActions}
              nodes={state.nodes}
              routes={state.routes}
              clusters={bootstrapClusters}
              onSelectNode={(nodeID) => { selectNode(nodeID); dispatchMapAction('node', nodeID); }}
              onSelectRoute={selectRoute}
              onSelectRegion={focusPublicRegion}
              onClose={() => setCommandPaletteOpen(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {showRouteGifExport && (
        <RouteGifExportButton
          packet={selectedPacket}
          status={routeGifExport.status}
          progress={routeGifExport.progress}
          cooldownUntil={routeGifExport.cooldownUntil}
          remainingExports={routeGifExport.remainingExports}
          onExport={exportSelectedPacketGif}
        />
      )}
      {setupOpen && <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}><Suspense fallback={<PanelSkeleton title="Loading setup" message="Preparing deployment setup tools." />}><SetupPanel mapConfig={publicMapConfig} onClose={closeSetup} /></Suspense></ErrorBoundary>}
      {mapSettingsOpen && (
        <MapSettingsDrawer
          settings={mapSettings}
          onChange={setMapSettings}
          onClose={() => setMapSettingsOpen(false)}
          onOpenPropagation={() => {
            setPropagationOpen(true);
            setMapSettingsOpen(false);
          }}
        />
      )}
      {propagationOpen && (
        <PropagationPanel
          conditions={propagationConditions}
          events={propagationEvents}
          loading={propagationLoading}
          error={propagationError}
          onClose={() => setPropagationOpen(false)}
          onFocus={focusPropagationEvent}
          onReplay={replayPropagationEvent}
        />
      )}
      {packetsOpen && (
        <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}>
          <Suspense fallback={<PanelSkeleton title="Loading packets" message="Opening the routed packet workspace." />}>
            <PacketsPanel
              mode={packetsPanelMode}
              selectedPacketID={selectedPacket?.id ?? null}
              selectedPacket={selectedPacket}
              livePackets={livePackets}
              presentation={workspacePresentation}
              onClose={closePackets}
              onExpand={() => setPacketsPanelMode('expanded')}
              onPresentationChange={setWorkspacePresentation}
              onSelectPacket={focusPacketPath}
              onReplayPacket={replayPacketPath}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {netGraphOpen && (
        <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}>
          <Suspense fallback={<PanelSkeleton title="Preparing network graph" message="Loading graph controls and canvas layout." />}>
            <NetGraphPanel
              nodes={state.nodes}
              routes={state.routes}
              pulses={state.pulses}
              activity={state.activity}
              socketStatus={socketStatus}
              onClose={closeNetGraph}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {chatOpen && <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}><Suspense fallback={<PanelSkeleton title="Loading public chat" message="Fetching the chat workspace." />}><ChatPanel presentation={workspacePresentation} onPresentationChange={setWorkspacePresentation} onClose={closeChat} /></Suspense></ErrorBoundary>}
      {labOpen && <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}><Suspense fallback={<PanelSkeleton title="Loading waterfall" message="Preparing Labs visuals." />}><LabPanel state={state} socketStatus={socketStatus} experimentID={labExperimentID} presentation={workspacePresentation} onExperimentChange={selectLabExperiment} onPresentationChange={setWorkspacePresentation} onClose={closeLab} /></Suspense></ErrorBoundary>}
      {nodeListOpen && <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}><Suspense fallback={<PanelSkeleton title="Loading nodes" message="Preparing the public node workspace." />}><NodeListPanel nodes={visibleNodes} selectedNodeID={selectedNodeID} presentation={workspacePresentation} onPresentationChange={setWorkspacePresentation} onSelectNode={selectNodeFromList} onClose={closeNodeList} /></Suspense></ErrorBoundary>}
      {shortcutHelpOpen && <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}><Suspense fallback={<PanelSkeleton title="Loading help" message="Opening map shortcuts." rows={3} />}><ShortcutHelp onClose={() => setShortcutHelpOpen(false)} /></Suspense></ErrorBoundary>}

      {!packetsOpen && !netGraphOpen && !chatOpen && !labOpen && !setupOpen && !propagationOpen && !chromeHidden && (
        <div className="bottom-action-dock" aria-label="Map playback and route controls">
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
        </div>
      )}

      {!chromeHidden && !workspaceSurfaceOpen && (
        <>
          <ChromePanel
            panel="search"
            title="Search"
            anchor={panelAnchors.search}
            hidden={!chromeVisibility.panels.search}
            viewportBounds={viewportBounds}
            onAnchorChange={setChromePanelAnchor}
            onHide={hideChromePanel}
          >
            <section className="search-panel">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes, roles, regions" />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={15} />
                </button>
              )}
            </section>
          </ChromePanel>
          <ChromePanel
            panel="legend"
            title="Legend"
            anchor={panelAnchors.legend}
            hidden={!chromeVisibility.panels.legend}
            viewportBounds={viewportBounds}
            onAnchorChange={setChromePanelAnchor}
            onHide={hideChromePanel}
          >
            <Legend />
          </ChromePanel>
          <ChromePanel
            panel="hotRoutes"
            title="Busy Pathways"
            anchor={panelAnchors.hotRoutes}
            hidden={!chromeVisibility.panels.hotRoutes}
            viewportBounds={viewportBounds}
            onAnchorChange={setChromePanelAnchor}
            onHide={hideChromePanel}
          >
            <HotRoutes routes={hotRoutes} selectedRouteID={selectedRouteID} routeActivityByID={routeActivityByID} onSelect={selectRoute} />
          </ChromePanel>
        </>
      )}
      <SelectionDrawer
        node={selectedNode}
        route={selectedRoute}
        connectedRoutes={selectedConnectivity.routes}
        phonebookGroups={phonebookGroups}
        connectivityGraph={connectivityGraph}
        selectedPath={selectedPhonebookPath}
        selectedPathTargetID={highlightedPathTargetID}
        messageHistory={selectedNodeMessageHistory}
        copyStatus={pathCopyToast}
        onRouteSelect={selectRoute}
        onPhonebookSelect={selectPhonebookPath}
        onCopyPath={copyMeshcorePath}
        onClose={clearSelection}
      />
      </ErrorBoundary>
    </div>
  );
}

function dashboardActionIcon(actionID: string, size: number) {
  if (actionID === 'packets') return <List size={size} />;
  if (actionID === 'nodes') return <RadioTower size={size} />;
  if (actionID === 'waterfall' || actionID === 'propagation') return <CloudSun size={size} />;
  if (actionID === 'map-settings') return <SlidersHorizontal size={size} />;
  if (actionID === 'share') return <Share2 size={size} />;
  if (actionID === 'pause') return <Pause size={size} />;
  if (actionID === 'toggle-ui') return <Eye size={size} />;
  return <Search size={size} />;
}

function deferStateHydration(task: () => Promise<void>): () => void {
  const browser = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  let started = false;
  let idleID: number | undefined;
  let timerID: number | undefined;
  const cleanup = () => {
    if (idleID !== undefined) browser.cancelIdleCallback?.(idleID);
    if (timerID !== undefined) window.clearTimeout(timerID);
    window.removeEventListener('pointerdown', run);
    window.removeEventListener('keydown', run);
  };
  const run = () => {
    if (started) return;
    started = true;
    cleanup();
    void task();
  };
  window.addEventListener('pointerdown', run, { once: true, passive: true });
  window.addEventListener('keydown', run, { once: true });
  if (browser.requestIdleCallback) idleID = browser.requestIdleCallback(run, { timeout: 1_500 });
  else timerID = window.setTimeout(run, 500);
  return cleanup;
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

function cinematicPacketReplayDuration(segmentCount: number, speed: number): number {
  const safeSpeed = Number.isFinite(speed) ? Math.max(0.5, Math.min(3, speed)) : 1;
  const hopBonus = Math.min(3000, Math.max(0, segmentCount - 4) * 420);
  return Math.round((6000 + hopBonus) / safeSpeed);
}

function paletteSwatchStyle(palette: ThemePalette): CSSProperties {
  return {
    '--swatch-primary': palette.vars['--palette-primary'],
    '--swatch-secondary': palette.vars['--palette-secondary'],
    '--swatch-surface': palette.vars['--palette-bg-raised']
  } as CSSProperties;
}

function themeModeForMapStyle(profileID: MapStyleProfileID, fallback: 'dark' | 'light'): 'dark' | 'light' {
  const theme = mapStyleProfileByID(profileID).theme;
  return theme === 'light' ? 'light' : theme === 'dark' || theme === 'noc' || theme === 'topo' ? 'dark' : fallback;
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
      <LoadingSpinner size="md" branded decorative className="node-loading-spinner" />
      <span>
        <strong>{title}</strong>
        <em>{message}</em>
      </span>
    </div>
  );
}
