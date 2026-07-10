import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, CloudSun, Columns3, Eye, EyeOff, History, List, MessageSquareText, Monitor, Moon, MoreHorizontal, Palette, Pause, Play, RadioTower, RotateCcw, Route, Search, Share2, SlidersHorizontal, Sparkles, Sun, X } from 'lucide-react';
import { fetchPublicBootstrap, fetchPublicEvents, fetchPublicHistory, fetchPublicHistorySummary, fetchPublicPackets, fetchPublicPropagation, fetchPublicState, fetchPublicStateWithFallback, type PublicStateFetchResult } from './api';
import { recoverPublicEventPages } from './eventRecovery';
import { connectPublicSocket } from './ws';
import {
  applyPublicEnvelope,
  applyPublicEvent,
  emptyState,
  filterNodes,
  filterRoutes,
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
import VcrBar, { MiniLiveClock } from './components/VcrBar';
import ChromePanel from './components/ChromePanel';
import { lazyWithReload } from './lazyWithReload';
const PacketsPanel = lazyWithReload(() => import('./components/PacketsPanel'), 'PacketsPanel');
const NetGraphPanel = lazyWithReload(() => import('./components/NetGraphPanel'), 'NetGraphPanel');
const ChatPanel = lazyWithReload(() => import('./components/ChatPanel'), 'ChatPanel');
const LabPanel = lazyWithReload(() => import('./components/LabPanel'), 'LabPanel');
const SetupPanel = lazyWithReload(() => import('./components/SetupPanel'), 'SetupPanel');
const CommandPalette = lazyWithReload(() => import('./components/CommandPalette'), 'CommandPalette');
const RFReplayStudio = lazyWithReload(() => import('./components/RFReplayStudio'), 'RFReplayStudio');
import MapSettingsDrawer from './components/MapSettingsDrawer';
import RouteGifExportButton, { type RouteGifExportStatus } from './components/RouteGifExportButton';
import { ToastProvider, useToasts } from './components/ToastProvider';
import type { WorkspacePresentation } from './components/workspacePanel';
import { DEFAULT_LAB_EXPERIMENT_ID, canonicalLabHash, labExperimentIDFromHash, labExperimentPath, type LabExperimentID } from './lab';
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
import { capLiveEnvelopeQueue, liveEnvelopeDisplayAt, nextLiveEnvelopeDelayMs, sortLiveEnvelopes, takeDueLiveEnvelopes } from './livePacing';
import {
  historyEventsToLiveEnvelopes,
  historyFetchWindowFromScrub,
  nextVcrSpeed,
  playbackDelayMs,
  shouldApplyPlaybackGeneration,
  VCR_SCOPE_OPTIONS,
  type VcrMode,
  type VcrSpeed
} from './vcr';
import {
  buildConnectivityGraph,
  directConnectivity,
  highlightedPathForTarget,
  phonebookGroupsForNode,
  shortestPathBetween
} from './connectivity';
import { boundsFromPoints, meshcorePathCopyText, messageHistoryForNode, routeNodeIDs, routesInBounds, type MapPoint } from './routeTools';
import { dedupePackets } from './lib/dedupePackets';
import { useDebouncedValue } from './lib/useDebouncedValue';
import { packetNodeIDs, packetRouteIDs, packetToPulse } from './packets';
import { downloadRouteGifBlob, routeGifAnimationDurationMs, type RouteMapGifExportRequest } from './routeGifExport';
import {
  clearSelection as clearSelectionState,
  selectNodeSelection,
  selectPathTargetSelection,
  selectRouteSelection,
  type SelectionState
} from './selection';
import { buildSharedViewURL, parseSharedView, type MapViewState } from './shareView';
import { resolveReplayDeepLink, routeToReplayPacket } from './replayStudio';
import type { DashboardAction } from './uiActions';
import { SERVICE_WORKER_UPDATE_EVENT, activateWaitingServiceWorker, waitingServiceWorkerUpdateAvailable } from './serviceWorker';
import { useAccessibleDialog } from './lib/useAccessibleDialog';
import { bootstrapToLiveState, publicStateSnapshotIsCurrent, startBootstrapFirstHydration } from './bootstrapHydration';
import type { ReplayExportSurfaceProvider } from './replayExportSurface';
import { installResumeRecovery } from './resumeRecovery';
import { recordLivePendingQueueSize, recordSnapshotReplacement, recordVcrReplayQueueSize, recordVisibilityPause } from './perfDiagnostics';
import { appendBufferedRoutePulses, routePulseMessages } from './playbackController';
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
import type { PublicActivity, PublicHistorySummaryBucket, PublicLiveEnvelope, PublicLiveState, PublicMapCluster, PublicMapConfig, PublicPacketPath, PublicPropagationConditions, PublicPropagationEvent, PublicRoute, PublicRoutePulse } from './types';

const NodeListPanel = lazyWithReload(() => import('./components/NodeListPanel'), 'NodeListPanel');
const ShortcutHelp = lazyWithReload(() => import('./components/ShortcutHelp'), 'ShortcutHelp');

interface VcrUiState {
  mode: VcrMode;
  speed: VcrSpeed;
  scopeMs: number;
  missedCount: number;
  scrubAt: number | null;
  clock: number | null;
  status: 'idle' | 'loading' | 'empty' | 'error' | 'lagged';
  summary: PublicHistorySummaryBucket[];
}

const PANEL_MENU_ITEMS: readonly { id: ChromePanelID; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'legend', label: 'Legend' },
  { id: 'hotRoutes', label: 'Busy Pathways' }
] as const;

const VCR_MAX_BUFFERED_COMETS = 4000;
const VCR_MAX_REPLAY_EVENTS = 2000;
const VCR_LASER_MAX_PACKETS = 1600;
const VCR_LASER_PAGE_LIMIT = 1000;
const VCR_LASER_MAX_PAGES = 3;
const PUBLIC_STATE_FALLBACK_POLL_MS = 5_000;
const LIVE_CLOCK_ACTIVE_MS = 1_000;
const LIVE_CLOCK_IDLE_MS = 5_000;
const DERIVED_ACTIVITY_BUCKET_MS = 5_000;
const EMPTY_ROUTE_ACTIVITY = new Map<string, RouteActivitySummary>();
const EMPTY_HOT_ROUTES: PublicRoute[] = [];

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
  const [followTraffic, setFollowTraffic] = useState(false);
  const [query, setQuery] = useState(() => sharedViewRef.current?.q ?? '');
  const [clearToken, setClearToken] = useState(0);
  const [mapAction, setMapAction] = useState<MapAction>(null);
  const [selectedNodeID, setSelectedNodeID] = useState<string | null>(() => sharedViewRef.current?.node ?? null);
  const [selectedRouteID, setSelectedRouteID] = useState<string | null>(() => sharedViewRef.current?.route ?? sharedViewRef.current?.replayRoute ?? null);
  const [selectedPacket, setSelectedPacket] = useState<PublicPacketPath | null>(null);
  const [highlightedPathTargetID, setHighlightedPathTargetID] = useState<string | null>(null);
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
  const [replayStudioOpen, setReplayStudioOpen] = useState(() => sharedViewRef.current?.studio === true);
  const [replayDeepLinkStatus, setReplayDeepLinkStatus] = useState<'pending' | 'resolved' | 'fallback' | 'unavailable' | null>(() => sharedViewRef.current?.studio ? 'pending' : null);
  const [fullStateHydrated, setFullStateHydrated] = useState(false);
  const [serviceWorkerUpdateReady, setServiceWorkerUpdateReady] = useState(false);
  const [serviceWorkerActivating, setServiceWorkerActivating] = useState(false);
  const [mapSettings, setMapSettings] = useState<MapSettings>(() => readStoredMapSettings());
  const [packetsOpen, setPacketsOpen] = useState(() => window.location.hash === '#/packets');
  const [netGraphOpen, setNetGraphOpen] = useState(() => window.location.hash === '#/netgraph');
  const [chatOpen, setChatOpen] = useState(() => window.location.hash === '#/chat');
  const [labOpen, setLabOpen] = useState(() => isLabRoute(window.location.hash));
  const [labExperimentID, setLabExperimentID] = useState<LabExperimentID>(() => isLabRoute(window.location.hash) ? labExperimentIDFromHash(window.location.hash) : DEFAULT_LAB_EXPERIMENT_ID);
  const [setupOpen, setSetupOpen] = useState(() => window.location.hash === '#/setup');
  const [propagationOpen, setPropagationOpen] = useState(false);
  const [propagationEvents, setPropagationEvents] = useState<PublicPropagationEvent[]>([]);
  const [propagationConditions, setPropagationConditions] = useState<PublicPropagationConditions | null>(null);
  const [propagationLoading, setPropagationLoading] = useState(true);
  const [propagationError, setPropagationError] = useState<string | null>(null);
  const [packetsPanelMode, setPacketsPanelMode] = useState<'expanded' | 'compactTray'>('expanded');
  const [workspacePresentation, setWorkspacePresentation] = useState<WorkspacePresentation>('side');
  const [initialLoadGateOpen, setInitialLoadGateOpen] = useState(true);
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
  const [routeGifExport, setRouteGifExport] = useState<{ status: RouteGifExportStatus; progress: number; remainingExports: number; cooldownUntil: number }>({ status: 'idle', progress: 0, remainingExports: 5, cooldownUntil: 0 });
  const [routeWebmExport, setRouteWebmExport] = useState<{ status: 'idle' | 'recording'; progress: number }>({ status: 'idle', progress: 0 });
  const [routeGifExportRequest, setRouteGifExportRequest] = useState<RouteMapGifExportRequest | null>(null);
  const [liveClock, setLiveClock] = useState(() => Date.now());
  const [initialNodesReceived, setInitialNodesReceived] = useState(false);
  const [positionedNodesRendered, setPositionedNodesRendered] = useState(false);
  const [nodeLoadFailed, setNodeLoadFailed] = useState(false);
  const [vcrOpen, setVcrOpen] = useState(false);
  const [laserShowActive, setLaserShowActive] = useState(false);
  const [nodeListOpen, setNodeListOpen] = useState(() => window.location.hash === '#/nodes');
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [chromeVisibility, setChromeVisibility] = useState<ChromeVisibilityState>({
    chromeHidden: false,
    panels: { ...INITIAL_CHROME_PANEL_VISIBILITY }
  });
  const viewportBounds = useViewportBounds();
  const [panelAnchors, setPanelAnchors] = useState<Record<ChromePanelID, ChromePanelAnchor>>({ ...DEFAULT_CHROME_PANEL_ANCHORS });
  const [vcr, setVcr] = useState<VcrUiState>({
    mode: 'live',
    speed: 1,
    scopeMs: VCR_SCOPE_OPTIONS[0].value,
    missedCount: 0,
    scrubAt: null,
    clock: null,
    status: 'idle',
    summary: []
  });
  const closeMobileControls = useCallback(() => setMobileControlsOpen(false), []);
  const mobileControlsRef = useAccessibleDialog<HTMLElement>(mobileControlsOpen, closeMobileControls);
  const actionTokenRef = useRef(0);
  const replayExportProviderRef = useRef<ReplayExportSurfaceProvider | null>(null);
  const gifExportTimestampsRef = useRef<number[]>([]);
  const gifCooldownUntilRef = useRef(0);
  const GIF_EXPORT_MAX_PER_WINDOW = 5;
  const GIF_EXPORT_WINDOW_MS = 10 * 60_000;
  const GIF_EXPORT_COOLDOWN_MS = 30_000;
  const stateRef = useRef<AppState>(emptyState);
  const latestObservedSeqRef = useRef(0);
  const eventRecoveryRef = useRef<((latestSeq?: number) => void) | null>(null);
  const lastSnapshotSignatureRef = useRef('');
  const pendingMessagesRef = useRef<PublicLiveEnvelope[]>([]);
  const vcrBufferedMessagesRef = useRef<PublicLiveEnvelope[]>([]);
  const vcrModeRef = useRef<VcrMode>('live');
  const vcrSpeedRef = useRef<VcrSpeed>(1);
  const vcrGenerationRef = useRef(0);
  const vcrReplayTimerRef = useRef<number | null>(null);
  const flushMessagesTimerRef = useRef<number | null>(null);
  const selectedThemePalette = useMemo(() => themePaletteByID(themePaletteID), [themePaletteID]);
  const resolvedThemeMode = useMemo(() => resolveThemeMode(themeMode), [themeMode]);
  const mapThemeMode = useMemo(() => themeModeForMapStyle(mapSettings.style.profileID, resolvedThemeMode), [mapSettings.style.profileID, resolvedThemeMode]);
  const appThemeStyle = useMemo(() => themeStyleVariables(selectedThemePalette, resolvedThemeMode) as CSSProperties, [selectedThemePalette, resolvedThemeMode]);

  useEffect(() => {
    stateRef.current = state;
    latestObservedSeqRef.current = Math.max(latestObservedSeqRef.current, state.latestSeq);
  }, [state]);

  const applyPublicSnapshot = useCallback((liveState: PublicLiveState): boolean => {
    if (!publicStateSnapshotIsCurrent(Math.max(stateRef.current.latestSeq, latestObservedSeqRef.current), liveState)) {
      recordSnapshotReplacement(true);
      return false;
    }
    const signature = publicLiveStateSignature(liveState);
    if (signature === lastSnapshotSignatureRef.current) {
      recordSnapshotReplacement(true);
      return false;
    }
    lastSnapshotSignatureRef.current = signature;
    latestObservedSeqRef.current = Math.max(latestObservedSeqRef.current, liveState.stats?.latestSeq ?? 0);
    setState(initialAppState(liveState));
    recordSnapshotReplacement(false);
    return true;
  }, []);

  useEffect(() => {
    const updateRoute = () => {
      let hash = window.location.hash;
      if (hash === '#/perf') {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        hash = '';
      }
      const canonicalLabRoute = canonicalLabHash(hash);
      if (canonicalLabRoute && hash !== canonicalLabRoute) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${canonicalLabRoute}`);
        hash = canonicalLabRoute;
      }
      const nextPacketsOpen = hash === '#/packets';
      const nextNetGraphOpen = hash === '#/netgraph';
      const nextChatOpen = hash === '#/chat';
      const nextLabOpen = isLabRoute(hash);
      const nextSetupOpen = hash === '#/setup';
      const nextNodeListOpen = hash === '#/nodes';
      setPacketsOpen(nextPacketsOpen);
      setNetGraphOpen(nextNetGraphOpen);
      setChatOpen(nextChatOpen);
      setLabOpen(nextLabOpen);
      setLabExperimentID(nextLabOpen ? labExperimentIDFromHash(hash) : DEFAULT_LAB_EXPERIMENT_ID);
      setSetupOpen(nextSetupOpen);
      setNodeListOpen(nextNodeListOpen);
      if (nextLabOpen || nextNodeListOpen) {
        setWorkspacePresentation('fullscreen');
      } else if (nextPacketsOpen || nextChatOpen) {
        setWorkspacePresentation('side');
      }
      if (nextPacketsOpen || nextNetGraphOpen || nextChatOpen || nextLabOpen || nextSetupOpen || nextNodeListOpen) {
        setPaletteMenuOpen(false);
        setPanelsMenuOpen(false);
        setMapSettingsOpen(false);
        setMobileControlsOpen(false);
      }
      if (nextPacketsOpen) {
        setPacketsPanelMode('expanded');
      }
    };
    updateRoute();
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  const closePackets = useCallback(() => {
    if (window.location.hash === '#/packets') {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    if (packetsPanelMode === 'compactTray') setPaused(false);
    setPacketsOpen(false);
    setPacketsPanelMode('expanded');
  }, [packetsPanelMode]);

  const closeNetGraph = useCallback(() => {
    if (window.location.hash === '#/netgraph') {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setNetGraphOpen(false);
  }, []);

  const closeChat = useCallback(() => {
    if (window.location.hash === '#/chat') {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setChatOpen(false);
  }, []);

  const closeLab = useCallback(() => {
    if (isLabRoute(window.location.hash)) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setLabOpen(false);
    setLabExperimentID(DEFAULT_LAB_EXPERIMENT_ID);
  }, []);

  const selectLabExperiment = useCallback((experimentID: LabExperimentID) => {
    window.location.hash = labExperimentPath(experimentID);
  }, []);

  const closeSetup = useCallback(() => {
    if (window.location.hash === '#/setup') {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setSetupOpen(false);
  }, []);

  const openNodeList = useCallback(() => {
    window.location.hash = '#/nodes';
  }, []);

  const closeNodeList = useCallback(() => {
    if (window.location.hash === '#/nodes') {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setNodeListOpen(false);
  }, []);

  const openMapHome = useCallback(() => {
    if (window.location.hash) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setPacketsOpen(false);
    setNetGraphOpen(false);
    setChatOpen(false);
    setLabOpen(false);
    setSetupOpen(false);
    setNodeListOpen(false);
    setPropagationOpen(false);
    setVcrOpen(false);
    setShortcutHelpOpen(false);
    setMapSettingsOpen(false);
    setMobileControlsOpen(false);
    setCommandPaletteOpen(false);
    setReplayStudioOpen(false);
    setPacketsPanelMode('expanded');
  }, []);

  const openPackets = useCallback(() => {
    window.location.hash = '#/packets';
  }, []);

  const openChat = useCallback(() => {
    window.location.hash = '#/chat';
  }, []);

  useEffect(() => {
    writeStoredMapSettings(mapSettings);
  }, [mapSettings]);

  useLayoutEffect(() => {
    vcrModeRef.current = vcr.mode;
    vcrSpeedRef.current = vcr.speed;
  }, [vcr.mode, vcr.speed]);

  useEffect(() => {
    setRouteGifExport((current) => (current.status === 'rendering' ? current : { ...current, status: 'idle', progress: 0 }));
  }, [selectedPacket?.id]);

  const clearPendingLiveFlush = useCallback(() => {
    if (flushMessagesTimerRef.current !== null) {
      window.clearTimeout(flushMessagesTimerRef.current);
      flushMessagesTimerRef.current = null;
    }
  }, []);

  const bufferVcrMessage = useCallback((message: PublicLiveEnvelope) => {
    const next = appendBufferedRoutePulses(vcrBufferedMessagesRef.current, message, VCR_MAX_BUFFERED_COMETS);
    if (next === vcrBufferedMessagesRef.current) return;
    vcrBufferedMessagesRef.current = next;
    recordVcrReplayQueueSize(vcrBufferedMessagesRef.current.length);
    setVcr((current) => ({
      ...current,
      missedCount: vcrBufferedMessagesRef.current.length,
      clock: current.clock ?? liveEnvelopeDisplayAt(message)
    }));
  }, []);

  const movePendingLiveToVcrBuffer = useCallback(() => {
    clearPendingLiveFlush();
    if (pendingMessagesRef.current.length === 0) return;
    const routedPending = routePulseMessages(pendingMessagesRef.current);
    if (routedPending.length === 0) {
      pendingMessagesRef.current = [];
      recordLivePendingQueueSize(0);
      return;
    }
    vcrBufferedMessagesRef.current = appendBufferedRoutePulses(vcrBufferedMessagesRef.current, routedPending, VCR_MAX_BUFFERED_COMETS);
    recordVcrReplayQueueSize(vcrBufferedMessagesRef.current.length);
    pendingMessagesRef.current = [];
    recordLivePendingQueueSize(0);
    setVcr((current) => ({
      ...current,
      missedCount: vcrBufferedMessagesRef.current.length,
      clock: current.clock ?? liveEnvelopeDisplayAt(vcrBufferedMessagesRef.current[0])
    }));
  }, [clearPendingLiveFlush]);

  const stopReplay = useCallback(() => {
    vcrGenerationRef.current += 1;
    setLaserShowActive(false);
    if (vcrReplayTimerRef.current !== null) {
      window.clearTimeout(vcrReplayTimerRef.current);
      vcrReplayTimerRef.current = null;
    }
    pendingMessagesRef.current = [];
    vcrBufferedMessagesRef.current = [];
    recordVcrReplayQueueSize(0);
  }, []);

  const refreshLiveSnapshot = useCallback(() => {
    return fetchPublicState()
      .then((liveState) => {
        if (vcrModeRef.current !== 'live') return;
        setFullStateHydrated(true);
        if (!applyPublicSnapshot(liveState)) return;
        setPublicMapConfig(liveState.map ?? null);
        if ((liveState.nodes?.length ?? 0) > 0) {
          setInitialNodesReceived(true);
          setNodeLoadFailed(false);
        }
      })
      .catch(() => {
        setSocketStatus('state-error');
        if (!initialNodesReceived) setNodeLoadFailed(true);
      });
  }, [applyPublicSnapshot, initialNodesReceived]);

  const returnToLive = useCallback(() => {
    stopReplay();
    clearPendingLiveFlush();
    setVcr((current) => ({ ...current, mode: 'live', missedCount: 0, scrubAt: null, clock: null, status: 'idle' }));
    refreshLiveSnapshot();
  }, [clearPendingLiveFlush, refreshLiveSnapshot, stopReplay]);

  const pausePlayback = useCallback(() => {
    const now = Date.now();
    if (vcrModeRef.current === 'live') {
      movePendingLiveToVcrBuffer();
    }
    stopReplay();
    setVcr((current) => ({
      ...current,
      mode: 'paused',
      scrubAt: current.scrubAt ?? current.clock ?? now,
      clock: current.clock ?? now,
      status: 'idle'
    }));
  }, [movePendingLiveToVcrBuffer, stopReplay]);

  const playReplayEnvelopes = useCallback((inputMessages: PublicLiveEnvelope[], generation: number, doneMode: 'live' | 'paused', onDone?: () => void) => {
    const messages = inputMessages.slice(0, VCR_MAX_REPLAY_EVENTS);
    recordVcrReplayQueueSize(messages.length);
    let index = 0;
    const runNext = () => {
      if (!shouldApplyPlaybackGeneration(vcrGenerationRef.current, generation)) return;
      const message = messages[index];
      if (!message) {
        vcrReplayTimerRef.current = null;
        if (doneMode === 'live') {
          recordVcrReplayQueueSize(0);
          onDone?.();
          returnToLive();
        } else {
          recordVcrReplayQueueSize(vcrBufferedMessagesRef.current.length);
          setVcr((current) => ({
            ...current,
            mode: 'paused',
            missedCount: vcrBufferedMessagesRef.current.length,
            status: current.status === 'loading' ? 'idle' : current.status
          }));
          onDone?.();
        }
        return;
      }
      setState((current) => applyPublicEnvelope(current, message));
      const currentAt = replayEnvelopeClockAt(message);
      setVcr((current) => ({ ...current, mode: 'replay', clock: currentAt, scrubAt: currentAt, status: 'idle' }));
      index += 1;
      recordVcrReplayQueueSize(Math.max(0, messages.length - index));
      const nextMessage = messages[index];
      if (!nextMessage) {
        vcrReplayTimerRef.current = window.setTimeout(runNext, 260);
        return;
      }
      vcrReplayTimerRef.current = window.setTimeout(runNext, playbackDelayMs(currentAt, replayEnvelopeClockAt(nextMessage), vcrSpeedRef.current));
    };
    runNext();
  }, [returnToLive]);

  const replayMissed = useCallback(() => {
    const messages = sortLiveEnvelopes(vcrBufferedMessagesRef.current);
    if (messages.length === 0) {
      setVcr((current) => ({ ...current, mode: 'paused', status: 'empty' }));
      return;
    }
    stopReplay();
    setPaused(false);
    setClearToken((value) => value + 1);
    vcrBufferedMessagesRef.current = [];
    recordVcrReplayQueueSize(0);
    const generation = vcrGenerationRef.current + 1;
    vcrGenerationRef.current = generation;
    setVcr((current) => ({
      ...current,
      mode: 'replay',
      missedCount: 0,
      status: 'idle',
      clock: liveEnvelopeDisplayAt(messages[0]),
      scrubAt: liveEnvelopeDisplayAt(messages[0])
    }));
    playReplayEnvelopes(messages, generation, 'live');
  }, [playReplayEnvelopes, stopReplay]);

  const replayFromScrub = useCallback(() => {
    const selected = vcr.scrubAt ?? vcr.clock ?? Math.max(liveClock, state.serverTime, Date.now());
    const { from, to } = historyFetchWindowFromScrub(selected, Date.now());
    stopReplay();
    setPaused(false);
    setClearToken((value) => value + 1);
    const generation = vcrGenerationRef.current + 1;
    vcrGenerationRef.current = generation;
    setVcr((current) => ({ ...current, mode: 'replay', status: 'loading', clock: selected, scrubAt: selected }));
    fetchPublicHistory({ from, to, limit: VCR_MAX_REPLAY_EVENTS })
      .then((history) => {
        if (!shouldApplyPlaybackGeneration(vcrGenerationRef.current, generation)) return;
        const routedEvents = history.events.filter((event) => event.type === 'routePulse');
        if (routedEvents.length === 0) {
          setVcr((current) => ({ ...current, mode: 'paused', status: 'empty', clock: selected, scrubAt: selected }));
          return;
        }
        playReplayEnvelopes(historyEventsToLiveEnvelopes(routedEvents, Date.now()), generation, 'paused');
      })
      .catch(() => {
        if (!shouldApplyPlaybackGeneration(vcrGenerationRef.current, generation)) return;
        setVcr((current) => ({ ...current, mode: 'paused', status: 'error', clock: selected, scrubAt: selected }));
      });
  }, [liveClock, playReplayEnvelopes, state.serverTime, stopReplay, vcr.clock, vcr.scrubAt]);

  const startLaserShow = useCallback(() => {
    stopReplay();
    clearPendingLiveFlush();
    setPaused(false);
    setClearToken((value) => value + 1);
    const generation = vcrGenerationRef.current + 1;
    vcrGenerationRef.current = generation;
    const now = Date.now();
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    setLaserShowActive(true);
    setVcr((current) => ({ ...current, mode: 'replay', status: 'loading', clock: from.getTime(), scrubAt: from.getTime(), missedCount: 0 }));

    const load = async () => {
      let cursor: string | undefined;
      let page = 0;
      const packets: PublicPacketPath[] = [];
      while (page < VCR_LASER_MAX_PAGES && packets.length < VCR_LASER_MAX_PACKETS) {
        const response = await fetchPublicPackets({
          from: from.getTime(),
          to: now,
          limit: VCR_LASER_PAGE_LIMIT,
          cursor
        });
        packets.push(...response.packets);
        cursor = response.nextCursor;
        page += 1;
        if (!cursor) break;
      }
      if (!shouldApplyPlaybackGeneration(vcrGenerationRef.current, generation)) return;
      const unique = dedupePackets(packets)
        .sort((a, b) => a.at - b.at)
        .slice(-VCR_LASER_MAX_PACKETS);
      if (unique.length === 0) {
        setLaserShowActive(false);
        setVcr((current) => ({ ...current, mode: 'paused', status: 'empty', clock: from.getTime(), scrubAt: from.getTime() }));
        return;
      }
      const startedAt = Date.now();
      const spacing = Math.max(24, Math.round(54 / Math.max(0.5, vcrSpeedRef.current)));
      const envelopes = unique.map((packet, index) => {
        const pulse = packetToPulse(packet, startedAt + index * spacing, {
          force: true,
          travelDurationMs: Math.max(900, Math.round(1800 / Math.max(0.5, vcrSpeedRef.current))),
          brightness: Math.min(1.75, mapSettings.packets.brightness * 1.2),
          trailScale: Math.min(2.2, mapSettings.packets.trail * 1.15),
          animationStyle: mapSettings.packets.animationStyle
        });
        return {
          v: 1,
          type: 'event',
          event: 'routePulse',
          seq: index + 1,
          serverTime: packet.at,
          receivedAt: packet.at,
          displayAt: startedAt + index * spacing,
          data: pulse
        } satisfies PublicLiveEnvelope;
      });
      playReplayEnvelopes(envelopes, generation, 'paused', () => setLaserShowActive(false));
    };

    load().catch(() => {
      if (!shouldApplyPlaybackGeneration(vcrGenerationRef.current, generation)) return;
      setLaserShowActive(false);
      setVcr((current) => ({ ...current, mode: 'paused', status: 'error', clock: from.getTime(), scrubAt: from.getTime() }));
    });
  }, [clearPendingLiveFlush, mapSettings.packets, playReplayEnvelopes, stopReplay]);

  const scrubTimeline = useCallback((timestamp: number) => {
    stopReplay();
    if (vcrModeRef.current === 'live') {
      movePendingLiveToVcrBuffer();
    }
    setPaused(false);
    setVcr((current) => ({ ...current, mode: 'paused', scrubAt: timestamp, clock: timestamp, status: 'idle' }));
  }, [movePendingLiveToVcrBuffer, stopReplay]);

  const rewindFifteenMinutes = useCallback(() => {
    const now = Math.max(liveClock, state.serverTime, Date.now());
    scrubTimeline(Math.max(0, (vcr.scrubAt ?? vcr.clock ?? now) - 15 * 60_000));
  }, [liveClock, scrubTimeline, state.serverTime, vcr.clock, vcr.scrubAt]);

  const cycleVcrSpeed = useCallback(() => {
    setVcr((current) => ({ ...current, speed: nextVcrSpeed(current.speed) }));
  }, []);

  const setVcrScope = useCallback((scopeMs: number) => {
    setVcr((current) => ({ ...current, scopeMs }));
  }, []);

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
    const applyFullState = (result: PublicStateFetchResult) => {
      if (cancelled) return;
      setFullStateHydrated(true);
      const liveState = result.state;
      if (!applyPublicSnapshot(liveState)) return;
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
        if (cancelled) return;
        setSocketStatus('state-error');
        setNodeLoadFailed(true);
      }
    }).catch(() => {
      if (cancelled) return;
      setSocketStatus('state-error');
      setNodeLoadFailed(true);
    });
    return () => {
      cancelled = true;
      cancelDeferredState();
    };
  }, [applyPublicSnapshot]);

  useEffect(() => {
    let active = true;
    let recoveryInFlight = false;
    let queuedRecoveryTarget = 0;
    let queuedRecoveryPoll = false;
    const scheduleMessagesFlush = () => {
      if (flushMessagesTimerRef.current !== null) return;
      const delay = nextLiveEnvelopeDelayMs(pendingMessagesRef.current, Date.now());
      if (delay === null) return;
      flushMessagesTimerRef.current = window.setTimeout(flushMessages, delay);
    };
    const flushMessages = () => {
      flushMessagesTimerRef.current = null;
      if (!active || vcrModeRef.current !== 'live' || pendingMessagesRef.current.length === 0) return;
      const { due, pending } = takeDueLiveEnvelopes(pendingMessagesRef.current, Date.now());
      pendingMessagesRef.current = pending;
      if (due.length > 0) {
        setState((current) => due.reduce((next, message) => applyPublicEnvelope(next, message), current));
      }
      recordLivePendingQueueSize(pendingMessagesRef.current.length);
      if (pendingMessagesRef.current.length > 0) scheduleMessagesFlush();
    };
    const enqueueMessage = (message: PublicLiveEnvelope) => {
      if (message.type !== 'event') return;
      if (vcrModeRef.current !== 'live') {
        bufferVcrMessage(message);
        return;
      }
      pendingMessagesRef.current = capLiveEnvelopeQueue([...pendingMessagesRef.current, message]);
      recordLivePendingQueueSize(pendingMessagesRef.current.length);
      scheduleMessagesFlush();
    };
    const refreshState = () => {
      if (vcrModeRef.current !== 'live') return;
      fetchPublicState().then((liveState) => {
        if (!active) return;
        if (vcrModeRef.current !== 'live') return;
        setFullStateHydrated(true);
        if (!applyPublicSnapshot(liveState)) return;
        setPublicMapConfig(liveState.map ?? null);
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
    const backfillOrRefresh = (latestSeq?: number) => {
      if (vcrModeRef.current !== 'live') return;
      if (latestSeq !== undefined && Number.isFinite(latestSeq)) {
        queuedRecoveryTarget = Math.max(queuedRecoveryTarget, Math.floor(latestSeq));
      } else {
        queuedRecoveryPoll = true;
      }
      if (recoveryInFlight) return;
      recoveryInFlight = true;

      const recover = async () => {
        while (active && vcrModeRef.current === 'live' && (queuedRecoveryPoll || queuedRecoveryTarget > stateRef.current.latestSeq)) {
          const requestedTarget = queuedRecoveryTarget > 0 ? queuedRecoveryTarget : undefined;
          queuedRecoveryTarget = 0;
          queuedRecoveryPoll = false;
          const result = await recoverPublicEventPages({
            afterSeq: stateRef.current.latestSeq,
            targetSeq: requestedTarget,
            fetchPage: (afterSeq, limit) => fetchPublicEvents({ afterSeq, limit }),
            applyPage: (events) => {
              if (!active || vcrModeRef.current !== 'live') return;
              setState((current) => events.reduce((next, event) => applyPublicEvent(next, event), current));
            },
            isActive: () => active && vcrModeRef.current === 'live'
          });
          latestObservedSeqRef.current = Math.max(latestObservedSeqRef.current, result.latestSeq);
          if (result.status === 'reset-required' || result.status === 'unrecoverable-gap') {
            refreshState();
            return;
          }
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

      void recover()
        .catch(() => {
          // Transient transport failures stay on cursor polling. A complete
          // snapshot is reserved for a server-declared reset or proven gap.
          if (active) setSocketStatus((current) => (current === 'live' ? current : 'polling'));
        })
        .finally(() => {
          recoveryInFlight = false;
          if (active && (queuedRecoveryPoll || queuedRecoveryTarget > stateRef.current.latestSeq)) {
            backfillOrRefresh(queuedRecoveryTarget || undefined);
          }
        });
    };
    eventRecoveryRef.current = backfillOrRefresh;
    const socket = connectPublicSocket((message) => {
      latestObservedSeqRef.current = Math.max(latestObservedSeqRef.current, message.latestSeq ?? message.seq ?? 0);
      if (message.type === 'hello') {
        setState((current) => applyPublicEnvelope(current, message));
        backfillOrRefresh(message.latestSeq ?? message.seq);
        return;
      }
      if (message.type === 'pong') {
        setState((current) => applyPublicEnvelope(current, message));
        return;
      }
      if (message.type === 'lagged') {
        pendingMessagesRef.current = [];
        recordLivePendingQueueSize(0);
        if (flushMessagesTimerRef.current !== null) {
          window.clearTimeout(flushMessagesTimerRef.current);
          flushMessagesTimerRef.current = null;
        }
        if (vcrModeRef.current !== 'live') {
          setVcr((current) => ({ ...current, status: 'lagged' }));
          return;
        }
        setState((current) => applyPublicEnvelope(current, message));
        backfillOrRefresh(message.latestSeq ?? message.toSeq ?? message.seq);
        return;
      }
      enqueueMessage(message);
    }, setSocketStatus);
    return () => {
      active = false;
      if (eventRecoveryRef.current === backfillOrRefresh) eventRecoveryRef.current = null;
      if (flushMessagesTimerRef.current !== null) window.clearTimeout(flushMessagesTimerRef.current);
      flushMessagesTimerRef.current = null;
      pendingMessagesRef.current = [];
      recordLivePendingQueueSize(0);
      socket.close();
    };
  }, [applyPublicSnapshot, bufferVcrMessage, initialNodesReceived]);

  useEffect(() => {
    return installResumeRecovery({
      document,
      window,
      shouldRehydrate: () => vcrModeRef.current === 'live',
      rehydrate: refreshLiveSnapshot,
      onSuspend: recordVisibilityPause
    });
  }, [refreshLiveSnapshot]);

  useEffect(() => {
    if (socketStatus === 'live') return;
    let active = true;
    const recover = () => {
      if (!active || vcrModeRef.current !== 'live') return;
      eventRecoveryRef.current?.();
    };
    recover();
    const interval = window.setInterval(recover, PUBLIC_STATE_FALLBACK_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
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
    const intervalMs = vcrOpen || vcr.mode !== 'live' ? LIVE_CLOCK_ACTIVE_MS : LIVE_CLOCK_IDLE_MS;
    const interval = window.setInterval(() => setLiveClock(Date.now()), intervalMs);
    return () => window.clearInterval(interval);
  }, [vcr.mode, vcrOpen]);

  useEffect(() => {
    if (!vcrOpen) return;
    let active = true;
    const loadSummary = () => {
      const to = Date.now();
      const from = Math.max(0, to - vcr.scopeMs);
      const bucketMs = Math.max(60_000, Math.ceil(vcr.scopeMs / 96));
      fetchPublicHistorySummary({ from, to, bucketMs })
        .then((summary) => {
          if (!active) return;
          setVcr((current) => ({ ...current, summary: summary.buckets }));
        })
        .catch(() => {
          if (!active) return;
          setVcr((current) => ({ ...current, summary: [] }));
        });
    };
    loadSummary();
    const interval = window.setInterval(loadSummary, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [vcr.scopeMs, vcrOpen]);

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

  const debouncedQuery = useDebouncedValue(query, 200);

  const visibleNodes = useMemo(() => filterNodes(state.nodes, debouncedQuery), [state.nodes, debouncedQuery]);
  const visibleNodeIDs = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleRoutes = useMemo(() => filterRoutes(state.routes, visibleNodeIDs, debouncedQuery), [state.routes, visibleNodeIDs, debouncedQuery]);
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
  const activityClock = Math.max(liveClock, state.serverTime, state.activity[0]?.heardAt ?? 0, state.routeTraces.at(-1)?.heardAt ?? 0);
  const activityClockBucket = Math.floor(activityClock / DERIVED_ACTIVITY_BUCKET_MS) * DERIVED_ACTIVITY_BUCKET_MS;
  const chromeHidden = chromeVisibility.chromeHidden;
  const chromePanelsMounted = !vcrOpen && !packetsOpen && !netGraphOpen && !chatOpen && !labOpen && !setupOpen && !propagationOpen;
  const hotRoutesPanelActive = chromePanelsMounted && !chromeHidden && chromeVisibility.panels.hotRoutes;
  const routeActivityByID = useMemo(
    () => hotRoutesPanelActive ? summarizeRouteActivity(state.routeTraces, activityClockBucket) : EMPTY_ROUTE_ACTIVITY,
    [activityClockBucket, hotRoutesPanelActive, state.routeTraces]
  );
  const coverage = useMemo(() => liveCoverageStats(state.activity, activityClockBucket), [state.activity, activityClockBucket]);
  const latestPacketActivity = useMemo(() => state.activity.find(isPacketActivity) ?? null, [state.activity]);
  const vcrPlaybackActive = vcr.mode !== 'live';
  const vcrTimelineNow = Math.max(liveClock, state.serverTime, vcr.clock ?? 0);
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
    setSelectedPacket(null);
    applySelection(clearSelectionState());
  }, [applySelection]);

  const selectNode = useCallback((nodeID: string) => {
    setSelectedPacket(null);
    applySelection(selectNodeSelection(nodeID));
  }, [applySelection]);

  const selectNodeFromList = useCallback((id: string) => {
    selectNode(id);
    closeNodeList();
  }, [closeNodeList, selectNode]);

  const selectRoute = useCallback((routeID: string) => {
    setSelectedPacket(null);
    applySelection(selectRouteSelection(routeID));
    dispatchMapAction('route', routeID);
  }, [applySelection, dispatchMapAction]);

  const selectPhonebookPath = useCallback((nodeID: string) => {
    setSelectedPacket(null);
    applySelection(selectPathTargetSelection({ selectedNodeID, selectedRouteID, highlightedPathTargetID }, nodeID));
  }, [applySelection, highlightedPathTargetID, selectedNodeID, selectedRouteID]);

  const focusPacketPath = useCallback((packet: PublicPacketPath) => {
    setSelectedPacket(packet);
    setPacketsOpen(false);
    setPacketsPanelMode('expanded');
    if (window.location.hash === '#/packets') {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    applySelection(clearSelectionState());
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    setMapAction({ type: 'packet', token, segments: packet.segments });
  }, [applySelection]);

  const replayPacketPath = useCallback((packet: PublicPacketPath, speedOverride?: number, forceCanvas = false) => {
    if (vcrModeRef.current !== 'live') {
      stopReplay();
      clearPendingLiveFlush();
      pendingMessagesRef.current = [];
      vcrBufferedMessagesRef.current = [];
      recordVcrReplayQueueSize(0);
      setVcr((current) => ({ ...current, mode: 'live', missedCount: 0, scrubAt: null, clock: null, status: 'idle' }));
    }
    setPlotMode('off');
    setPlotFirstNodeID(null);
    setPlotAreaFirstPoint(null);
    setFollowTraffic(false);
    setPaused(true);
    setSelectedPacket(packet);
    setPacketsOpen(true);
    setPacketsPanelMode('compactTray');
    if (window.location.hash === '#/packets') {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    applySelection(clearSelectionState());
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
  }, [applySelection, clearPendingLiveFlush, mapSettings.packets, stopReplay]);

  const focusPropagationEvent = useCallback((event: PublicPropagationEvent) => {
    setPropagationOpen(true);
    setPacketsOpen(false);
    setPacketsPanelMode('expanded');
    applySelection(clearSelectionState());
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    setMapAction({ type: 'packet', token, segments: event.segments });
  }, [applySelection]);

  const replayPropagationEvent = useCallback((event: PublicPropagationEvent) => {
    if (vcrModeRef.current !== 'live') {
      stopReplay();
      clearPendingLiveFlush();
      pendingMessagesRef.current = [];
      vcrBufferedMessagesRef.current = [];
      recordVcrReplayQueueSize(0);
      setVcr((current) => ({ ...current, mode: 'live', missedCount: 0, scrubAt: null, clock: null, status: 'idle' }));
    }
    setPlotMode('off');
    setPlotFirstNodeID(null);
    setPlotAreaFirstPoint(null);
    setFollowTraffic(false);
    setPaused(true);
    setPropagationOpen(true);
    setPacketsOpen(false);
    setPacketsPanelMode('expanded');
    applySelection(clearSelectionState());
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
  }, [applySelection, clearPendingLiveFlush, mapSettings.packets, stopReplay]);

  const resumeLiveFromPacketTray = useCallback(() => {
    returnToLive();
    setPaused(false);
    setPacketsPanelMode('expanded');
  }, [returnToLive]);

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

  const openVcr = useCallback(() => {
    clearPlotRoutes();
    setVcrOpen(true);
  }, [clearPlotRoutes]);

  const closeVcr = useCallback(() => {
    clearPlotRoutes();
    returnToLive();
    setVcrOpen(false);
  }, [clearPlotRoutes, returnToLive]);

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
        setPaused((value) => !value);
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
  }, [clearPlotRoutes, clearSelection]);

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
        setRouteGifExport(s => ({ ...s, status: 'error', progress: 0, remainingExports: rem }));
        showToast({ tone: 'error', title: 'GIF export failed', message: 'The map was busy. Try again after it settles.' });
        window.setTimeout(() => {
          setRouteGifExport((current) => (current.status === 'error' ? { ...current, status: 'idle', progress: 0 } : current));
        }, 3600);
      }
    });
  }, [mapSettings.packets, routeGifExport.status, selectedPacket, showToast]);

  const exportReplayWebM = useCallback(async (packet: PublicPacketPath, speed: number) => {
    if (routeWebmExport.status === 'recording') return;
    const provider = replayExportProviderRef.current;
    if (!provider) {
      showToast({ tone: 'warning', title: 'Map not ready', message: 'Wait for the map canvas to finish loading, then record again.' });
      return;
    }
    setRouteWebmExport({ status: 'recording', progress: 0 });
    let surface: Awaited<ReturnType<ReplayExportSurfaceProvider>> | null = null;
    try {
      surface = await provider({ width: 1280, height: 720, segments: packet.segments });
      const { downloadRouteWebM, recordCanvasLayersWebM } = await import('./routeWebmExport');
      const durationMs = Math.min(30_000, cinematicPacketReplayDuration(packet.segmentCount, speed) + 2_000);
      const blob = await recordCanvasLayersWebM(surface.canvases, {
        durationMs,
        frameRate: 30,
        onStarted: () => replayPacketPath(packet, speed, true),
        onProgress: (progress) => setRouteWebmExport({ status: 'recording', progress })
      });
      downloadRouteWebM(packet.id, blob);
      showToast({ tone: 'success', title: 'Route WebM exported', message: 'Recorded locally at up to 720p.' });
    } catch (error) {
      showToast({ tone: 'error', title: 'WebM export unavailable', message: error instanceof Error ? error.message : 'Use GIF export in this browser.' });
    } finally {
      surface?.cleanup();
      setRouteWebmExport({ status: 'idle', progress: 0 });
    }
  }, [replayPacketPath, routeWebmExport.status, showToast]);

  const showRouteGifExport = Boolean(selectedPacket && !replayStudioOpen && !packetsOpen && !netGraphOpen && !chatOpen && !labOpen && !setupOpen && !propagationOpen && !vcrOpen);
  const routeWebmSupported = typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  const activeMapMode = mapModeForSettings(mapSettings);
  const selectMapMode = useCallback((modeID: MapModeID) => {
    setMapSettings((current) => applyMapMode(current, modeID));
    const mode = MAP_MODES.find((item) => item.id === modeID);
    if (mode) showToast({ tone: 'success', title: `${mode.label} mode`, message: mode.hint, durationMs: 1800 });
    setPanelsMenuOpen(false);
    setMobileControlsOpen(false);
  }, [showToast]);
  const followRecentActive = followTraffic && !vcrPlaybackActive;
  const toggleFollowRecent = useCallback(() => {
    if (vcrPlaybackActive) return;
    if (followRecentActive) {
      setFollowTraffic(false);
      showToast({ tone: 'info', title: 'Follow off', message: 'The map will stay where you leave it.', durationMs: 1600 });
      return;
    }
    setFollowTraffic(true);
    dispatchMapAction('latest-route');
    showToast({ tone: 'success', title: 'Following recent activity', message: 'The camera will ease toward fresh routed traffic.', durationMs: 1800 });
  }, [dispatchMapAction, followRecentActive, showToast, vcrPlaybackActive]);
  const replayStudioPacket = useMemo(
    () => selectedPacket ?? (selectedRoute ? routeToReplayPacket(selectedRoute) : null),
    [selectedPacket, selectedRoute]
  );
  useEffect(() => {
    const shared = sharedViewRef.current;
    if (!shared?.studio || replayDeepLinkStatus !== 'pending' || !fullStateHydrated) return;
    const resolution = resolveReplayDeepLink(shared, state.pulses, state.routes);
    setReplayDeepLinkStatus(resolution.status);
    if (resolution.packet) {
      focusPacketPath(resolution.packet);
      return;
    }
    if (resolution.route) {
      selectRoute(resolution.route.id);
      return;
    }
    setSelectedPacket(null);
    setSelectedRouteID(null);
  }, [focusPacketPath, fullStateHydrated, replayDeepLinkStatus, selectRoute, state.pulses, state.routes]);
  const openReplayStudio = useCallback(() => {
    setReplayDeepLinkStatus(null);
    if (!selectedPacket && !selectedRoute) {
      const latest = [...visibleRoutes].sort((a, b) => b.lastHeard - a.lastHeard)[0];
      if (latest) selectRoute(latest.id);
    }
    setReplayStudioOpen(true);
    setPanelsMenuOpen(false);
    setMobileControlsOpen(false);
  }, [selectRoute, selectedPacket, selectedRoute, visibleRoutes]);
  const playReplayStudio = useCallback((packet: PublicPacketPath, speed: number, staticStory: boolean) => {
    if (staticStory) {
      focusPacketPath(packet);
      setPaused(true);
      return;
    }
    replayPacketPath(packet, speed);
  }, [focusPacketPath, replayPacketPath]);
  const pauseReplayStudio = useCallback(() => {
    setPaused(true);
    if (!replayStudioPacket?.segments.length) return;
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    setMapAction({ type: 'packet', token, segments: replayStudioPacket.segments });
  }, [replayStudioPacket]);
  const seekReplayStudio = useCallback((segment: PublicRoutePulse['segments'][number]) => {
    const token = actionTokenRef.current + 1;
    actionTokenRef.current = token;
    setMapAction({ type: 'packet', token, segments: [segment] });
  }, []);
  const shareReplayStudio = useCallback(async (packet: PublicPacketPath) => {
    const view = mapView ?? (sharedViewRef.current ? { lat: sharedViewRef.current.lat, lng: sharedViewRef.current.lng, z: sharedViewRef.current.z } : null);
    if (!view) {
      showToast({ tone: 'warning', title: 'Map view not ready', message: 'Wait for the camera to settle, then share again.' });
      return;
    }
    const routeID = packet.routeIds[0] ?? selectedRouteID;
    const url = buildSharedViewURL(window.location.href, view, {
      route: routeID,
      q: query,
      studio: true,
      replayPacket: packet.id,
      replayRoute: routeID
    });
    try {
      await copyTextToClipboard(url);
      showToast({ tone: 'success', title: 'Replay story link copied', message: 'The link contains sanitized public identifiers only.' });
    } catch {
      showToast({ tone: 'error', title: 'Copy failed', message: 'Clipboard access was blocked by the browser.' });
    }
  }, [mapView, query, selectedRouteID, showToast]);
  const openReplayWaterfall = useCallback(() => {
    setReplayStudioOpen(false);
    window.location.hash = labExperimentPath(DEFAULT_LAB_EXPERIMENT_ID);
  }, []);
  const dashboardActions = useMemo<DashboardAction[]>(() => [
    { id: 'replay-studio', label: 'RF Replay Studio', description: replayStudioPacket ? 'Play the selected public pathway' : 'Play the latest public pathway', group: 'Playback', keywords: ['cinematic', 'route', '3d', 'terrain'], run: openReplayStudio },
    { id: 'timeline', label: 'Live timeline', description: 'Rewind or replay recent public traffic', group: 'Playback', keywords: ['vcr', 'history'], run: openVcr },
    { id: 'packets', label: 'PacketTV', description: 'Browse routed public packets', group: 'Explore', keywords: ['packet', 'traffic'], run: openPackets },
    { id: 'nodes', label: 'Browse nodes', description: 'Search the public node phonebook', group: 'Explore', keywords: ['radio', 'repeater'], run: openNodeList },
    { id: 'waterfall', label: 'Waterfall Labs', description: 'Open the audiovisual public traffic lab', group: 'Explore', keywords: ['lab', 'audio'], run: openReplayWaterfall },
    { id: 'propagation', label: 'Propagation', description: 'Open public RF condition history', group: 'Explore', keywords: ['weather', 'los'], run: () => setPropagationOpen(true) },
    { id: 'map-settings', label: 'Map settings', description: 'Change map mode, layers, and motion', group: 'View', keywords: ['terrain', '3d', 'style'], run: () => setMapSettingsOpen(true) },
    { id: 'share', label: 'Share current view', description: 'Copy a privacy-safe map link', group: 'Utility', keywords: ['link', 'copy'], run: shareView },
    { id: 'pause', label: paused ? 'Resume feed' : 'Pause feed', description: paused ? 'Resume live visual updates' : 'Pause live visual updates', group: 'Playback', run: () => setPaused((value) => !value) },
    { id: 'toggle-ui', label: chromeHidden ? 'Show map UI' : 'Hide map UI', description: 'Toggle map panels and status chrome', group: 'View', run: toggleChromeVisibility }
  ], [chromeHidden, openNodeList, openPackets, openReplayStudio, openReplayWaterfall, openVcr, paused, replayStudioPacket, shareView, toggleChromeVisibility]);
  const knownPathwaysOn = mapSettings.layers.routes;
  const workspaceSurfaceOpen = packetsOpen || netGraphOpen || chatOpen || labOpen || nodeListOpen;
  const visitorGuideSuppressed = chromeHidden || packetsOpen || netGraphOpen || chatOpen || labOpen || setupOpen || propagationOpen || vcrOpen || nodeListOpen || shortcutHelpOpen || mapSettingsOpen || mobileControlsOpen || commandPaletteOpen || replayStudioOpen || Boolean(selectedNode || selectedRoute || selectedPacket);

  return (
    <div
      className="app-shell public-dashboard"
      data-theme-mode={themeMode}
      data-theme-palette={selectedThemePalette.id}
      data-vcr-layout={vcrOpen ? 'open' : 'closed'}
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
        pulses={state.pulses}
        observerBursts={state.observerBursts}
        propagationEvents={propagationEvents}
        paused={paused || vcr.mode === 'paused'}
        followTraffic={followTraffic && !vcrPlaybackActive}
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
        onReplayExportProviderChange={(provider) => { replayExportProviderRef.current = provider; }}
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
          disabled={vcrPlaybackActive}
          title={vcrPlaybackActive ? 'Follow resumes after replay' : followRecentActive ? 'Stop following recent traffic' : 'Follow recent traffic'}
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
        <button className={`operator-action replay-studio-toggle ${replayStudioOpen ? 'active' : ''}`} type="button" aria-pressed={replayStudioOpen} title="Open RF Replay Studio" onClick={openReplayStudio}>
          <Sparkles size={16} />
          <span>Studio</span>
        </button>
        <button className="operator-action command-palette-toggle" type="button" aria-keyshortcuts="Control+K Meta+K" title="Search commands, nodes, and routes (Ctrl/Command K)" onClick={() => setCommandPaletteOpen(true)}>
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
                {dashboardActions.filter((action) => ['replay-studio', 'timeline', 'nodes', 'propagation', 'share'].includes(action.id)).map((action) => (
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
                <button type="button" onClick={() => setPaused((value) => !value)}>
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
          className={`mobile-control-button ${!workspaceSurfaceOpen && !setupOpen && !propagationOpen && !vcrOpen ? 'active' : ''}`}
          type="button"
          aria-current={!workspaceSurfaceOpen && !setupOpen && !propagationOpen && !vcrOpen ? 'page' : undefined}
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
              disabled={vcrPlaybackActive}
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
            {dashboardActions.filter((action) => ['replay-studio', 'timeline', 'map-settings', 'propagation', 'pause', 'share', 'nodes'].includes(action.id)).map((action) => (
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
              onSelectNode={(nodeID) => { selectNode(nodeID); dispatchMapAction('node', nodeID); }}
              onSelectRoute={selectRoute}
              onClose={() => setCommandPaletteOpen(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {replayStudioOpen && (
        <ErrorBoundary fallback={<div className="panel-error">Replay Studio failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}>
          <Suspense fallback={<LoadingSpinner label="Opening RF Replay Studio" />}>
            <RFReplayStudio
              packet={replayStudioPacket}
              deepLinkStatus={replayDeepLinkStatus}
              mode={activeMapMode.id}
              exportBusy={routeGifExport.status === 'rendering'}
              webmSupported={routeWebmSupported}
              webmBusy={routeWebmExport.status === 'recording'}
              onModeChange={selectMapMode}
              onReplay={playReplayStudio}
              onPause={pauseReplayStudio}
              onSeek={seekReplayStudio}
              onShare={shareReplayStudio}
              onExportGif={replayStudioPacket ? () => { void exportSelectedPacketGif(replayStudioPacket); } : undefined}
              onExportWebM={replayStudioPacket ? (speed) => { void exportReplayWebM(replayStudioPacket, speed); } : undefined}
              onOpenWaterfall={openReplayWaterfall}
              onClose={() => setReplayStudioOpen(false)}
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
              presentation={workspacePresentation}
              onClose={closePackets}
              onExpand={() => setPacketsPanelMode('expanded')}
              onPresentationChange={setWorkspacePresentation}
              onResumeLive={resumeLiveFromPacketTray}
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

      {!vcrOpen && !packetsOpen && !netGraphOpen && !chatOpen && !labOpen && !setupOpen && !propagationOpen && (
        <>
          {!chromeHidden && (
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
          <MiniLiveClock timestamp={liveClock} onOpen={openVcr} />
        </>
      )}
      {vcrOpen && (
        <VcrBar
          mode={vcr.mode}
          speed={vcr.speed}
          scopeMs={vcr.scopeMs}
          missedCount={vcr.missedCount}
          timelineNow={vcrTimelineNow}
          clock={vcr.clock}
          scrubAt={vcr.scrubAt}
          status={vcr.status}
          summary={vcr.summary}
          onLive={returnToLive}
          onPause={pausePlayback}
          onReplayMissed={replayMissed}
          onRewind={rewindFifteenMinutes}
          onSpeed={cycleVcrSpeed}
          onScope={setVcrScope}
          onScrub={scrubTimeline}
          onPlayFromScrub={replayFromScrub}
          onLaserShow={startLaserShow}
          onClose={closeVcr}
          laserShowActive={laserShowActive}
        />
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
  if (actionID === 'replay-studio') return <Sparkles size={size} />;
  if (actionID === 'timeline') return <History size={size} />;
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

function replayEnvelopeClockAt(message: PublicLiveEnvelope): number {
  if (message.type === 'event' && (message.event === 'routePulse' || message.event === 'activity')) {
    return message.data.heardAt;
  }
  return liveEnvelopeDisplayAt(message);
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

function isLabRoute(hash: string): boolean {
  return hash === '#/lab' || hash.startsWith('#/lab/');
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
