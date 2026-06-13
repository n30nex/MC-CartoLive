import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, CloudSun, Columns3, Eye, EyeOff, History, LocateFixed, Monitor, Moon, MoreHorizontal, Palette, Pause, Play, RadioTower, RotateCcw, Route, Search, Share2, SlidersHorizontal, Sun, X } from 'lucide-react';
import { fetchPublicEvents, fetchPublicHistory, fetchPublicHistorySummary, fetchPublicPackets, fetchPublicPropagation, fetchPublicState } from './api';
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
  summarizeRouteActivity,
  type AppState,
  type RouteActivitySummary
} from './state';
import CanadaMap, { type MapAction } from './map/CanadaMap';
import ErrorBoundary from './components/ErrorBoundary';
import PanelSkeleton from './components/PanelSkeleton';
import HotRoutes from './components/HotRoutes';
import Legend from './components/Legend';
import LinkBar from './components/LinkBar';
import PlotRoutesPanel, { type PlotMode, type PlotResult } from './components/PlotRoutesPanel';
import SelectionDrawer from './components/SelectionDrawer';
import StatusBar from './components/StatusBar';
import NocSummary from './components/NocSummary';
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
import MapSettingsDrawer from './components/MapSettingsDrawer';
import RouteGifExportButton, { type RouteGifExportStatus } from './components/RouteGifExportButton';
import type { WorkspacePresentation } from './components/workspacePanel';
import { DEFAULT_LAB_EXPERIMENT_ID, labExperimentIDFromHash, labExperimentPath, type LabExperimentID } from './lab';
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
import { recordLivePendingQueueSize, recordVcrReplayQueueSize, recordVisibilityPause } from './perfDiagnostics';
import { appendBufferedRoutePulses, routePulseMessages } from './playbackController';
import { normalizeMapSettings, readStoredMapSettings, writeStoredMapSettings, type MapSettings } from './mapSettings';
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
import type { PublicActivity, PublicHistorySummaryBucket, PublicLiveEnvelope, PublicMapConfig, PublicPacketPath, PublicPropagationConditions, PublicPropagationEvent, PublicRoute, PublicRoutePulse } from './types';

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
const PUBLIC_STATE_FALLBACK_POLL_MS = 3_500;
const LIVE_CLOCK_ACTIVE_MS = 1_000;
const LIVE_CLOCK_IDLE_MS = 5_000;
const DERIVED_ACTIVITY_BUCKET_MS = 5_000;
const EMPTY_ROUTE_ACTIVITY = new Map<string, RouteActivitySummary>();
const EMPTY_HOT_ROUTES: PublicRoute[] = [];

export default function App() {
  const sharedViewRef = useRef(parseSharedView(window.location.search));
  const [state, setState] = useState<AppState>(emptyState);
  const [publicMapConfig, setPublicMapConfig] = useState<PublicMapConfig | null>(null);
  const [socketStatus, setSocketStatus] = useState('starting');
  const [paused, setPaused] = useState(false);
  const [followTraffic, setFollowTraffic] = useState(false);
  const [query, setQuery] = useState(() => sharedViewRef.current?.q ?? '');
  const [clearToken, setClearToken] = useState(0);
  const [mapAction, setMapAction] = useState<MapAction>(null);
  const [selectedNodeID, setSelectedNodeID] = useState<string | null>(() => sharedViewRef.current?.node ?? null);
  const [selectedRouteID, setSelectedRouteID] = useState<string | null>(() => sharedViewRef.current?.route ?? null);
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
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
  const [routeGifExport, setRouteGifExport] = useState<{ status: RouteGifExportStatus; progress: number; remainingExports: number; cooldownUntil: number }>({ status: 'idle', progress: 0, remainingExports: 5, cooldownUntil: 0 });
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
  const actionTokenRef = useRef(0);
  const gifExportTimestampsRef = useRef<number[]>([]);
  const gifCooldownUntilRef = useRef(0);
  const GIF_EXPORT_MAX_PER_WINDOW = 5;
  const GIF_EXPORT_WINDOW_MS = 10 * 60_000;
  const GIF_EXPORT_COOLDOWN_MS = 30_000;
  const stateRef = useRef<AppState>(emptyState);
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
  }, [state]);

  useEffect(() => {
    const updateRoute = () => {
      let hash = window.location.hash;
      if (hash === '#/perf') {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        hash = '';
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
    fetchPublicState()
      .then((liveState) => {
        if (vcrModeRef.current !== 'live') return;
        setPublicMapConfig(liveState.map ?? null);
        setState(initialAppState(liveState));
        if ((liveState.nodes?.length ?? 0) > 0) {
          setInitialNodesReceived(true);
          setNodeLoadFailed(false);
        }
      })
      .catch(() => {
        setSocketStatus('state-error');
        if (!initialNodesReceived) setNodeLoadFailed(true);
      });
  }, [initialNodesReceived]);

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
    if (initialNodesReceived) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    const loadState = () => {
      fetchPublicState()
        .then((liveState) => {
          if (cancelled) return;
          setPublicMapConfig(liveState.map ?? null);
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
        setPublicMapConfig(liveState.map ?? null);
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
    const backfillOrRefresh = (latestSeq?: number) => {
      if (vcrModeRef.current !== 'live') return;
      const afterSeq = stateRef.current.latestSeq;
      if (!latestSeq || latestSeq <= afterSeq) {
        setState((current) => applyPublicEnvelope(current, { v: 1, type: 'hello', seq: latestSeq, latestSeq, serverTime: Date.now(), connectionId: 'resume' }));
        return;
      }
      fetchPublicEvents({ afterSeq, limit: 1000 })
        .then((response) => {
          if (!active || vcrModeRef.current !== 'live') return;
          if (response.events.length === 0 && response.latestSeq > afterSeq) {
            refreshState();
            return;
          }
          setState((current) => response.events.reduce((next, event) => applyPublicEvent(next, event), current));
          setSocketStatus('live');
        })
        .catch(() => {
          if (!active) return;
          refreshState();
        });
    };
    const socket = connectPublicSocket((message) => {
      if (message.type === 'hello') {
        setState((current) => applyPublicEnvelope(current, message));
        if (openedOnce) backfillOrRefresh(message.latestSeq ?? message.seq);
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
    }, setSocketStatus, () => {
      openedOnce = true;
    });
    return () => {
      active = false;
      if (flushMessagesTimerRef.current !== null) window.clearTimeout(flushMessagesTimerRef.current);
      flushMessagesTimerRef.current = null;
      pendingMessagesRef.current = [];
      recordLivePendingQueueSize(0);
      socket.close();
    };
  }, [bufferVcrMessage, initialNodesReceived]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        recordVisibilityPause();
      } else if (vcrModeRef.current === 'live') {
        refreshLiveSnapshot();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [refreshLiveSnapshot]);

  useEffect(() => {
    if (socketStatus === 'live') return;
    let active = true;
    let inFlight = false;
    const refresh = () => {
      if (vcrModeRef.current !== 'live') return;
      if (inFlight) return;
      inFlight = true;
      fetchPublicState()
        .then((liveState) => {
          if (!active) return;
          if (vcrModeRef.current !== 'live') return;
          setPublicMapConfig(liveState.map ?? null);
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
    const interval = window.setInterval(refresh, PUBLIC_STATE_FALLBACK_POLL_MS);
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

  const replayPacketPath = useCallback((packet: PublicPacketPath) => {
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
    const travelDurationMs = cinematicPacketReplayDuration(packet.segmentCount, mapSettings.packets.speed);
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
      travelDurationMs
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

  const toggleKnownPathways = useCallback(() => {
    setMapSettings((current) => normalizeMapSettings({
      ...current,
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
    const handleKeyDown = (event: KeyboardEvent) => {
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

  const exportSelectedPacketGif = useCallback(async () => {
    if (!selectedPacket || routeGifExport.status === 'rendering') return;
    const now = Date.now();
    if (now < gifCooldownUntilRef.current) return;
    const windowStart = now - GIF_EXPORT_WINDOW_MS;
    gifExportTimestampsRef.current = gifExportTimestampsRef.current.filter(t => t > windowStart);
    if (gifExportTimestampsRef.current.length >= GIF_EXPORT_MAX_PER_WINDOW) {
      setRouteGifExport(s => ({ ...s, status: 'error', progress: 0 }));
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
    const pulse = packetToPulse(selectedPacket, Date.now(), {
      force: true,
      travelDurationMs,
      brightness: Math.max(1.35, mapSettings.packets.brightness),
      trailScale: Math.max(1.2, mapSettings.packets.trail),
      animationStyle: mapSettings.packets.animationStyle
    });
    setRouteGifExportRequest({
      token,
      packet: selectedPacket,
      pulse,
      settleMs: 650,
      travelDurationMs,
      onProgress: (progress) => setRouteGifExport(s => ({ ...s, progress })),
      onComplete: (blob) => {
        downloadRouteGifBlob(selectedPacket, blob);
        setRouteGifExportRequest(null);
        setRouteGifExport(s => ({ ...s, status: 'done', progress: 1 }));
        window.setTimeout(() => {
          setRouteGifExport((current) => (current.status === 'done' ? { ...current, status: 'idle', progress: 0 } : current));
        }, 2600);
      },
      onError: () => {
        gifExportTimestampsRef.current.pop();
        const rem = GIF_EXPORT_MAX_PER_WINDOW - gifExportTimestampsRef.current.filter(t => t > Date.now() - GIF_EXPORT_WINDOW_MS).length;
        setRouteGifExportRequest(null);
        setRouteGifExport(s => ({ ...s, status: 'error', progress: 0, remainingExports: rem }));
        window.setTimeout(() => {
          setRouteGifExport((current) => (current.status === 'error' ? { ...current, status: 'idle', progress: 0 } : current));
        }, 3600);
      }
    });
  }, [mapSettings.packets, routeGifExport.status, selectedPacket]);

  const showRouteGifExport = Boolean(selectedPacket && !packetsOpen && !netGraphOpen && !chatOpen && !labOpen && !setupOpen && !propagationOpen && !vcrOpen);
  const knownPathwaysOn = mapSettings.layers.routes;
  const workspaceSurfaceOpen = packetsOpen || netGraphOpen || chatOpen || labOpen || nodeListOpen;
  const nocSummaryVisible = !chromeHidden && !workspaceSurfaceOpen && !setupOpen && !propagationOpen && !nodeListOpen && !shortcutHelpOpen && !mapSettingsOpen && !vcrOpen && !mobileControlsOpen;
  const visitorGuideSuppressed = chromeHidden || packetsOpen || netGraphOpen || chatOpen || labOpen || setupOpen || propagationOpen || vcrOpen || nodeListOpen || shortcutHelpOpen || mapSettingsOpen || mobileControlsOpen || Boolean(selectedNode || selectedRoute || selectedPacket);

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
      <LinkBar packetsOpen={packetsOpen} netGraphOpen={netGraphOpen} chatOpen={chatOpen} labOpen={labOpen} nodeListOpen={nodeListOpen} activeLabExperimentID={labExperimentID} />
      {!chromeHidden && (
        <>
          <StatusBar
            stats={state.stats}
            socketStatus={socketStatus}
            nodeCount={visibleNodes.length}
            routeCount={visibleRoutes.length}
            coverage={coverage}
            latestPayloadTypeName={latestPacketActivity?.payloadTypeName ?? null}
            latestPacketID={latestPacketActivity?.id ?? null}
          />
          {nocSummaryVisible && <NocSummary />}
        </>
      )}

      <div className="top-actions operator-toolbar" aria-label="Map actions">
        <button
          className={`operator-action ${followTraffic && !vcrPlaybackActive ? 'active' : ''}`}
          type="button"
          aria-pressed={followTraffic && !vcrPlaybackActive}
          disabled={vcrPlaybackActive}
          title={vcrPlaybackActive ? 'Live follow resumes after replay' : followTraffic ? 'Stop following live traffic' : 'Follow live traffic'}
          onClick={() => setFollowTraffic((value) => !value)}
        >
          <RadioTower size={16} />
          <span>Live</span>
        </button>
        <button className="operator-action route-focus" type="button" title="Focus latest route" onClick={() => dispatchMapAction('latest-route')}>
          <LocateFixed size={16} />
          <span>Focus</span>
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
                <button type="button" onClick={() => { openVcr(); setPanelsMenuOpen(false); }}>
                  <History size={14} />
                  <span>Replay</span>
                </button>
                <button type="button" onClick={() => { openNodeList(); setPanelsMenuOpen(false); }}>
                  <RadioTower size={14} />
                  <span>Nodes</span>
                </button>
                <button type="button" onClick={() => { setPropagationOpen(true); setPanelsMenuOpen(false); }}>
                  <CloudSun size={14} />
                  <span>Propagation</span>
                </button>
                <button type="button" onClick={shareView}>
                  <Share2 size={14} />
                  <span>Share</span>
                </button>
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
                <button type="button" onClick={() => { window.location.hash = '#/setup'; setPanelsMenuOpen(false); }}>
                  <SlidersHorizontal size={14} />
                  <span>Setup</span>
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
      <div className="mobile-control-dock" aria-label="Mobile map controls">
        <button
          className={`mobile-control-button ${followTraffic && !vcrPlaybackActive ? 'active' : ''}`}
          type="button"
          aria-pressed={followTraffic && !vcrPlaybackActive}
          disabled={vcrPlaybackActive}
          title={vcrPlaybackActive ? 'Live follow resumes after replay' : followTraffic ? 'Stop following live traffic' : 'Follow live traffic'}
          onClick={() => setFollowTraffic((value) => !value)}
        >
          <RadioTower size={20} />
          <span>Live</span>
        </button>
        <button className="mobile-control-button" type="button" title="Focus latest route" onClick={() => dispatchMapAction('latest-route')}>
          <LocateFixed size={20} />
          <span>Focus</span>
        </button>
        <button
          className={`mobile-control-button known-pathways-toggle ${knownPathwaysOn ? 'on' : 'off'}`}
          type="button"
          aria-pressed={knownPathwaysOn}
          title={knownPathwaysOn ? 'Routes on' : 'Routes off'}
          onClick={toggleKnownPathways}
        >
          <Route size={20} />
          <span>Routes</span>
        </button>
        <button
          className={`mobile-control-button ${mapSettingsOpen ? 'active' : ''}`}
          type="button"
          aria-pressed={mapSettingsOpen}
          title="Map"
          onClick={() => {
            setMapSettingsOpen((value) => !value);
            setPanelsMenuOpen(false);
            setPaletteMenuOpen(false);
            setMobileControlsOpen(false);
          }}
        >
          <SlidersHorizontal size={20} />
          <span>Map</span>
        </button>
        <button
          className={`mobile-control-button ${mobileControlsOpen ? 'active' : ''}`}
          type="button"
          aria-expanded={mobileControlsOpen}
          title="More map controls"
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
      </div>
      {mobileControlsOpen && (
        <section className="mobile-control-sheet" aria-label="Map controls">
          <header className="mobile-control-sheet-header">
            <div>
              <span className="panel-eyebrow">Map</span>
              <h2>Controls</h2>
            </div>
            <button type="button" className="icon-button" title="Close map controls" onClick={() => setMobileControlsOpen(false)}>
              <X size={18} />
            </button>
          </header>
          <div className="mobile-control-grid">
            <button type="button" onClick={toggleChromeVisibility}>
              {chromeHidden ? <Eye size={18} /> : <EyeOff size={18} />}
              <span>{chromeHidden ? 'Show UI' : 'Hide UI'}</span>
            </button>
            <button type="button" onClick={() => {
              setPropagationOpen(true);
              setMobileControlsOpen(false);
            }}>
              <CloudSun size={18} />
              <span>Propagation</span>
            </button>
            <button type="button" onClick={() => setPaused((value) => !value)}>
              {paused ? <Play size={18} /> : <Pause size={18} />}
              <span>{paused ? 'Resume' : 'Pause'}</span>
            </button>
            <button type="button" onClick={() => {
              openVcr();
              setMobileControlsOpen(false);
            }}>
              <History size={18} />
              <span>Replay</span>
            </button>
            <button type="button" onClick={() => setClearToken((value) => value + 1)}>
              <RotateCcw size={18} />
              <span>Clear</span>
            </button>
            <button type="button" onClick={() => dispatchMapAction('latest-route')}>
              <LocateFixed size={18} />
              <span>Focus</span>
            </button>
            <button type="button" onClick={shareView}>
              <Share2 size={18} />
              <span>Share</span>
            </button>
            <button type="button" onClick={() => {
              openNodeList();
              setMobileControlsOpen(false);
            }}>
              <RadioTower size={18} />
              <span>Nodes</span>
            </button>
            <button type="button" onClick={() => { window.location.hash = '#/setup'; setMobileControlsOpen(false); }}>
              <SlidersHorizontal size={18} />
              <span>Setup</span>
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
      {shareToast && <div className="share-toast" role="status">{shareToast}</div>}
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
      {setupOpen && <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}><Suspense fallback={<PanelSkeleton />}><SetupPanel mapConfig={publicMapConfig} onClose={closeSetup} /></Suspense></ErrorBoundary>}
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
          <Suspense fallback={<PanelSkeleton />}>
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
          <Suspense fallback={<PanelSkeleton />}>
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
      {chatOpen && <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}><Suspense fallback={<PanelSkeleton />}><ChatPanel presentation={workspacePresentation} onPresentationChange={setWorkspacePresentation} onClose={closeChat} /></Suspense></ErrorBoundary>}
      {labOpen && <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}><Suspense fallback={<PanelSkeleton />}><LabPanel state={state} socketStatus={socketStatus} experimentID={labExperimentID} presentation={workspacePresentation} onExperimentChange={selectLabExperiment} onPresentationChange={setWorkspacePresentation} onClose={closeLab} /></Suspense></ErrorBoundary>}
      {nodeListOpen && <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}><Suspense fallback={<PanelSkeleton />}><NodeListPanel nodes={visibleNodes} selectedNodeID={selectedNodeID} presentation={workspacePresentation} onPresentationChange={setWorkspacePresentation} onSelectNode={selectNodeFromList} onClose={closeNodeList} /></Suspense></ErrorBoundary>}
      {shortcutHelpOpen && <ErrorBoundary fallback={<div className="panel-error">Panel failed to load. <button onClick={() => window.location.reload()}>Reload</button></div>}><Suspense fallback={<PanelSkeleton />}><ShortcutHelp onClose={() => setShortcutHelpOpen(false)} /></Suspense></ErrorBoundary>}

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
      <span className="node-loading-spinner" />
      <span>
        <strong>{title}</strong>
        <em>{message}</em>
      </span>
    </div>
  );
}
