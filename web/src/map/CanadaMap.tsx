import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import maplibregl from 'maplibre-gl';
import type { PublicMessageAnchor, PublicNode, PublicObserverBurst, PublicRoute, PublicRoutePulse } from '../types';
import { parseSharedView, type MapViewState, type SharedViewState } from '../shareView';
import { normalizePayloadType, payloadVisual } from '../payloadVisuals';
import { isMappableEndpoint, isMappableNode } from './geo';
import { shouldAnimateLiveEvent } from './animationSafety';
import {
  CLUSTER_ACTIVITY_GLOW_MS,
  CLUSTER_ACTIVITY_QUERY_RADIUS_PX,
  CLUSTER_ACTIVITY_UPDATE_MS,
  type ClusterActivityGlow,
  type ClusterActivityTarget,
  clusterActivityGlowsToGeoJSON,
  nearestClusterTarget,
  pruneClusterActivityGlows,
  upsertClusterActivityGlow
} from './clusterActivity';
import { nodeFocusFromRoutes, type NodeFocus } from './nodeFocus';
import { PacketAnimator } from './packetAnimator';
import {
  compactNodeLabel,
  NODE_ACTIVITY_UPDATE_MS,
  NODE_ACTIVITY_WINDOW_MS,
  NODE_LABEL_UPDATE_MS,
  nodeLabelActivityProgress,
  nodeActivityGlow,
  nodeActivityHeat,
  nodeLastHeardAgeLabel,
  nodeMapLabel
} from './nodeLabels';
import {
  ROUTE_ACTIVE_OPACITY,
  ROUTE_ACTIVE_WIDTH,
  ROUTE_BASE_OPACITY,
  ROUTE_BASE_WIDTH,
  ROUTE_CONNECTED_OPACITY,
  ROUTE_CONNECTED_WIDTH,
  ROUTE_PATH_OPACITY,
  ROUTE_PATH_WIDTH,
  ROUTE_DIMMED_OPACITY
} from './routeStyles';
import { DETAIL_MIN_ZOOM, NODE_CLUSTER_MAX_ZOOM, type MapVisualMode, isClusterZoom, isDetailZoom, visualModeForZoom } from './zoomMode';

export type MapAction =
  | { type: 'reset'; token: number }
  | { type: 'latest-route'; token: number }
  | { type: 'route'; token: number; routeID: string }
  | { type: 'node'; token: number; nodeID: string }
  | null;

interface Props {
  nodes: PublicNode[];
  routes: PublicRoute[];
  pulses: PublicRoutePulse[];
  observerBursts: PublicObserverBurst[];
  paused: boolean;
  followTraffic: boolean;
  clearToken: number;
  selectedNodeID: string | null;
  selectedRouteID: string | null;
  highlightedPathRouteIDs: Set<string>;
  highlightedPathNodeIDs: Set<string>;
  plotMode: 'off' | 'node' | 'area';
  mapAction: MapAction;
  initialView: SharedViewState | null;
  loading: boolean;
  onPositionedNodesRendered: () => void;
  onViewChange: (view: MapViewState) => void;
  onSelectNode: (nodeID: string) => void;
  onSelectRoute: (routeID: string) => void;
  onPlotNodePick: (nodeID: string) => void;
  onPlotMapPoint: (point: { lat: number; lng: number }) => void;
  onClearSelection: () => void;
}

type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<Record<string, unknown>>;
};

type NodeActivity = {
  hits: number[];
  lastAt: number;
};

type RoutePayloadGlow = {
  color: string;
  startedAt: number;
  expiresAt: number;
};

type NodeTelemetry = {
  lastSeen: number;
  activityCount: number;
};

type HoveredNodeToast = {
  node: PublicNode;
  x: number;
  y: number;
};

type ScreenNodeLabel = {
  id: string;
  name: string;
  age: string;
  x: number;
  y: number;
  selected: boolean;
  neighbour: boolean;
  path: boolean;
  observer: boolean;
  recentActive: boolean;
  color: string;
  opacity: number;
  glow: number;
};

type MessageBubble = {
  id: string;
  sender: string;
  text: string;
  lat: number;
  lng: number;
  x: number;
  y: number;
  color: string;
  createdAt: number;
  expiresAt: number;
};

const NODE_SOURCE = 'public-nodes';
const ROUTE_SOURCE = 'public-routes';
const CLUSTER_ACTIVITY_SOURCE = 'cluster-activity-glows';
const CLUSTER_ACTIVITY_AURA_LAYER = 'cluster-activity-aura';
const CLUSTER_ACTIVITY_RING_LAYER = 'cluster-activity-ring';
const CLUSTER_LAYER = 'node-clusters';
const CLUSTER_COUNT_LAYER = 'node-cluster-counts';
const ROUTE_GLOW_LAYER = 'route-focus-glow';
const ROUTE_PAYLOAD_GLOW_LAYER = 'route-payload-glow';
const NODE_HALO_LAYER = 'selected-node-halo';
const NODE_LAYER = 'node-symbols';
const OBSERVER_LAYER = 'observer-symbols';
const ROUTE_LAYER = 'route-lines';
const ROUTE_HIT_LAYER = 'route-hit-lines';
const NODE_ACTIVE_LABEL_VISIBLE_MS = 24_000;
const NODE_LABEL_RECENT_VISIBLE_MS = 90_000;
const MESSAGE_BUBBLE_LIFETIME_MS = 7_200;
const MESSAGE_BUBBLE_MAX_WIDTH_PX = 440;
const MESSAGE_BUBBLE_EDGE_PADDING_PX = 16;
const ROUTE_PAYLOAD_GLOW_MS = 5_200;
const ROUTE_PAYLOAD_GLOW_UPDATE_MS = 90;
const ROUTE_VISUAL_CADENCE_MS = 150;
const OBSERVER_VISUAL_CADENCE_MS = 105;
const MAX_PENDING_ROUTE_VISUALS = 220;
const MAX_PENDING_OBSERVER_VISUALS = 360;
const FOLLOW_TRAFFIC_MIN_INTERVAL_MS = 3200;
const FOLLOW_TRAFFIC_DURATION_MS = 1450;
const FOLLOW_TRAFFIC_ROUTE_MAX_ZOOM = 8.9;
const FOLLOW_TRAFFIC_POINT_ZOOM = 8.4;

const routeColors = ['#2563eb', '#06b6d4', '#22c55e', '#f97316', '#ef4444'];

const mapStyle: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    cartoDark: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    },
    [NODE_SOURCE]: {
      type: 'geojson',
      data: emptyCollection() as any,
      cluster: true,
      clusterMaxZoom: NODE_CLUSTER_MAX_ZOOM,
      clusterRadius: 58
    },
    [ROUTE_SOURCE]: {
      type: 'geojson',
      data: emptyCollection() as any
    },
    [CLUSTER_ACTIVITY_SOURCE]: {
      type: 'geojson',
      data: emptyCollection() as any
    }
  },
  layers: [
    {
      id: 'map-background',
      type: 'background',
      paint: { 'background-color': '#05070b' }
    },
    {
      id: 'carto-dark',
      type: 'raster',
      source: 'cartoDark',
      minzoom: 0,
      maxzoom: 20
    },
    {
      id: ROUTE_GLOW_LAYER,
      type: 'line',
      source: ROUTE_SOURCE,
      minzoom: DETAIL_MIN_ZOOM,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'case',
          ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'hovered'], true]],
          '#f8fafc',
          ['==', ['get', 'path'], true],
          '#facc15',
          ['==', ['get', 'connected'], true],
          '#67e8f9',
          '#67e8f9'
        ],
        'line-width': [
          'case',
          ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'hovered'], true]],
          8,
          ['==', ['get', 'path'], true],
          7,
          ['==', ['get', 'connected'], true],
          6,
          0
        ],
        'line-blur': 4,
        'line-opacity': [
          'case',
          ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'hovered'], true]],
          0.22,
          ['==', ['get', 'path'], true],
          0.24,
          ['==', ['get', 'connected'], true],
          0.18,
          0
        ]
      }
    },
    {
      id: ROUTE_PAYLOAD_GLOW_LAYER,
      type: 'line',
      source: ROUTE_SOURCE,
      minzoom: DETAIL_MIN_ZOOM,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['coalesce', ['feature-state', 'payloadGlowColor'], '#ffffff'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 6.5, 10, 9, 13, 13],
        'line-blur': 5,
        'line-opacity': [
          '*',
          ['coalesce', ['feature-state', 'payloadGlow'], 0],
          ['case', ['==', ['get', 'dimmed'], true], 0.2, 0.46]
        ]
      }
    },
    {
      id: ROUTE_LAYER,
      type: 'line',
      source: ROUTE_SOURCE,
      minzoom: DETAIL_MIN_ZOOM,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['==', ['get', 'path'], true], '#facc15', ['get', 'color']],
        'line-width': [
          'case',
          ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'hovered'], true]],
          ROUTE_ACTIVE_WIDTH,
          ['==', ['get', 'path'], true],
          ROUTE_PATH_WIDTH,
          ['==', ['get', 'connected'], true],
          ROUTE_CONNECTED_WIDTH,
          ROUTE_BASE_WIDTH
        ],
        'line-opacity': [
          'case',
          ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'hovered'], true]],
          ROUTE_ACTIVE_OPACITY,
          ['==', ['get', 'path'], true],
          ROUTE_PATH_OPACITY,
          ['==', ['get', 'connected'], true],
          ROUTE_CONNECTED_OPACITY,
          ['==', ['get', 'dimmed'], true],
          ROUTE_DIMMED_OPACITY,
          ROUTE_BASE_OPACITY
        ]
      }
    },
    {
      id: ROUTE_HIT_LAYER,
      type: 'line',
      source: ROUTE_SOURCE,
      minzoom: DETAIL_MIN_ZOOM,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': 14,
        'line-opacity': 0
      }
    },
    {
      id: CLUSTER_ACTIVITY_AURA_LAYER,
      type: 'circle',
      source: CLUSTER_ACTIVITY_SOURCE,
      maxzoom: DETAIL_MIN_ZOOM,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          ['+', 19, ['*', ['coalesce', ['get', 'intensity'], 0], 14]],
          7,
          ['+', 25, ['*', ['coalesce', ['get', 'intensity'], 0], 20]]
        ],
        'circle-blur': 0.55,
        'circle-opacity': ['*', ['coalesce', ['get', 'intensity'], 0], 0.18],
        'circle-stroke-width': 0
      }
    },
    {
      id: CLUSTER_LAYER,
      type: 'circle',
      source: NODE_SOURCE,
      maxzoom: DETAIL_MIN_ZOOM,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['step', ['get', 'point_count'], '#164e63', 25, '#166534', 75, '#7c2d12'],
        'circle-radius': ['step', ['get', 'point_count'], 17, 25, 22, 75, 28],
        'circle-stroke-width': ['step', ['get', 'point_count'], 1.8, 25, 2.2, 75, 2.6],
        'circle-stroke-color': 'rgba(248, 250, 252, 0.86)',
        'circle-opacity': 0.92,
        'circle-blur': 0.04
      }
    },
    {
      id: CLUSTER_ACTIVITY_RING_LAYER,
      type: 'circle',
      source: CLUSTER_ACTIVITY_SOURCE,
      maxzoom: DETAIL_MIN_ZOOM,
      paint: {
        'circle-color': 'rgba(0, 0, 0, 0)',
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          ['+', 18, ['*', ['coalesce', ['get', 'intensity'], 0], 5]],
          7,
          ['+', 25, ['*', ['coalesce', ['get', 'intensity'], 0], 7]]
        ],
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': ['+', 1.2, ['*', ['coalesce', ['get', 'intensity'], 0], 1.4]],
        'circle-stroke-opacity': ['*', ['coalesce', ['get', 'intensity'], 0], 0.46],
        'circle-blur': 0.08
      }
    },
    {
      id: CLUSTER_COUNT_LAYER,
      type: 'symbol',
      source: NODE_SOURCE,
      maxzoom: DETAIL_MIN_ZOOM,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': ['step', ['get', 'point_count'], 11, 25, 12, 75, 13],
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: {
        'text-color': '#f8fafc',
        'text-halo-color': '#020617',
        'text-halo-width': 2,
        'text-halo-blur': 0.5
      }
    },
    {
      id: NODE_HALO_LAYER,
      type: 'circle',
      source: NODE_SOURCE,
      minzoom: DETAIL_MIN_ZOOM,
      filter: ['all', ['!', ['has', 'point_count']], ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'neighbor'], true], ['==', ['get', 'path'], true]]],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], true], 18, ['==', ['get', 'path'], true], 15, 12],
        'circle-color': 'rgba(255, 255, 255, 0)',
        'circle-stroke-color': ['case', ['==', ['get', 'selected'], true], '#f8fafc', ['==', ['get', 'path'], true], '#facc15', '#67e8f9'],
        'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 2.4, ['==', ['get', 'path'], true], 1.9, 1.6],
        'circle-opacity': ['case', ['==', ['get', 'selected'], true], 0.95, ['==', ['get', 'path'], true], 0.78, 0.68]
      }
    },
    {
      id: NODE_LAYER,
      type: 'circle',
      source: NODE_SOURCE,
      minzoom: DETAIL_MIN_ZOOM,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          ['case', ['==', ['get', 'selected'], true], 7, ['==', ['get', 'path'], true], 6.1, ['==', ['get', 'neighbor'], true], 5.4, 3],
          8,
          ['case', ['==', ['get', 'selected'], true], 8, ['==', ['get', 'path'], true], 7.1, ['==', ['get', 'neighbor'], true], 6.4, 5.5],
          12,
          ['case', ['==', ['get', 'selected'], true], 9, ['==', ['get', 'path'], true], 8.1, ['==', ['get', 'neighbor'], true], 7.2, 7]
        ],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': [
          'case',
          ['==', ['get', 'selected'], true],
          '#ffffff',
          ['==', ['get', 'path'], true],
          '#facc15',
          ['==', ['get', 'neighbor'], true],
          '#67e8f9',
          'rgba(248, 250, 252, 0.82)'
        ],
        'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 2.2, ['==', ['get', 'path'], true], 1.95, ['==', ['get', 'neighbor'], true], 1.7, 1.15],
        'circle-opacity': ['case', ['==', ['get', 'dimmed'], true], 0.28, 0.92],
        'circle-stroke-opacity': ['case', ['==', ['get', 'dimmed'], true], 0.25, ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'path'], true], ['==', ['get', 'neighbor'], true]], 1, 0.86]
      }
    }
  ]
};

export default function CanadaMap({
  nodes,
  routes,
  pulses,
  observerBursts,
  paused,
  followTraffic,
  clearToken,
  selectedNodeID,
  selectedRouteID,
  highlightedPathRouteIDs,
  highlightedPathNodeIDs,
  plotMode,
  mapAction,
  initialView,
  loading,
  onPositionedNodesRendered,
  onViewChange,
  onSelectNode,
  onSelectRoute,
  onPlotNodePick,
  onPlotMapPoint,
  onClearSelection
}: Props) {
  const [hoveredRouteID, setHoveredRouteID] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<HoveredNodeToast | null>(null);
  const [screenNodeLabels, setScreenNodeLabels] = useState<ScreenNodeLabel[]>([]);
  const [messageBubbles, setMessageBubbles] = useState<MessageBubble[]>([]);
  const [mapZoom, setMapZoom] = useState(3.35);
  const [mapCenter, setMapCenter] = useState({ lat: 56.1304, lng: -106.3468 });
  const [mapInitError, setMapInitError] = useState('');
  const [nodeLabelClock, setNodeLabelClock] = useState(() => Date.now());
  const nodeFocus = useMemo(
    () => nodeFocusFromRoutes(selectedNodeID, routes, highlightedPathRouteIDs, highlightedPathNodeIDs),
    [selectedNodeID, routes, highlightedPathRouteIDs, highlightedPathNodeIDs]
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const animatorRef = useRef<PacketAnimator | null>(null);
  const loadedRef = useRef(false);
  const fitInitialNodesRef = useRef(false);
  const positionedNodesReadyRef = useRef(false);
  const seenPulseIDsRef = useRef<Set<string>>(new Set());
  const seenObserverBurstIDsRef = useRef<Set<string>>(new Set());
  const pendingPulsesRef = useRef<PublicRoutePulse[]>([]);
  const pendingObserverBurstsRef = useRef<PublicObserverBurst[]>([]);
  const followTrafficRef = useRef(followTraffic);
  const followTrafficStateRef = useRef({ lastAt: 0, lastID: '' });
  const pulseSchedulerTimerRef = useRef<number | null>(null);
  const observerSchedulerTimerRef = useRef<number | null>(null);
  const nodeActivityRef = useRef<Map<string, NodeActivity>>(new Map());
  const nodeTelemetryRef = useRef<Map<string, NodeTelemetry>>(new Map());
  const nodeMeshActivityAtRef = useRef<Map<string, number>>(new Map());
  const nodeActivityTimerRef = useRef<number | null>(null);
  const routePayloadGlowRef = useRef<Map<string, RoutePayloadGlow>>(new Map());
  const routePayloadGlowTimerRef = useRef<number | null>(null);
  const clusterActivityGlowRef = useRef<Map<string, ClusterActivityGlow>>(new Map());
  const clusterActivityGlowTimerRef = useRef<number | null>(null);
  const mapVisualModeRef = useRef<MapVisualMode>(visualModeForZoom(initialView?.z ?? 3.35));
  const nodeLabelFrameRef = useRef<number | null>(null);
  const messageBubbleCleanupTimersRef = useRef<Map<string, number>>(new Map());
  const pageHiddenRef = useRef(typeof document !== 'undefined' ? document.hidden : false);
  const initialViewRef = useRef(initialView);
  const nodesRef = useRef(nodes);
  const routesRef = useRef(routes);
  const selectedNodeIDRef = useRef(selectedNodeID);
  const nodeFocusRef = useRef(nodeFocus);
  const positionedNodesRenderedRef = useRef(onPositionedNodesRendered);
  const viewChangeRef = useRef(onViewChange);
  const selectedNodeRef = useRef(onSelectNode);
  const selectedRouteRef = useRef(onSelectRoute);
  const plotModeRef = useRef(plotMode);
  const plotNodePickRef = useRef(onPlotNodePick);
  const plotMapPointRef = useRef(onPlotMapPoint);
  const clearSelectionRef = useRef(onClearSelection);

  const showMessageBubble = (map: maplibregl.Map, bubble: MessageBubble | null) => {
    if (!bubble) return;
    setMessageBubbles((current) => projectMessageBubbles(map, [...current.filter((item) => item.id !== bubble.id), bubble].slice(-12), performance.now()));
    const existingTimer = messageBubbleCleanupTimersRef.current.get(bubble.id);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      messageBubbleCleanupTimersRef.current.delete(bubble.id);
      setMessageBubbles((current) => current.filter((item) => item.id !== bubble.id));
    }, MESSAGE_BUBBLE_LIFETIME_MS + 400);
    messageBubbleCleanupTimersRef.current.set(bubble.id, timer);
  };

  const renderScheduledPulse = (pulse: PublicRoutePulse) => {
    const map = mapRef.current;
    const shouldAnimate = shouldAnimateLiveEvent(visualReceivedAt(pulse), Date.now(), pageHiddenRef.current);
    if (!map) return;
    if (shouldAnimate) followTrafficPulse(map, pulse, followTrafficRef.current, followTrafficStateRef);
    if (isClusterMode(map)) {
      if (shouldAnimate && addPulseClusterActivityGlow(map, clusterActivityGlowRef.current, pulse)) {
        startClusterActivityGlowTimer(map, clusterActivityGlowRef, clusterActivityGlowTimerRef);
      }
      setScreenNodeLabels([]);
      setMessageBubbles([]);
      return;
    }
    if (shouldAnimate) animatorRef.current?.add(pulse);
    addPulseNodeActivity(map, nodeActivityRef.current, pulse);
    addPulseNodeMeshActivity(nodeMeshActivityAtRef.current, pulse);
    if (shouldAnimate) {
      addPulseRoutePayloadGlow(map, routePayloadGlowRef.current, pulse);
      startRoutePayloadGlowTimer(map, routePayloadGlowRef, routePayloadGlowTimerRef);
    }
    setScreenNodeLabels(projectNodeLabels(map, nodesRef.current, nodeFocusRef.current, pulse.heardAt, nodeMeshActivityAtRef.current, nodeActivityRef.current));
    if (shouldAnimate && shouldShowMessageBubble(pulse)) {
      showMessageBubble(map, messageBubbleFromPulse(map, pulse));
    }
    startNodeActivityTimer(map, nodeActivityRef, nodeActivityTimerRef);
  };

  const renderScheduledObserverBurst = (burst: PublicObserverBurst) => {
    const map = mapRef.current;
    const shouldAnimate = shouldAnimateLiveEvent(visualReceivedAt(burst), Date.now(), pageHiddenRef.current);
    if (map && shouldAnimate) followTrafficObserverBurst(map, burst, followTrafficRef.current, followTrafficStateRef);
    if (map && isClusterMode(map)) {
      if (shouldAnimate && addObserverBurstClusterActivityGlow(map, clusterActivityGlowRef.current, burst)) {
        startClusterActivityGlowTimer(map, clusterActivityGlowRef, clusterActivityGlowTimerRef);
      }
      setMessageBubbles([]);
      return;
    }
    if (shouldAnimate) animatorRef.current?.addObserverBurst(burst);
    if (map && shouldAnimate && shouldShowMessageBubble(burst)) {
      showMessageBubble(map, messageBubbleFromObserverBurst(map, burst));
    }
  };

  const schedulePulseDrain = () => {
    if (pulseSchedulerTimerRef.current !== null) return;
    pulseSchedulerTimerRef.current = window.setTimeout(() => {
      pulseSchedulerTimerRef.current = null;
      const next = pendingPulsesRef.current.shift();
      if (next) renderScheduledPulse(next);
      if (pendingPulsesRef.current.length > 0) schedulePulseDrain();
    }, ROUTE_VISUAL_CADENCE_MS);
  };

  const scheduleObserverBurstDrain = () => {
    if (observerSchedulerTimerRef.current !== null) return;
    observerSchedulerTimerRef.current = window.setTimeout(() => {
      observerSchedulerTimerRef.current = null;
      const next = pendingObserverBurstsRef.current.shift();
      if (next) renderScheduledObserverBurst(next);
      if (pendingObserverBurstsRef.current.length > 0) scheduleObserverBurstDrain();
    }, OBSERVER_VISUAL_CADENCE_MS);
  };

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    routesRef.current = routes;
  }, [routes]);

  useEffect(() => {
    selectedNodeIDRef.current = selectedNodeID;
  }, [selectedNodeID]);

  useEffect(() => {
    nodeFocusRef.current = nodeFocus;
  }, [nodeFocus]);

  useEffect(() => {
    positionedNodesRenderedRef.current = onPositionedNodesRendered;
    viewChangeRef.current = onViewChange;
    selectedNodeRef.current = onSelectNode;
    selectedRouteRef.current = onSelectRoute;
    plotModeRef.current = plotMode;
    plotNodePickRef.current = onPlotNodePick;
    plotMapPointRef.current = onPlotMapPoint;
    clearSelectionRef.current = onClearSelection;
  }, [onPositionedNodesRendered, onViewChange, onSelectNode, onSelectRoute, plotMode, onPlotNodePick, onPlotMapPoint, onClearSelection]);

  useEffect(() => {
    const handleVisibility = () => {
      pageHiddenRef.current = document.hidden;
      if (!document.hidden) return;
      animatorRef.current?.clear();
      setMessageBubbles([]);
    };
    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current || mapRef.current) return;
    const startupView = initialViewRef.current ?? parseSharedView(window.location.search);
    if (startupView) initialViewRef.current = startupView;
    if (startupView) fitInitialNodesRef.current = true;
    setMapZoom(Number((startupView?.z ?? 3.35).toFixed(2)));
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle,
      center: startupView ? [startupView.lng, startupView.lat] : [-106.3468, 56.1304],
      zoom: startupView?.z ?? 3.35,
      minZoom: 2.4,
      maxZoom: 13,
      fadeDuration: 0,
      attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
    (window as any).__meshcoreMap = map;
    (window as any).__meshcoreMapStyle = mapStyle;
    mapRef.current = map;
    animatorRef.current = new PacketAnimator(map, canvasRef.current, { maskLayerIDs: [CLUSTER_LAYER, NODE_HALO_LAYER, NODE_LAYER] });

    const resizeMap = () => {
      map.resize();
      animatorRef.current?.resize();
    };
    const updateMapOverlays = () => {
      const center = map.getCenter();
      setMapZoom(Number(map.getZoom().toFixed(2)));
      setMapCenter({ lat: Number(center.lat.toFixed(5)), lng: Number(center.lng.toFixed(5)) });
      const mode = handleVisualModeTransition(
        map,
        mapVisualModeRef,
        clusterActivityGlowRef,
        clusterActivityGlowTimerRef,
        nodeActivityRef,
        nodeActivityTimerRef,
        routePayloadGlowRef,
        routePayloadGlowTimerRef,
        animatorRef
      );
      if (mode === 'cluster') {
        setScreenNodeLabels([]);
        setMessageBubbles([]);
        return;
      }
      setScreenNodeLabels(projectNodeLabels(map, nodesRef.current, nodeFocusRef.current, Date.now(), nodeMeshActivityAtRef.current, nodeActivityRef.current));
      setMessageBubbles((current) => projectMessageBubbles(map, current, performance.now()));
    };
    const scheduleMapOverlays = () => {
      if (nodeLabelFrameRef.current !== null) return;
      nodeLabelFrameRef.current = window.requestAnimationFrame(() => {
        nodeLabelFrameRef.current = null;
        updateMapOverlays();
      });
    };
    const resizeOverlay = () => {
      animatorRef.current?.resize();
      scheduleMapOverlays();
    };
    const publishView = () => viewChangeRef.current(mapViewFromMap(map));
    const recordMapError = (event: { error?: Error }) => {
      if (!loadedRef.current) setMapInitError(event.error?.message ?? 'map style error');
    };
    map.on('resize', resizeOverlay);
    map.on('move', scheduleMapOverlays);
    map.on('moveend', publishView);
    map.on('error', recordMapError);
    window.addEventListener('resize', resizeMap);
    window.setTimeout(updateMapOverlays, 0);

    let initializeRetry: number | null = null;
    const initializeMapLayers = () => {
      if (loadedRef.current) return;
      if (!mapStyleSourcesReady(map)) {
        initializeRetry = window.setTimeout(initializeMapLayers, 250);
        return;
      }
      try {
        addPublicLayers(map);
        bindLayerEvents(map, nodesRef, selectedNodeRef, selectedRouteRef, plotModeRef, plotNodePickRef, plotMapPointRef, clearSelectionRef, setHoveredRouteID, setHoveredNode);
        try {
          addBaseMapLayer(map);
        } catch {
          // The public live layers must not be blocked by external basemap tile availability.
        }
      } catch (error) {
        const style = map.getStyle();
        const sourceKeys = Object.keys(style?.sources ?? {}).slice(0, 8).join(',');
        const layerKeys = (style?.layers ?? []).map((layer) => layer.id).slice(0, 8).join(',');
        const message = error instanceof Error ? error.message : String(error);
        setMapInitError(`${message}; styleSources=${sourceKeys}; styleLayers=${layerKeys}`);
        initializeRetry = window.setTimeout(initializeMapLayers, 1000);
        return;
      }
      setMapInitError('');
      loadedRef.current = true;
      if (initialViewRef.current) {
        fitInitialNodesRef.current = true;
        map.jumpTo({
          center: [initialViewRef.current.lng, initialViewRef.current.lat],
          zoom: initialViewRef.current.z
        });
      }
      setSourceData(map, NODE_SOURCE, nodesToGeoJSON(nodesRef.current, nodeFocusRef.current, Date.now(), nodeMeshActivityAtRef.current));
      setSourceData(map, ROUTE_SOURCE, routesToGeoJSON(routesRef.current, selectedRouteID, null, nodeFocusRef.current));
      publishView();
      updateMapOverlays();
      markPositionedNodesReady(map, nodesRef.current, fitInitialNodesRef, positionedNodesReadyRef, positionedNodesRenderedRef);
    };
    map.on('load', initializeMapLayers);
    map.on('style.load', initializeMapLayers);
    map.on('styledata', initializeMapLayers);
    initializeRetry = window.setTimeout(initializeMapLayers, 250);

    return () => {
      if (initializeRetry !== null) window.clearTimeout(initializeRetry);
      window.removeEventListener('resize', resizeMap);
      map.off('resize', resizeOverlay);
      map.off('move', scheduleMapOverlays);
      map.off('moveend', publishView);
      map.off('error', recordMapError);
      map.off('load', initializeMapLayers);
      map.off('style.load', initializeMapLayers);
      map.off('styledata', initializeMapLayers);
      if (nodeLabelFrameRef.current !== null) window.cancelAnimationFrame(nodeLabelFrameRef.current);
      nodeLabelFrameRef.current = null;
      if (pulseSchedulerTimerRef.current !== null) window.clearTimeout(pulseSchedulerTimerRef.current);
      if (observerSchedulerTimerRef.current !== null) window.clearTimeout(observerSchedulerTimerRef.current);
      pulseSchedulerTimerRef.current = null;
      observerSchedulerTimerRef.current = null;
      pendingPulsesRef.current = [];
      pendingObserverBurstsRef.current = [];
      for (const timer of messageBubbleCleanupTimersRef.current.values()) window.clearTimeout(timer);
      messageBubbleCleanupTimersRef.current.clear();
      stopNodeActivityTimer(nodeActivityTimerRef);
      clearNodeActivityStates(map, nodeActivityRef.current);
      stopRoutePayloadGlowTimer(routePayloadGlowTimerRef);
      clearRoutePayloadGlowStates(map, routePayloadGlowRef.current);
      stopClusterActivityGlowTimer(clusterActivityGlowTimerRef);
      clearClusterActivityGlowStates(map, clusterActivityGlowRef.current);
      animatorRef.current?.destroy();
      animatorRef.current = null;
      map.remove();
      if ((window as any).__meshcoreMap === map) delete (window as any).__meshcoreMap;
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNodeLabelClock(Date.now()), NODE_LABEL_UPDATE_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const map = mapRef.current;
      if (!map) return;
      if (isClusterMode(map)) {
        setScreenNodeLabels([]);
        setMessageBubbles([]);
        return;
      }
      setScreenNodeLabels(projectNodeLabels(map, nodesRef.current, nodeFocusRef.current, Date.now(), nodeMeshActivityAtRef.current, nodeActivityRef.current));
      setMessageBubbles((current) => projectMessageBubbles(map, current, performance.now()));
    }, 500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (loadedRef.current) setSourceData(map, NODE_SOURCE, nodesToGeoJSON(nodes, nodeFocus, nodeLabelClock, nodeMeshActivityAtRef.current));
    if (isClusterMode(map)) {
      setScreenNodeLabels([]);
      stopNodeActivityTimer(nodeActivityTimerRef);
      clearNodeActivityStates(map, nodeActivityRef.current);
      markPositionedNodesReady(map, nodes, fitInitialNodesRef, positionedNodesReadyRef, positionedNodesRenderedRef);
      return;
    }
    setScreenNodeLabels(projectNodeLabels(map, nodes, nodeFocus, nodeLabelClock, nodeMeshActivityAtRef.current, nodeActivityRef.current));
    if (addChangedNodeActivity(map, nodeActivityRef.current, nodeTelemetryRef.current, nodeMeshActivityAtRef.current, nodes)) {
      startNodeActivityTimer(map, nodeActivityRef, nodeActivityTimerRef);
    }
    if (updateNodeActivityFeatureStates(map, nodeActivityRef.current) > 0) {
      startNodeActivityTimer(map, nodeActivityRef, nodeActivityTimerRef);
    }
    markPositionedNodesReady(map, nodes, fitInitialNodesRef, positionedNodesReadyRef, positionedNodesRenderedRef);
  }, [nodes, nodeFocus, nodeLabelClock]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (loadedRef.current) setSourceData(map, ROUTE_SOURCE, routesToGeoJSON(routes, selectedRouteID, hoveredRouteID, nodeFocus));
    animatorRef.current?.setRouteColors(new Map(routes.map((route) => [route.id, routeColors[Math.max(0, Math.min(4, route.frequencyBucket))]])));
  }, [routes, selectedRouteID, hoveredRouteID, nodeFocus]);

  useEffect(() => {
    animatorRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    followTrafficRef.current = followTraffic;
    if (!followTraffic) return;
    const map = mapRef.current;
    if (!map) return;
    const latestPulse = pulses[0];
    const latestBurst = observerBursts[0];
    if (latestPulse && (!latestBurst || visualReceivedAt(latestPulse) >= visualReceivedAt(latestBurst))) {
      followTrafficPulse(map, latestPulse, true, followTrafficStateRef, true);
    } else if (latestBurst) {
      followTrafficObserverBurst(map, latestBurst, true, followTrafficStateRef, true);
    }
  }, [followTraffic, pulses, observerBursts]);

  useEffect(() => {
    const map = mapRef.current;
    animatorRef.current?.clear();
    if (map) {
      clearNodeActivityStates(map, nodeActivityRef.current);
      stopNodeActivityTimer(nodeActivityTimerRef);
      clearRoutePayloadGlowStates(map, routePayloadGlowRef.current);
      stopRoutePayloadGlowTimer(routePayloadGlowTimerRef);
      clearClusterActivityGlowStates(map, clusterActivityGlowRef.current);
      stopClusterActivityGlowTimer(clusterActivityGlowTimerRef);
    }
    seenPulseIDsRef.current.clear();
    seenObserverBurstIDsRef.current.clear();
    pendingPulsesRef.current = [];
    pendingObserverBurstsRef.current = [];
    if (pulseSchedulerTimerRef.current !== null) window.clearTimeout(pulseSchedulerTimerRef.current);
    if (observerSchedulerTimerRef.current !== null) window.clearTimeout(observerSchedulerTimerRef.current);
    pulseSchedulerTimerRef.current = null;
    observerSchedulerTimerRef.current = null;
  }, [clearToken]);

  useEffect(() => {
    for (const pulse of pulses.slice().reverse()) {
      if (seenPulseIDsRef.current.has(pulse.id)) continue;
      seenPulseIDsRef.current.add(pulse.id);
      pendingPulsesRef.current.push(pulse);
    }
    if (pendingPulsesRef.current.length > MAX_PENDING_ROUTE_VISUALS) {
      pendingPulsesRef.current = pendingPulsesRef.current.slice(-MAX_PENDING_ROUTE_VISUALS);
    }
    if (pendingPulsesRef.current.length > 0) schedulePulseDrain();
  }, [pulses]);

  useEffect(() => {
    for (const burst of observerBursts.slice().reverse()) {
      if (seenObserverBurstIDsRef.current.has(burst.id)) continue;
      seenObserverBurstIDsRef.current.add(burst.id);
      pendingObserverBurstsRef.current.push(burst);
    }
    if (pendingObserverBurstsRef.current.length > MAX_PENDING_OBSERVER_VISUALS) {
      pendingObserverBurstsRef.current = pendingObserverBurstsRef.current.slice(-MAX_PENDING_OBSERVER_VISUALS);
    }
    if (pendingObserverBurstsRef.current.length > 0) scheduleObserverBurstDrain();
  }, [observerBursts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapAction) return;
    if (mapAction.type === 'reset') fitToNodes(map, nodesRef.current, 600);
    if (mapAction.type === 'latest-route') {
      const latest = [...routesRef.current].sort((a, b) => b.lastHeard - a.lastHeard)[0];
      if (latest) fitToRoute(map, latest, 700);
    }
    if (mapAction.type === 'route') {
      const route = routesRef.current.find((item) => item.id === mapAction.routeID);
      if (route) fitToRoute(map, route, 700);
    }
    if (mapAction.type === 'node') {
      const node = nodesRef.current.find((item) => item.id === mapAction.nodeID);
      if (node) map.easeTo({ center: [node.longitude, node.latitude], zoom: Math.max(map.getZoom(), 8), duration: 700 });
    }
  }, [mapAction]);

  return (
    <div
      className={`map-wrap ${loading ? 'loading' : ''}`}
      data-map-zoom={mapZoom}
      data-map-center-lat={mapCenter.lat}
      data-map-center-lng={mapCenter.lng}
      data-node-ref-count={nodesRef.current.length}
      data-label-count={screenNodeLabels.length}
      data-map-init-error={mapInitError}
    >
      <div ref={containerRef} className="map-container" />
      <div className="map-vignette" />
      <canvas ref={canvasRef} className="rf-canvas" />
      <div className="node-label-overlay" aria-hidden="true">
        {screenNodeLabels.map((label) => (
          <div
            key={label.id}
            className={`node-screen-label ${label.selected ? 'selected' : ''} ${label.neighbour ? 'neighbor' : ''} ${label.path ? 'path' : ''} ${label.observer ? 'observer' : ''} ${label.recentActive ? 'active' : ''}`}
            style={{
              '--node-label-color': label.color,
              '--node-label-opacity': label.opacity,
              '--node-label-glow': label.glow,
              transform: `translate3d(${Math.round(label.x)}px, ${Math.round(label.y)}px, 0) translate(-50%, 0)`
            } as CSSProperties}
          >
            <span className="node-screen-label-name">{label.name}</span>
            <span className="node-screen-label-age">{label.age}</span>
          </div>
        ))}
      </div>
      <div className="packet-message-overlay" aria-hidden="true">
        {messageBubbles.map((bubble) => (
          <div
            key={bubble.id}
            className="packet-message-bubble"
            style={{
              '--message-color': bubble.color,
              transform: `translate3d(${Math.round(bubble.x)}px, ${Math.round(bubble.y)}px, 0) translate(-50%, -100%)`
            } as CSSProperties}
          >
            <span className="packet-message-sender">{bubble.sender}</span>
            <span className="packet-message-text">{bubble.text}</span>
          </div>
        ))}
      </div>
      {hoveredNode && <NodeHoverToast hovered={hoveredNode} now={nodeLabelClock} />}
    </div>
  );
}

function addBaseMapLayer(map: maplibregl.Map) {
  if (!map.getSource('cartoDark')) {
    map.addSource('cartoDark', {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    });
  }
  if (!map.getLayer('carto-dark')) {
    map.addLayer(
      {
        id: 'carto-dark',
        type: 'raster',
        source: 'cartoDark',
        minzoom: 0,
        maxzoom: 20
      },
      ROUTE_GLOW_LAYER
    );
  }
}

function addPublicLayers(map: maplibregl.Map) {
  addGeneratedNodeIcons(map);

  if (!map.getSource(NODE_SOURCE)) {
    map.addSource(NODE_SOURCE, {
      type: 'geojson',
      data: emptyCollection() as any,
      cluster: true,
      clusterMaxZoom: NODE_CLUSTER_MAX_ZOOM,
      clusterRadius: 58
    });
  }
  if (!map.getSource(ROUTE_SOURCE)) {
    map.addSource(ROUTE_SOURCE, {
      type: 'geojson',
      data: emptyCollection() as any
    });
  }
  if (!map.getSource(CLUSTER_ACTIVITY_SOURCE)) {
    map.addSource(CLUSTER_ACTIVITY_SOURCE, {
      type: 'geojson',
      data: emptyCollection() as any
    });
  }

  addLayerIfMissing(map, {
    id: ROUTE_GLOW_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': [
        'case',
        ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'hovered'], true]],
        '#f8fafc',
        ['==', ['get', 'path'], true],
        '#facc15',
        ['==', ['get', 'connected'], true],
        '#67e8f9',
        '#67e8f9'
      ],
      'line-width': [
        'case',
        ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'hovered'], true]],
        8,
        ['==', ['get', 'path'], true],
        7,
        ['==', ['get', 'connected'], true],
        6,
        0
      ],
      'line-blur': 4,
      'line-opacity': [
        'case',
        ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'hovered'], true]],
        0.22,
        ['==', ['get', 'path'], true],
        0.24,
        ['==', ['get', 'connected'], true],
        0.18,
        0
      ]
    }
  });

  addLayerIfMissing(map, {
    id: ROUTE_PAYLOAD_GLOW_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['coalesce', ['feature-state', 'payloadGlowColor'], '#ffffff'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 6.5, 10, 9, 13, 13],
      'line-blur': 5,
      'line-opacity': [
        '*',
        ['coalesce', ['feature-state', 'payloadGlow'], 0],
        ['case', ['==', ['get', 'dimmed'], true], 0.2, 0.46]
      ]
    }
  });

  addLayerIfMissing(map, {
    id: ROUTE_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['==', ['get', 'path'], true], '#facc15', ['get', 'color']],
      'line-width': [
        'case',
        ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'hovered'], true]],
        ROUTE_ACTIVE_WIDTH,
        ['==', ['get', 'path'], true],
        ROUTE_PATH_WIDTH,
        ['==', ['get', 'connected'], true],
        ROUTE_CONNECTED_WIDTH,
        ROUTE_BASE_WIDTH
      ],
      'line-opacity': [
        'case',
        ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'hovered'], true]],
        ROUTE_ACTIVE_OPACITY,
        ['==', ['get', 'path'], true],
        ROUTE_PATH_OPACITY,
        ['==', ['get', 'connected'], true],
        ROUTE_CONNECTED_OPACITY,
        ['==', ['get', 'dimmed'], true],
        ROUTE_DIMMED_OPACITY,
        ROUTE_BASE_OPACITY
      ]
    }
  });

  addLayerIfMissing(map, {
    id: ROUTE_HIT_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': 14,
      'line-opacity': 0
    }
  });

  addLayerIfMissing(map, {
    id: CLUSTER_ACTIVITY_AURA_LAYER,
    type: 'circle',
    source: CLUSTER_ACTIVITY_SOURCE,
    maxzoom: DETAIL_MIN_ZOOM,
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3,
        ['+', 19, ['*', ['coalesce', ['get', 'intensity'], 0], 14]],
        7,
        ['+', 25, ['*', ['coalesce', ['get', 'intensity'], 0], 20]]
      ],
      'circle-blur': 0.55,
      'circle-opacity': ['*', ['coalesce', ['get', 'intensity'], 0], 0.18],
      'circle-stroke-width': 0
    }
  });

  addLayerIfMissing(map, {
    id: CLUSTER_LAYER,
    type: 'circle',
    source: NODE_SOURCE,
    maxzoom: DETAIL_MIN_ZOOM,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': ['step', ['get', 'point_count'], '#164e63', 25, '#166534', 75, '#7c2d12'],
      'circle-radius': ['step', ['get', 'point_count'], 17, 25, 22, 75, 28],
      'circle-stroke-width': ['step', ['get', 'point_count'], 1.8, 25, 2.2, 75, 2.6],
      'circle-stroke-color': 'rgba(248, 250, 252, 0.86)',
      'circle-opacity': 0.92,
      'circle-blur': 0.04
    }
  });

  addLayerIfMissing(map, {
    id: CLUSTER_ACTIVITY_RING_LAYER,
    type: 'circle',
    source: CLUSTER_ACTIVITY_SOURCE,
    maxzoom: DETAIL_MIN_ZOOM,
    paint: {
      'circle-color': 'rgba(0, 0, 0, 0)',
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3,
        ['+', 18, ['*', ['coalesce', ['get', 'intensity'], 0], 5]],
        7,
        ['+', 25, ['*', ['coalesce', ['get', 'intensity'], 0], 7]]
      ],
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': ['+', 1.2, ['*', ['coalesce', ['get', 'intensity'], 0], 1.4]],
      'circle-stroke-opacity': ['*', ['coalesce', ['get', 'intensity'], 0], 0.46],
      'circle-blur': 0.08
    }
  });

  addLayerIfMissing(map, {
    id: CLUSTER_COUNT_LAYER,
    type: 'symbol',
    source: NODE_SOURCE,
    maxzoom: DETAIL_MIN_ZOOM,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': ['step', ['get', 'point_count'], 11, 25, 12, 75, 13],
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-allow-overlap': true,
      'text-ignore-placement': true
    },
    paint: {
      'text-color': '#f8fafc',
      'text-halo-color': '#020617',
      'text-halo-width': 2,
      'text-halo-blur': 0.5
    }
  });

  addLayerIfMissing(map, {
    id: NODE_HALO_LAYER,
    type: 'circle',
    source: NODE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    filter: ['all', ['!', ['has', 'point_count']], ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'neighbor'], true], ['==', ['get', 'path'], true]]],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'selected'], true], 18, ['==', ['get', 'path'], true], 15, 12],
      'circle-color': 'rgba(255, 255, 255, 0)',
      'circle-stroke-color': ['case', ['==', ['get', 'selected'], true], '#f8fafc', ['==', ['get', 'path'], true], '#facc15', '#67e8f9'],
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 2.4, ['==', ['get', 'path'], true], 1.9, 1.6],
      'circle-opacity': ['case', ['==', ['get', 'selected'], true], 0.95, ['==', ['get', 'path'], true], 0.78, 0.68]
    }
  });

  addLayerIfMissing(map, {
    id: NODE_LAYER,
    type: 'circle',
    source: NODE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3,
        ['case', ['==', ['get', 'selected'], true], 7, ['==', ['get', 'path'], true], 6.1, ['==', ['get', 'observer'], true], 5.8, ['==', ['get', 'neighbor'], true], 5.4, 3],
        8,
        ['case', ['==', ['get', 'selected'], true], 8, ['==', ['get', 'path'], true], 7.1, ['==', ['get', 'observer'], true], 7.4, ['==', ['get', 'neighbor'], true], 6.4, 5.5],
        12,
        ['case', ['==', ['get', 'selected'], true], 9, ['==', ['get', 'path'], true], 8.1, ['==', ['get', 'observer'], true], 8.2, ['==', ['get', 'neighbor'], true], 7.2, 7]
      ],
      'circle-color': ['case', ['==', ['get', 'observer'], true], '#f59e0b', ['get', 'color']],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'selected'], true],
        '#ffffff',
        ['==', ['get', 'path'], true],
        '#facc15',
        ['==', ['get', 'observer'], true],
        '#fef3c7',
        ['==', ['get', 'neighbor'], true],
        '#67e8f9',
        'rgba(248, 250, 252, 0.82)'
      ],
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 2.2, ['==', ['get', 'path'], true], 1.95, ['==', ['get', 'observer'], true], 2, ['==', ['get', 'neighbor'], true], 1.7, 1.15],
      'circle-opacity': ['case', ['==', ['get', 'dimmed'], true], 0.28, ['==', ['get', 'observer'], true], 0.98, 0.9],
      'circle-stroke-opacity': ['case', ['==', ['get', 'dimmed'], true], 0.25, ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'path'], true], ['==', ['get', 'neighbor'], true], ['==', ['get', 'observer'], true]], 1, 0.86]
    }
  });

  addLayerIfMissing(map, {
    id: OBSERVER_LAYER,
    type: 'symbol',
    source: NODE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'observer'], true]],
    layout: {
      'icon-image': 'observer-node',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.42, 11, 0.58],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true
    },
    paint: {
      'icon-opacity': ['case', ['==', ['get', 'selected'], true], 1, ['==', ['get', 'dimmed'], true], 0.34, 0.94]
    }
  });

}

function addLayerIfMissing(map: maplibregl.Map, layer: maplibregl.LayerSpecification) {
  if (!map.getLayer(layer.id)) map.addLayer(layer);
}

function mapStyleSourcesReady(map: maplibregl.Map): boolean {
  try {
    return Boolean(map.getLayer('carto-dark') && map.getSource(NODE_SOURCE) && map.getSource(ROUTE_SOURCE) && map.getSource(CLUSTER_ACTIVITY_SOURCE));
  } catch {
    return false;
  }
}

function projectNodeLabels(
  map: maplibregl.Map,
  nodes: PublicNode[],
  focus: NodeFocus,
  now: number,
  meshActivityAtByNodeID: Map<string, number>,
  recentActivityByNodeID: Map<string, NodeActivity>
): ScreenNodeLabel[] {
  const zoom = map.getZoom();
  const { width, height } = mapViewportSize(map);
  if (!isDetailMode(map)) {
    return [];
  }
  const baseMaxLabels = zoom >= 10.2 ? 48 : zoom >= 9.2 ? 34 : zoom >= 8.4 ? 18 : 8;
  const maxLabels = Math.min(90, baseMaxLabels + focus.neighbourNodeIDs.size + focus.pathNodeIDs.size + (focus.selectedNodeID ? 1 : 0));
  const showInactiveLabels = zoom >= 8.8;
  const margin = 80;

  const projected = nodes
    .filter(isMappableNode)
    .map((node) => {
      const point = projectLngLat(map, node.longitude, node.latitude);
      const activityAt = meshActivityAtByNodeID.get(node.id);
      const ageMs = activityAt ? Math.max(0, now - activityAt) : Number.POSITIVE_INFINITY;
      const recentActive = ageMs <= NODE_LABEL_RECENT_VISIBLE_MS;
      const selected = node.id === focus.selectedNodeID;
      const neighbour = focus.neighbourNodeIDs.has(node.id);
      const path = focus.pathNodeIDs.has(node.id);
      const observer = node.isObserver === true;
      const distanceKm = focus.neighbourDistanceKmByNodeID.get(node.id);
      const recentActivity = recentActivityByNodeID.get(node.id);
      const frequencyHeat = nodeActivityHeat(recentActivity?.hits.length ?? 0);
      const activityProgress = recentActive ? nodeLabelActivityProgress(ageMs, NODE_LABEL_RECENT_VISIBLE_MS) : 0;
      const pulseGlow = activityProgress * 0.18;
      const glow = selected
        ? Math.max(0.58, pulseGlow)
        : path
          ? Math.max(0.46, pulseGlow)
        : neighbour
          ? Math.max(0.3, pulseGlow)
          : observer
            ? Math.max(0.52, pulseGlow)
            : pulseGlow;
      const ghostOpacity = showInactiveLabels ? (zoom >= 10 ? 0.12 : 0.055) : 0;
      const activeOpacity = recentActive ? ghostOpacity + 0.2 + activityProgress * 0.14 : ghostOpacity;
      const observerOpacity = observer ? Math.max(zoom >= 9 ? 0.72 : 0.58, activeOpacity) : activeOpacity;
      const opacity = selected
        ? 1
        : path
          ? 0.9
        : neighbour
          ? 0.88
          : observer
            ? observerOpacity
            : activeOpacity;
      const heat = Math.max(frequencyHeat * 0.35, pulseGlow * 0.5);
      const color = selected
        ? '#ffffff'
        : path
          ? '#facc15'
        : neighbour
          ? '#67e8f9'
          : observer
            ? '#fbbf24'
            : activityProgress > 0.28
              ? nodeLabelHeatColor(heat)
              : '#b8c7d9';
      const age = neighbour && distanceKm !== undefined
        ? `${nodeLastHeardAgeLabel(activityAt ?? node.lastSeen, now)} / ${formatDistanceKm(distanceKm)}`
        : nodeLastHeardAgeLabel(activityAt ?? node.lastSeen, now);
      return {
        id: node.id,
        name: compactNodeLabel(node.label, zoom >= 9.2 ? 20 : 16),
        age,
        x: point.x,
        y: point.y + (zoom >= 9 ? 13 : 11),
        selected,
        neighbour,
        path,
        observer,
        recentActive,
        color,
        opacity,
        glow,
        rank: (selected ? 1_000_000 : 0)
          + (neighbour ? 850_000 : 0)
          + (path ? 760_000 : 0)
          + (observer ? 520_000 : 0)
          + (recentActive ? 240_000 : 0)
          + Math.round(frequencyHeat * 2_500)
          + node.activityCount
      };
    });
  const inView = projected.filter((label) => label.x >= -margin && label.x <= width + margin && label.y >= -margin && label.y <= height + margin);
  const visible = inView.filter((label) => label.opacity > 0 && (label.selected || label.neighbour || label.path || label.observer || label.recentActive || showInactiveLabels));
  return visible
    .sort((a, b) => b.rank - a.rank)
    .slice(0, maxLabels)
    .map((label) => ({
      id: label.id,
      name: label.name,
      age: label.age,
      x: label.x,
      y: label.y,
      selected: label.selected,
      neighbour: label.neighbour,
      path: label.path,
      observer: label.observer,
      recentActive: label.recentActive,
      color: label.color,
      opacity: label.opacity,
      glow: label.glow
    }));
}

function nodeLabelHeatColor(value: number): string {
  const heat = Math.max(0, Math.min(1, value));
  if (heat > 0.78) return '#f59e0b';
  if (heat > 0.48) return '#2dd4bf';
  if (heat > 0.24) return '#38bdf8';
  return '#94a3b8';
}

function formatDistanceKm(distance: number): string {
  if (!Number.isFinite(distance)) return '';
  if (distance < 10) return `${distance.toFixed(1)} km`;
  return `${Math.round(distance)} km`;
}

function projectLngLat(map: maplibregl.Map, lng: number, lat: number): { x: number; y: number } {
  if (canUseMapProjection(map)) {
    try {
      const point = map.project([lng, lat]);
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) return point;
    } catch {
      // Fall through to the style-independent Web Mercator projection below.
    }
  }
  const center = map.getCenter();
  const scale = 512 * Math.pow(2, map.getZoom());
  const projected = mercatorPoint(lng, lat, scale);
  const projectedCenter = mercatorPoint(center.lng, center.lat, scale);
  const { width, height } = mapViewportSize(map);
  return {
    x: width / 2 + projected.x - projectedCenter.x,
    y: height / 2 + projected.y - projectedCenter.y
  };
}

function canUseMapProjection(map: maplibregl.Map): boolean {
  try {
    if (!map.loaded() || !map.isStyleLoaded()) return false;
    return (map.getStyle().layers?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

function mapViewportSize(map: maplibregl.Map): { width: number; height: number } {
  const canvas = map.getCanvas();
  const container = map.getContainer();
  return {
    width: canvas.clientWidth || container.clientWidth || window.innerWidth || 1,
    height: canvas.clientHeight || container.clientHeight || window.innerHeight || 1
  };
}

function mercatorPoint(lng: number, lat: number, scale: number): { x: number; y: number } {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
  };
}

function messageBubbleFromPulse(map: maplibregl.Map, pulse: PublicRoutePulse): MessageBubble | null {
  const first = pulse.segments[0];
  const anchor = pulse.messageAnchor ?? (first ? routeEndpointAnchor(first.from) : null);
  if (!anchor) return null;
  const visual = payloadVisual(pulse.payloadTypeName);
  const point = projectLngLat(map, anchor.lng, anchor.lat);
  const now = performance.now();
  const text = publicSafeMessage(pulse);
  return {
    id: `message-${anchor.nodeId ?? anchor.label}-${Math.floor(pulse.heardAt / 10_000)}-${hashBubbleText(text)}`,
    sender: compactNodeLabel(publicSafeSender(pulse, anchor.label), 28),
    text,
    lat: anchor.lat,
    lng: anchor.lng,
    x: clampMessageBubbleX(mapViewportSize(map).width, point.x),
    y: point.y - 14,
    color: visual.color,
    createdAt: now,
    expiresAt: now + MESSAGE_BUBBLE_LIFETIME_MS
  };
}

function visualReceivedAt(item: { heardAt: number; receivedAt?: number; displayAt?: number }): number {
  return item.displayAt ?? item.receivedAt ?? item.heardAt;
}

function messageBubbleFromObserverBurst(map: maplibregl.Map, burst: PublicObserverBurst): MessageBubble | null {
  const anchor = burst.messageAnchor ?? observerLocationAnchor(burst.location);
  if (!anchor) return null;
  const visual = payloadVisual(burst.payloadTypeName);
  const point = projectLngLat(map, anchor.lng, anchor.lat);
  const now = performance.now();
  const text = publicSafeMessage(burst);
  return {
    id: `message-${anchor.nodeId ?? anchor.label}-${Math.floor(burst.heardAt / 10_000)}-${hashBubbleText(text)}`,
    sender: compactNodeLabel(publicSafeSender(burst, anchor.label), 28),
    text,
    lat: anchor.lat,
    lng: anchor.lng,
    x: clampMessageBubbleX(mapViewportSize(map).width, point.x),
    y: point.y - 14,
    color: visual.color,
    createdAt: now,
    expiresAt: now + MESSAGE_BUBBLE_LIFETIME_MS
  };
}

function routeEndpointAnchor(endpoint: PublicRoutePulse['segments'][number]['from']): PublicMessageAnchor | null {
  if (!Number.isFinite(endpoint.lat) || !Number.isFinite(endpoint.lng)) return null;
  return { kind: 'source', nodeId: endpoint.nodeId, label: endpoint.label, lat: endpoint.lat, lng: endpoint.lng };
}

function observerLocationAnchor(location: PublicObserverBurst['location']): PublicMessageAnchor | null {
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;
  return { kind: 'observer', label: location.label, lat: location.lat, lng: location.lng };
}

function hashBubbleText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function publicSafeMessage(item: Pick<PublicRoutePulse, 'messageText' | 'payloadTypeName'>): string {
  const rawText = typeof item.messageText === 'string' ? item.messageText : '';
  if (rawText.trim()) return compactMessageText(rawText);
  return `${payloadVisual(item.payloadTypeName).label} message`;
}

function shouldShowMessageBubble(item: Pick<PublicRoutePulse, 'messageText' | 'payloadTypeName'>): boolean {
  const text = typeof item.messageText === 'string' ? item.messageText.trim() : '';
  if (!text) return false;
  return ['GROUP_TEXT', 'PLAIN_TEXT'].includes(normalizePayloadType(item.payloadTypeName));
}

function publicSafeSender(item: Pick<PublicRoutePulse, 'messageSender'>, fallback: string): string {
  const rawSender = typeof item.messageSender === 'string' ? item.messageSender : '';
  return compactMessageText(rawSender) || fallback;
}

function compactMessageText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function projectMessageBubbles(map: maplibregl.Map, bubbles: MessageBubble[], now: number): MessageBubble[] {
  const { width, height } = mapViewportSize(map);
  const margin = 140;
  return bubbles
    .filter((bubble) => bubble.expiresAt > now)
    .map((bubble) => {
      const point = projectLngLat(map, bubble.lng, bubble.lat);
      return {
        ...bubble,
        x: clampMessageBubbleX(width, point.x),
        y: point.y - 14
      };
    })
    .filter((bubble) => bubble.x >= -margin && bubble.x <= width + margin && bubble.y >= -margin && bubble.y <= height + margin);
}

function clampMessageBubbleX(viewportWidth: number, x: number): number {
  const usableWidth = Math.max(0, viewportWidth - MESSAGE_BUBBLE_EDGE_PADDING_PX * 2);
  const maxBubbleWidth = Math.min(MESSAGE_BUBBLE_MAX_WIDTH_PX, usableWidth);
  if (maxBubbleWidth <= 0) return x;
  const minX = MESSAGE_BUBBLE_EDGE_PADDING_PX + maxBubbleWidth / 2;
  const maxX = viewportWidth - MESSAGE_BUBBLE_EDGE_PADDING_PX - maxBubbleWidth / 2;
  if (minX > maxX) return viewportWidth / 2;
  return Math.max(minX, Math.min(maxX, x));
}

function isClusterMode(map: maplibregl.Map): boolean {
  return isClusterZoom(map.getZoom());
}

function isDetailMode(map: maplibregl.Map): boolean {
  return isDetailZoom(map.getZoom());
}

function handleVisualModeTransition(
  map: maplibregl.Map,
  modeRef: MutableRefObject<MapVisualMode>,
  clusterGlowsRef: MutableRefObject<Map<string, ClusterActivityGlow>>,
  clusterGlowTimerRef: MutableRefObject<number | null>,
  nodeActivitiesRef: MutableRefObject<Map<string, NodeActivity>>,
  nodeActivityTimerRef: MutableRefObject<number | null>,
  routeGlowsRef: MutableRefObject<Map<string, RoutePayloadGlow>>,
  routeGlowTimerRef: MutableRefObject<number | null>,
  animatorRef: MutableRefObject<PacketAnimator | null>
): MapVisualMode {
  const nextMode = visualModeForZoom(map.getZoom());
  if (nextMode === modeRef.current) return nextMode;
  modeRef.current = nextMode;
  if (nextMode === 'cluster') {
    clearDetailVisualState(map, nodeActivitiesRef.current, nodeActivityTimerRef, routeGlowsRef.current, routeGlowTimerRef, animatorRef);
  } else {
    clearClusterActivityGlowStates(map, clusterGlowsRef.current);
    stopClusterActivityGlowTimer(clusterGlowTimerRef);
  }
  return nextMode;
}

function clearDetailVisualState(
  map: maplibregl.Map,
  nodeActivities: Map<string, NodeActivity>,
  nodeActivityTimerRef: MutableRefObject<number | null>,
  routeGlows: Map<string, RoutePayloadGlow>,
  routeGlowTimerRef: MutableRefObject<number | null>,
  animatorRef: MutableRefObject<PacketAnimator | null>
) {
  animatorRef.current?.clear();
  clearNodeActivityStates(map, nodeActivities);
  stopNodeActivityTimer(nodeActivityTimerRef);
  clearRoutePayloadGlowStates(map, routeGlows);
  stopRoutePayloadGlowTimer(routeGlowTimerRef);
}

function addPulseClusterActivityGlow(map: maplibregl.Map, glows: Map<string, ClusterActivityGlow>, pulse: PublicRoutePulse): boolean {
  const now = performance.now();
  let changed = false;
  const seenAnchors = new Set<string>();
  for (const segment of pulse.segments) {
    for (const endpoint of [segment.from, segment.to]) {
      if (!Number.isFinite(endpoint.lat) || !Number.isFinite(endpoint.lng)) continue;
      const anchorKey = `${endpoint.lat.toFixed(4)}|${endpoint.lng.toFixed(4)}`;
      if (seenAnchors.has(anchorKey)) continue;
      seenAnchors.add(anchorKey);
      const target = resolveRenderedClusterTarget(map, endpoint.lng, endpoint.lat);
      if (!target) continue;
      upsertClusterActivityGlow(glows, target, pulse.payloadTypeName, now, CLUSTER_ACTIVITY_GLOW_MS);
      changed = true;
    }
  }
  if (changed) setClusterActivityGlowSource(map, glows, now);
  return changed;
}

function addObserverBurstClusterActivityGlow(map: maplibregl.Map, glows: Map<string, ClusterActivityGlow>, burst: PublicObserverBurst): boolean {
  if (!Number.isFinite(burst.location.lat) || !Number.isFinite(burst.location.lng)) return false;
  const target = resolveRenderedClusterTarget(map, burst.location.lng, burst.location.lat);
  if (!target) return false;
  const now = performance.now();
  upsertClusterActivityGlow(glows, target, burst.payloadTypeName, now, CLUSTER_ACTIVITY_GLOW_MS);
  setClusterActivityGlowSource(map, glows, now);
  return true;
}

function resolveRenderedClusterTarget(map: maplibregl.Map, lng: number, lat: number): ClusterActivityTarget | null {
  if (!map.getLayer(CLUSTER_LAYER)) return null;
  const point = projectLngLat(map, lng, lat);
  const radius = CLUSTER_ACTIVITY_QUERY_RADIUS_PX;
  let features: maplibregl.MapGeoJSONFeature[] = [];
  try {
    features = map.queryRenderedFeatures(
      [
        [point.x - radius, point.y - radius],
        [point.x + radius, point.y + radius]
      ] as any,
      { layers: [CLUSTER_LAYER] }
    );
  } catch {
    return null;
  }
  const candidates = features.flatMap((feature) => clusterTargetFromFeature(map, feature));
  return nearestClusterTarget(candidates, point.x, point.y);
}

function clusterTargetFromFeature(map: maplibregl.Map, feature: maplibregl.MapGeoJSONFeature): ClusterActivityTarget[] {
  const geometry = feature.geometry as { type?: string; coordinates?: unknown } | undefined;
  if (geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates)) return [];
  const [lng, lat] = geometry.coordinates;
  if (typeof lng !== 'number' || typeof lat !== 'number') return [];
  const properties = feature.properties ?? {};
  const clusterID = properties.cluster_id;
  if (clusterID === undefined || clusterID === null) return [];
  const pointCount = Number(properties.point_count ?? 0);
  const point = projectLngLat(map, lng, lat);
  return [{
    clusterID: typeof clusterID === 'number' || typeof clusterID === 'string' ? clusterID : String(clusterID),
    pointCount: Number.isFinite(pointCount) ? pointCount : 0,
    lng,
    lat,
    x: point.x,
    y: point.y
  }];
}

function setClusterActivityGlowSource(map: maplibregl.Map, glows: Map<string, ClusterActivityGlow>, now = performance.now()) {
  setSourceData(map, CLUSTER_ACTIVITY_SOURCE, clusterActivityGlowsToGeoJSON(glows, now) as FeatureCollection);
}

function startClusterActivityGlowTimer(
  map: maplibregl.Map,
  glowsRef: MutableRefObject<Map<string, ClusterActivityGlow>>,
  timerRef: MutableRefObject<number | null>
) {
  if (timerRef.current !== null) return;
  timerRef.current = window.setInterval(() => {
    const now = performance.now();
    const activeGlowCount = pruneClusterActivityGlows(glowsRef.current, now);
    setClusterActivityGlowSource(map, glowsRef.current, now);
    if (activeGlowCount === 0) stopClusterActivityGlowTimer(timerRef);
  }, CLUSTER_ACTIVITY_UPDATE_MS);
}

function stopClusterActivityGlowTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current === null) return;
  window.clearInterval(timerRef.current);
  timerRef.current = null;
}

function clearClusterActivityGlowStates(map: maplibregl.Map, glows: Map<string, ClusterActivityGlow>) {
  glows.clear();
  setSourceData(map, CLUSTER_ACTIVITY_SOURCE, emptyCollection());
}

function addPulseRoutePayloadGlow(map: maplibregl.Map, glows: Map<string, RoutePayloadGlow>, pulse: PublicRoutePulse) {
  const now = performance.now();
  const color = payloadVisual(pulse.payloadTypeName).color;
  const routeIDs = new Set(pulse.segments.map((segment) => segment.routeId).filter(Boolean));
  for (const routeID of routeIDs) {
    glows.set(routeID, { color, startedAt: now, expiresAt: now + ROUTE_PAYLOAD_GLOW_MS });
    safeSetRouteFeatureState(map, routeID, { payloadGlow: 1, payloadGlowColor: color });
  }
}

function updateRoutePayloadGlowFeatureStates(map: maplibregl.Map, glows: Map<string, RoutePayloadGlow>, now = performance.now()): number {
  let activeGlowCount = 0;
  for (const [routeID, glow] of glows.entries()) {
    const progress = Math.max(0, Math.min(1, (now - glow.startedAt) / ROUTE_PAYLOAD_GLOW_MS));
    const intensity = Math.pow(1 - progress, 0.72);
    if (now >= glow.expiresAt || intensity <= 0.01) {
      safeSetRouteFeatureState(map, routeID, { payloadGlow: 0, payloadGlowColor: glow.color });
      glows.delete(routeID);
      continue;
    }
    safeSetRouteFeatureState(map, routeID, { payloadGlow: intensity, payloadGlowColor: glow.color });
    activeGlowCount += 1;
  }
  return activeGlowCount;
}

function startRoutePayloadGlowTimer(
  map: maplibregl.Map,
  glowsRef: MutableRefObject<Map<string, RoutePayloadGlow>>,
  timerRef: MutableRefObject<number | null>
) {
  if (timerRef.current !== null) return;
  timerRef.current = window.setInterval(() => {
    const activeGlowCount = updateRoutePayloadGlowFeatureStates(map, glowsRef.current);
    if (activeGlowCount === 0) stopRoutePayloadGlowTimer(timerRef);
  }, ROUTE_PAYLOAD_GLOW_UPDATE_MS);
}

function stopRoutePayloadGlowTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current === null) return;
  window.clearInterval(timerRef.current);
  timerRef.current = null;
}

function clearRoutePayloadGlowStates(map: maplibregl.Map, glows: Map<string, RoutePayloadGlow>) {
  for (const [routeID, glow] of glows.entries()) {
    safeSetRouteFeatureState(map, routeID, { payloadGlow: 0, payloadGlowColor: glow.color });
  }
  glows.clear();
}

function addPulseNodeActivity(map: maplibregl.Map, activities: Map<string, NodeActivity>, pulse: PublicRoutePulse) {
  const now = performance.now();
  const cutoff = now - NODE_ACTIVITY_WINDOW_MS;
  const nodeIDs = new Set<string>();
  for (const segment of pulse.segments) {
    if (segment.from.nodeId) nodeIDs.add(segment.from.nodeId);
    if (segment.to.nodeId) nodeIDs.add(segment.to.nodeId);
  }
  for (const nodeID of nodeIDs) {
    addNodeActivityHit(activities, nodeID, now, cutoff);
  }
  updateNodeActivityFeatureStates(map, activities, now, nodeIDs);
}

function addPulseNodeMeshActivity(meshActivityAtByNodeID: Map<string, number>, pulse: PublicRoutePulse) {
  for (const segment of pulse.segments) {
    if (segment.from.nodeId) meshActivityAtByNodeID.set(segment.from.nodeId, pulse.heardAt);
    if (segment.to.nodeId) meshActivityAtByNodeID.set(segment.to.nodeId, pulse.heardAt);
  }
}

function addChangedNodeActivity(
  map: maplibregl.Map,
  activities: Map<string, NodeActivity>,
  telemetry: Map<string, NodeTelemetry>,
  meshActivityAtByNodeID: Map<string, number>,
  nodes: PublicNode[]
): boolean {
  const now = performance.now();
  const cutoff = now - NODE_ACTIVITY_WINDOW_MS;
  let changed = false;
  for (const node of nodes) {
    const previous = telemetry.get(node.id);
    telemetry.set(node.id, { lastSeen: node.lastSeen, activityCount: node.activityCount });
    if (!previous) continue;
    if (node.lastSeen > previous.lastSeen || node.activityCount > previous.activityCount) {
      addNodeActivityHit(activities, node.id, now, cutoff);
      meshActivityAtByNodeID.set(node.id, node.lastSeen);
      changed = true;
    }
  }
  if (changed) updateNodeActivityFeatureStates(map, activities, now);
  return changed;
}

function addNodeActivityHit(activities: Map<string, NodeActivity>, nodeID: string, now: number, cutoff: number) {
  const existing = activities.get(nodeID);
  const hits = (existing?.hits ?? []).filter((hitAt) => hitAt >= cutoff);
  hits.push(now);
  activities.set(nodeID, { hits, lastAt: now });
}

function updateNodeActivityFeatureStates(
  map: maplibregl.Map,
  activities: Map<string, NodeActivity>,
  now = performance.now(),
  nodeIDs?: Iterable<string>
): number {
  const cutoff = now - NODE_ACTIVITY_WINDOW_MS;
  let activeGlowCount = 0;
  const entries = nodeIDs
    ? Array.from(nodeIDs).map((nodeID) => [nodeID, activities.get(nodeID)] as const)
    : Array.from(activities.entries());
  for (const [nodeID, activity] of entries) {
    if (!activity) continue;
    activity.hits = activity.hits.filter((hitAt) => hitAt >= cutoff);
    const age = now - activity.lastAt;
    const glow = Math.max(0, Math.min(1, nodeActivityGlow(age)));
    const heat = nodeActivityHeat(activity.hits.length) * glow;
    safeSetNodeFeatureState(map, nodeID, { glow, heat });
    if (glow > 0.01) activeGlowCount += 1;
    if (glow <= 0 && activity.hits.length === 0) {
      activities.delete(nodeID);
    }
  }
  return activeGlowCount;
}

function startNodeActivityTimer(
  map: maplibregl.Map,
  activitiesRef: MutableRefObject<Map<string, NodeActivity>>,
  timerRef: MutableRefObject<number | null>
) {
  if (timerRef.current !== null) return;
  timerRef.current = window.setInterval(() => {
    const activeGlowCount = updateNodeActivityFeatureStates(map, activitiesRef.current);
    if (activeGlowCount === 0) stopNodeActivityTimer(timerRef);
  }, NODE_ACTIVITY_UPDATE_MS);
}

function stopNodeActivityTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current === null) return;
  window.clearInterval(timerRef.current);
  timerRef.current = null;
}

function clearNodeActivityStates(map: maplibregl.Map, activities: Map<string, NodeActivity>) {
  for (const nodeID of activities.keys()) {
    safeSetNodeFeatureState(map, nodeID, { glow: 0, heat: 0 });
  }
  activities.clear();
}

function safeSetNodeFeatureState(map: maplibregl.Map, nodeID: string, state: { glow: number; heat: number }) {
  if (!map.getSource(NODE_SOURCE)) return;
  try {
    map.setFeatureState({ source: NODE_SOURCE, id: nodeID }, state);
  } catch {
    // Source data can be swapped by search/filter updates while websocket events arrive.
  }
}

function safeSetRouteFeatureState(map: maplibregl.Map, routeID: string, state: { payloadGlow: number; payloadGlowColor: string }) {
  if (!map.getSource(ROUTE_SOURCE)) return;
  try {
    map.setFeatureState({ source: ROUTE_SOURCE, id: routeID }, state);
  } catch {
    // Source data can be swapped by state refreshes while websocket events arrive.
  }
}

function notifyAfterMapSettles(map: maplibregl.Map, callback: () => void) {
  let called = false;
  const finish = () => {
    if (called) return;
    called = true;
    window.requestAnimationFrame(callback);
  };
  const fallback = window.setTimeout(finish, 1200);
  map.once('idle', () => {
    window.clearTimeout(fallback);
    finish();
  });
}

function markPositionedNodesReady(
  map: maplibregl.Map,
  nodes: PublicNode[],
  fitInitialNodesRef: MutableRefObject<boolean>,
  positionedNodesReadyRef: MutableRefObject<boolean>,
  positionedNodesRenderedRef: MutableRefObject<() => void>
) {
  if (nodes.length === 0) return;
  if (!fitInitialNodesRef.current) {
    fitInitialNodesRef.current = true;
    fitToNodes(map, nodes, 0);
  }
  if (!positionedNodesReadyRef.current) {
    positionedNodesReadyRef.current = true;
    notifyAfterMapSettles(map, () => positionedNodesRenderedRef.current());
  }
}

function bindLayerEvents(
  map: maplibregl.Map,
  nodesRef: MutableRefObject<PublicNode[]>,
  selectedNodeRef: MutableRefObject<(nodeID: string) => void>,
  selectedRouteRef: MutableRefObject<(routeID: string) => void>,
  plotModeRef: MutableRefObject<'off' | 'node' | 'area'>,
  plotNodePickRef: MutableRefObject<(nodeID: string) => void>,
  plotMapPointRef: MutableRefObject<(point: { lat: number; lng: number }) => void>,
  clearSelectionRef: MutableRefObject<() => void>,
  setHoveredRouteID: Dispatch<SetStateAction<string | null>>,
  setHoveredNode: Dispatch<SetStateAction<HoveredNodeToast | null>>
) {
  const expandClusterFeature = async (feature: maplibregl.MapGeoJSONFeature | undefined) => {
    const typedFeature = feature as any;
    const clusterID = typedFeature?.properties?.cluster_id;
    const coordinates = typedFeature?.geometry?.coordinates;
    if (typeof clusterID !== 'number' || !coordinates) return false;
    const source = map.getSource(NODE_SOURCE) as any;
    const zoom = await source.getClusterExpansionZoom(clusterID);
    map.easeTo({ center: coordinates, zoom, duration: 600 });
    return true;
  };
  const handleNodePointerMove = (event: maplibregl.MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    const id = feature?.properties?.id;
    if (typeof id !== 'string') return;
    const node = nodesRef.current.find((item) => item.id === id);
    if (!node) return;
    const container = map.getContainer();
    const toastWidth = 250;
    const toastHeight = 120;
    const x = Math.max(12, Math.min(event.point.x + 14, container.clientWidth - toastWidth - 12));
    const belowY = event.point.y + 14;
    const y = belowY + toastHeight < container.clientHeight ? belowY : Math.max(12, event.point.y - toastHeight - 14);
    setHoveredNode((current) => {
      if (current?.node.id === node.id && Math.abs(current.x - x) < 3 && Math.abs(current.y - y) < 3) return current;
      return { node, x, y };
    });
  };
  map.on('click', async (event) => {
    const nodeLayers = [OBSERVER_LAYER, NODE_LAYER].filter((layerID) => map.getLayer(layerID));
    const nodeFeature = nodeLayers.length > 0
      ? map.queryRenderedFeatures(event.point, { layers: nodeLayers }).find((feature) => typeof feature.properties?.id === 'string')
      : undefined;
    const nodeID = nodeFeature?.properties?.id;
    if (typeof nodeID === 'string') {
      if (plotModeRef.current === 'node') {
        plotNodePickRef.current(nodeID);
        return;
      }
      selectedNodeRef.current(nodeID);
      return;
    }

    if (plotModeRef.current === 'area') {
      const lngLat = event.lngLat;
      plotMapPointRef.current({ lat: lngLat.lat, lng: lngLat.lng });
      return;
    }

    const clusterLayers = [CLUSTER_COUNT_LAYER, CLUSTER_LAYER].filter((layerID) => map.getLayer(layerID));
    const clusterFeature = clusterLayers.length > 0
      ? map.queryRenderedFeatures(event.point, { layers: clusterLayers })[0]
      : undefined;
    if (await expandClusterFeature(clusterFeature)) return;

    const routeLayers = [ROUTE_HIT_LAYER].filter((layerID) => map.getLayer(layerID));
    const routeFeature = routeLayers.length > 0
      ? map.queryRenderedFeatures(event.point, { layers: routeLayers }).find((feature) => typeof feature.properties?.id === 'string')
      : undefined;
    const routeID = routeFeature?.properties?.id;
    if (typeof routeID === 'string') {
      if (plotModeRef.current === 'node') return;
      selectedRouteRef.current(routeID);
      return;
    }

    clearSelectionRef.current();
  });
  map.on('mousemove', NODE_LAYER, handleNodePointerMove);
  map.on('mousemove', OBSERVER_LAYER, handleNodePointerMove);
  map.on('mouseleave', NODE_LAYER, () => setHoveredNode(null));
  map.on('mouseleave', OBSERVER_LAYER, () => setHoveredNode(null));
  map.on('mousemove', ROUTE_HIT_LAYER, (event) => {
    const nodeLayers = [OBSERVER_LAYER, NODE_LAYER].filter((layerID) => map.getLayer(layerID));
    if (nodeLayers.length > 0 && map.queryRenderedFeatures(event.point, { layers: nodeLayers }).length > 0) {
      setHoveredRouteID(null);
      return;
    }
    const feature = event.features?.[0];
    const id = feature?.properties?.id;
    if (typeof id === 'string') {
      setHoveredRouteID((current) => (current === id ? current : id));
    }
  });
  map.on('mouseleave', ROUTE_HIT_LAYER, () => {
    setHoveredRouteID(null);
  });
  for (const layer of [CLUSTER_LAYER, CLUSTER_COUNT_LAYER, NODE_LAYER, OBSERVER_LAYER, ROUTE_HIT_LAYER]) {
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = '';
    });
  }
}

function NodeHoverToast({ hovered, now }: { hovered: HoveredNodeToast; now: number }) {
  const { node, x, y } = hovered;
  const regions = node.iatasHeardIn.length > 0 ? node.iatasHeardIn.slice(0, 4).join(', ') : 'No region';
  return (
    <div className="node-hover-toast" style={{ left: x, top: y }}>
      <strong>{node.label}</strong>
      <span>{formatNodeRole(node.role)} - {regions}</span>
      <dl>
        <div>
          <dt>Last heard</dt>
          <dd>{nodeLastHeardAgeLabel(node.lastSeen, now).replace(/^last /, '')}</dd>
        </div>
        <div>
          <dt>Packets</dt>
          <dd>{node.activityCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Observer</dt>
          <dd>{node.isObserver ? 'Yes' : 'No'}</dd>
        </div>
      </dl>
    </div>
  );
}

function formatNodeRole(role: string): string {
  if (role === 'room_server') return 'Room';
  if (role === 'repeater') return 'Repeater';
  if (role === 'companion') return 'Companion';
  if (role === 'sensor') return 'Sensor';
  return 'Unknown';
}

function nodesToGeoJSON(
  nodes: PublicNode[],
  focus: NodeFocus,
  labelClock: number,
  meshActivityAtByNodeID: Map<string, number>
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: nodes.filter(isMappableNode).map((node) => ({
      type: 'Feature',
      id: node.id,
      properties: nodeFeatureProperties(node, focus, labelClock, meshActivityAtByNodeID),
      geometry: { type: 'Point', coordinates: [node.longitude, node.latitude] }
    }))
  };
}

function nodeFeatureProperties(
  node: PublicNode,
  focus: NodeFocus,
  labelClock: number,
  meshActivityAtByNodeID: Map<string, number>
) {
  const selected = node.id === focus.selectedNodeID;
  const neighbor = focus.neighbourNodeIDs.has(node.id);
  const path = focus.pathNodeIDs.has(node.id);
  const focusActive = Boolean(focus.selectedNodeID) || focus.pathNodeIDs.size > 0;
  return {
    id: node.id,
    label: node.label,
    mapLabel: nodeMapLabel(node, labelClock, meshActivityAtByNodeID.get(node.id)),
    role: node.role,
    color: nodeRoleColor(node.role),
    selected,
    neighbor,
    path,
    focused: selected || neighbor || path,
    dimmed: focusActive && !selected && !neighbor && !path,
    neighborDistanceKm: focus.neighbourDistanceKmByNodeID.get(node.id) ?? null,
    recentActive: recentNodeActivity(node.id, labelClock, meshActivityAtByNodeID),
    observer: node.isObserver === true
  };
}

function recentNodeActivity(nodeID: string, now: number, meshActivityAtByNodeID: Map<string, number>): boolean {
  const activityAt = meshActivityAtByNodeID.get(nodeID);
  return Number.isFinite(activityAt) && activityAt !== undefined && now - activityAt <= NODE_ACTIVE_LABEL_VISIBLE_MS;
}

function routesToGeoJSON(
  routes: PublicRoute[],
  selectedRouteID: string | null,
  hoveredRouteID: string | null,
  focus: NodeFocus
): FeatureCollection {
  const hasFocusedRoute = Boolean(selectedRouteID || hoveredRouteID || focus.selectedNodeID || focus.pathRouteIDs.size > 0);
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((route) => isMappableEndpoint(route.from) && isMappableEndpoint(route.to))
      .map((route) => {
        const selected = route.id === selectedRouteID;
        const hovered = route.id === hoveredRouteID;
        const connected = focus.connectedRouteIDs.has(route.id);
        const path = focus.pathRouteIDs.has(route.id);
        return {
          type: 'Feature',
          id: route.id,
          properties: {
            id: route.id,
            color: routeColors[Math.max(0, Math.min(4, route.frequencyBucket))],
            selected,
            hovered,
            path,
            connected,
            dimmed: hasFocusedRoute && !selected && !hovered && !path && !connected
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [route.from.lng, route.from.lat],
              [route.to.lng, route.to.lat]
            ]
          }
        };
      })
  };
}

function setSourceData(map: maplibregl.Map, sourceID: string, data: FeatureCollection) {
  const source = map.getSource(sourceID) as maplibregl.GeoJSONSource | undefined;
  source?.setData(data as any);
}

function mapViewFromMap(map: maplibregl.Map): MapViewState {
  const center = map.getCenter();
  return { lat: center.lat, lng: center.lng, z: map.getZoom() };
}

function fitToNodes(map: maplibregl.Map, nodes: PublicNode[], duration: number) {
  const points = nodes.filter(isMappableNode).map((node) => [node.longitude, node.latitude] as [number, number]);
  if (points.length === 0) return;
  const bounds = points.reduce((acc, point) => acc.extend(point), new maplibregl.LngLatBounds(points[0], points[0]));
  map.fitBounds(bounds, { padding: 76, maxZoom: 5.4, duration });
}

function fitToRoute(map: maplibregl.Map, route: PublicRoute, duration: number) {
  const points: Array<[number, number]> = [
    [route.from.lng, route.from.lat],
    [route.to.lng, route.to.lat]
  ];
  const bounds = points.reduce((acc, point) => acc.extend(point), new maplibregl.LngLatBounds(points[0], points[0]));
  map.fitBounds(bounds, { padding: 120, maxZoom: 10.5, duration });
}

function followTrafficPulse(
  map: maplibregl.Map,
  pulse: PublicRoutePulse,
  enabled: boolean,
  stateRef: MutableRefObject<{ lastAt: number; lastID: string }>,
  immediate = false
) {
  if (!enabled) return;
  const points = routePulsePoints(pulse);
  followTrafficTarget(map, pulse.id, points, stateRef, immediate);
}

function followTrafficObserverBurst(
  map: maplibregl.Map,
  burst: PublicObserverBurst,
  enabled: boolean,
  stateRef: MutableRefObject<{ lastAt: number; lastID: string }>,
  immediate = false
) {
  if (!enabled) return;
  followTrafficTarget(map, burst.id, [[burst.location.lng, burst.location.lat]], stateRef, immediate);
}

function followTrafficTarget(
  map: maplibregl.Map,
  id: string,
  points: Array<[number, number]>,
  stateRef: MutableRefObject<{ lastAt: number; lastID: string }>,
  immediate: boolean
) {
  const usablePoints = points.filter(isFollowPoint);
  if (usablePoints.length === 0) return;
  const now = Date.now();
  const state = stateRef.current;
  if (state.lastID === id) return;
  if (!immediate && now - state.lastAt < FOLLOW_TRAFFIC_MIN_INTERVAL_MS) return;
  state.lastAt = now;
  state.lastID = id;
  map.stop();
  if (usablePoints.length === 1) {
    const currentZoom = map.getZoom();
    const zoom = Math.max(FOLLOW_TRAFFIC_POINT_ZOOM, Math.min(currentZoom, FOLLOW_TRAFFIC_ROUTE_MAX_ZOOM + 0.7));
    map.easeTo({
      center: usablePoints[0],
      zoom,
      duration: immediate ? 900 : FOLLOW_TRAFFIC_DURATION_MS,
      easing: easeOutCubic
    });
    return;
  }
  const bounds = usablePoints.reduce((acc, point) => acc.extend(point), new maplibregl.LngLatBounds(usablePoints[0], usablePoints[0]));
  map.fitBounds(bounds, {
    padding: followTrafficPadding(map),
    maxZoom: FOLLOW_TRAFFIC_ROUTE_MAX_ZOOM,
    duration: immediate ? 950 : FOLLOW_TRAFFIC_DURATION_MS,
    easing: easeOutCubic
  });
}

function routePulsePoints(pulse: PublicRoutePulse): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const segment of pulse.segments) {
    points.push([segment.from.lng, segment.from.lat], [segment.to.lng, segment.to.lat]);
  }
  return points;
}

function isFollowPoint(point: [number, number]): boolean {
  const [lng, lat] = point;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52;
}

function followTrafficPadding(map: maplibregl.Map): maplibregl.PaddingOptions {
  const container = map.getContainer();
  const width = container.clientWidth;
  if (width <= 760) {
    return { top: 188, right: 30, bottom: 210, left: 30 };
  }
  return {
    top: 150,
    right: Math.min(360, Math.round(width * 0.24)),
    bottom: 84,
    left: Math.min(360, Math.round(width * 0.24))
  };
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function addGeneratedNodeIcons(map: maplibregl.Map) {
  const specs = [
    ['node-repeater', '#22c55e', 'diamond'],
    ['node-companion', '#3b82f6', 'triangle'],
    ['node-room_server', '#a855f7', 'square'],
    ['node-sensor', '#65a30d', 'pentagon'],
    ['node-unknown', '#64748b', 'circle'],
    ['observer-node', '#f59e0b', 'observer']
  ] as const;
  for (const [name, color, shape] of specs) {
    if (!map.hasImage(name)) map.addImage(name, createIcon(color, shape), { pixelRatio: 2 });
  }
}

function createIcon(color: string, shape: 'diamond' | 'triangle' | 'square' | 'pentagon' | 'circle' | 'observer') {
  const size = shape === 'observer' ? 64 : 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('icon canvas unavailable');
  ctx.clearRect(0, 0, size, size);
  if (shape === 'observer') {
    ctx.strokeStyle = 'rgba(254, 243, 199, 0.98)';
    ctx.fillStyle = 'rgba(245, 158, 11, 0.95)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(32, 32, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(254, 243, 199, 0.88)';
    ctx.lineWidth = 3;
    for (const radius of [22, 29]) {
      ctx.beginPath();
      ctx.arc(32, 32, radius, -0.78, 0.78);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(32, 32, radius, Math.PI - 0.78, Math.PI + 0.78);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(32, 32, 4, 0, Math.PI * 2);
    ctx.fill();
    return ctx.getImageData(0, 0, size, size);
  }
  ctx.fillStyle = 'rgba(3, 7, 18, 0.86)';
  ctx.beginPath();
  ctx.arc(24, 24, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.82)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (shape === 'diamond') {
    ctx.moveTo(24, 9);
    ctx.lineTo(39, 24);
    ctx.lineTo(24, 39);
    ctx.lineTo(9, 24);
    ctx.closePath();
  } else if (shape === 'triangle') {
    ctx.moveTo(24, 8);
    ctx.lineTo(40, 38);
    ctx.lineTo(8, 38);
    ctx.closePath();
  } else if (shape === 'square') {
    ctx.rect(11, 11, 26, 26);
  } else if (shape === 'pentagon') {
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      const x = 24 + Math.cos(angle) * 16;
      const y = 24 + Math.sin(angle) * 16;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else {
    ctx.arc(24, 24, 13, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

function nodeRoleColor(role: string) {
  if (role === 'repeater') return '#22c55e';
  if (role === 'companion') return '#3b82f6';
  if (role === 'room_server') return '#a855f7';
  if (role === 'sensor') return '#65a30d';
  return '#64748b';
}

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
