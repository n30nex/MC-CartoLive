import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import maplibregl from 'maplibre-gl';
import type { PublicMapConfig, PublicMessageAnchor, PublicNode, PublicObserverBurst, PublicRoute, PublicRoutePulse } from '../types';
import { parseSharedView, type MapViewState, type SharedViewState } from '../shareView';
import { payloadVisual } from '../payloadVisuals';
import { NODE_ROLE_VISUALS, OBSERVER_NODE_VISUAL, nodeMapImageID, nodeRoleColor } from '../nodeVisuals';
import { isMappableNode } from './geo';
import { activityHeatmapToGeoJSON } from './activityHeatmap';
import { analysisRoutesToGeoJSON } from './analysisRoutes';
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
import { nodeSourceSignature } from './nodeSource';
import { PacketAnimator } from './packetAnimator';
import { DEFAULT_MAP_LAYER_SETTINGS, DEFAULT_PACKET_VISUAL_SETTINGS, type MapLayerSettings, type PacketVisualSettings } from '../mapSettings';
import {
  compactNodeLabel,
  NODE_ACTIVITY_UPDATE_MS,
  NODE_ACTIVITY_WINDOW_MS,
  NODE_LABEL_UPDATE_MS,
  nodeLabelActivityProgress,
  nodeActivityGlow,
  nodeActivityHeat,
  nodeEffectiveActivityAt,
  nodeLastHeardAgeLabel,
  nodeMapLabel,
  nodeStaleLevel
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
import {
  pruneRoutePayloadGlows,
  routeColorSignature,
  routeColorForBucket,
  routePayloadGlowsToGeoJSON,
  routeSourceSignature,
  routesToGeoJSON,
  type RoutePayloadGlow
} from './routeSource';
import { easeLinear, easeOutCubic, fitToNodes, fitToRoute, fitToSegments, followTrafficPadding, isFollowPoint, mapViewFromMap, mapViewportSize } from './mapCamera';
import { buildPacketReplayChasePath, replayChaseCameraFrame } from './packetReplayChase';
import {
  ROUTE_GIF_FPS,
  ROUTE_GIF_FRAMES,
  ROUTE_GIF_HEIGHT,
  ROUTE_GIF_WIDTH,
  createRouteMapGifBlob,
  drawRouteMapGifOverlay,
  type RouteMapGifExportRequest
} from '../routeGifExport';
import { setSourceData, type FeatureCollection } from './sourceDataQueue';
import { DETAIL_MIN_ZOOM, NODE_CLUSTER_MAX_ZOOM, type MapVisualMode, isClusterZoom, isDetailZoom, visualModeForZoom } from './zoomMode';
import {
  FOLLOW_TRAFFIC_POINT_ZOOM,
  FOLLOW_TRAFFIC_ROUTE_MAX_ZOOM,
  followTrafficDecision,
  type FollowTrafficState
} from './followTraffic';
import type { OpenFreeMap3DController } from './openFreeMap3D';

export type MapAction =
  | { type: 'reset'; token: number }
  | { type: 'latest-route'; token: number }
  | { type: 'route'; token: number; routeID: string }
  | { type: 'node'; token: number; nodeID: string }
  | { type: 'packet'; token: number; segments: PublicRoutePulse['segments'] }
  | { type: 'packet-replay'; token: number; segments: PublicRoutePulse['segments']; pulse: PublicRoutePulse; settleMs: number; travelDurationMs: number }
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
  analysisSegments: PublicRoutePulse['segments'];
  layerSettings: MapLayerSettings;
  packetVisualSettings: PacketVisualSettings;
  plotMode: 'off' | 'node' | 'area';
  mapAction: MapAction;
  routeGifExportRequest: RouteMapGifExportRequest | null;
  baseMode: MapBaseMode;
  themeMode: MapThemeMode;
  initialView: SharedViewState | null;
  mapConfig?: PublicMapConfig | null;
  loading: boolean;
  onPositionedNodesRendered: () => void;
  onViewChange: (view: MapViewState) => void;
  onSelectNode: (nodeID: string) => void;
  onPlotNodePick: (nodeID: string) => void;
  onPlotMapPoint: (point: { lat: number; lng: number }) => void;
  onClearSelection: () => void;
}

type NodeActivity = {
  hits: number[];
  lastAt: number;
};

type NodeTelemetry = {
  lastSeen: number;
  activityCount: number;
};

type HoveredNodeToast = {
  node: PublicNode;
  x: number;
  y: number;
  lastHeardAt: number;
};

type ScreenNodeLabel = {
  id: string;
  name: string;
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
const ACTIVITY_HEATMAP_SOURCE = 'activity-heatmap';
const ACTIVITY_HEATMAP_LAYER = 'activity-heatmap-glow';
const ACTIVITY_SPARKLE_LAYER = 'activity-heatmap-sparkles';
const CLUSTER_ACTIVITY_SOURCE = 'cluster-activity-glows';
const CLUSTER_ACTIVITY_AURA_LAYER = 'cluster-activity-aura';
const CLUSTER_ACTIVITY_RING_LAYER = 'cluster-activity-ring';
const CLUSTER_LAYER = 'node-clusters';
const CLUSTER_COUNT_LAYER = 'node-cluster-counts';
const CLUSTER_ROLE_BADGE_LAYER_PREFIX = 'node-cluster-role';
const ROUTE_GLOW_LAYER = 'route-focus-glow';
const ANALYSIS_ROUTE_SOURCE = 'analysis-route-paths';
export const ANALYSIS_ROUTE_GLOW_LAYER = 'analysis-route-overview-glow';
export const ANALYSIS_ROUTE_LAYER = 'analysis-route-overview-line';
const ROUTE_PAYLOAD_GLOW_SOURCE = 'route-payload-glows';
const ROUTE_PAYLOAD_GLOW_LAYER = 'route-payload-glow';
const NODE_HALO_LAYER = 'selected-node-halo';
const NODE_LAYER = 'node-symbols';
const NODE_ICON_LAYER = 'node-role-icons';
const OBSERVER_LAYER = 'observer-symbols';
const ROUTE_LAYER = 'route-lines';
const CARTO_DARK_SOURCE = 'carto-dark-tiles';
const CARTO_DARK_LAYER = 'carto-dark';
const CARTO_LIGHT_SOURCE = 'carto-light-tiles';
const CARTO_LIGHT_LAYER = 'carto-light';
const OPENFREEMAP_SOURCE = 'openfreemap-planet';
const TERRAIN_SOURCE = 'meshcore-terrain-dem';
const HILLSHADE_SOURCE = 'meshcore-hillshade-dem';
const HILLSHADE_LAYER = 'meshcore-topographic-hillshade';
const BUILDINGS_3D_LAYER = 'openfreemap-3d-buildings';
const OBSERVER_LABEL_LAYER = 'observer-map-labels';
const WEATHER_CLOUD_SOURCE = 'meshcore-weather-clouds';
const WEATHER_CLOUD_LAYER = 'meshcore-weather-cloud-overlay';
const NODE_ACTIVE_LABEL_VISIBLE_MS = 24_000;
const NODE_LABEL_RECENT_VISIBLE_MS = 90_000;
const MESSAGE_BUBBLE_LIFETIME_MS = 7_200;
const MESSAGE_BUBBLE_MAX_WIDTH_PX = 440;
const MESSAGE_BUBBLE_EDGE_PADDING_PX = 16;
const ROUTE_PAYLOAD_GLOW_MS = 5_200;
const ROUTE_PAYLOAD_GLOW_UPDATE_MS = 160;
const ROUTE_VISUAL_CADENCE_MS = 125;
const OBSERVER_VISUAL_CADENCE_MS = 95;
const MAX_PENDING_ROUTE_VISUALS = 220;
const MAX_PENDING_OBSERVER_VISUALS = 360;
const DEFAULT_ORIGINAL_MAP_PITCH = 0;
const DEFAULT_ORIGINAL_MAP_BEARING = 0;
const DEFAULT_OPENFREEMAP_MAP_PITCH = 46;
const DEFAULT_OPENFREEMAP_MAP_BEARING = -11;
const DEFAULT_OPENFREEMAP_STYLE_URL = '';
const DEFAULT_OPENFREEMAP_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const DEFAULT_TERRAIN_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const DEFAULT_WORLD_CENTER = { lat: 20, lng: 0, z: 1.8 };
const OPENFREEMAP_STYLE_URL = envURL('VITE_OPENFREEMAP_STYLE_URL', DEFAULT_OPENFREEMAP_STYLE_URL);
const OPENFREEMAP_TILEJSON_URL = envURL('VITE_OPENFREEMAP_TILEJSON_URL', DEFAULT_OPENFREEMAP_TILEJSON_URL);
const TERRAIN_TILE_URL = envURL('VITE_TERRAIN_TILE_URL', DEFAULT_TERRAIN_TILE_URL);
const TERRAIN_EXAGGERATION = envFloat('VITE_TERRAIN_EXAGGERATION', 1.25);
const WEATHER_API_KEY = (import.meta.env['VITE_OPENWEATHERMAP_API_KEY'] as string | undefined)?.trim() || '';

export type MapBaseMode = 'original' | 'openfreemap';
export type MapThemeMode = 'dark' | 'light';

const ROUTE_FOCUS_FILTER: any = ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'path'], true], ['==', ['get', 'connected'], true]];
type ClusterRoleBadge = {
  key: string;
  property: 'repeaterCount' | 'companionCount' | 'roomCount' | 'observerCount' | 'otherCount';
  color: string;
  translate: [number, number];
};

const CLUSTER_ROLE_BADGES: ClusterRoleBadge[] = [
  { key: 'repeater', property: 'repeaterCount', color: '#26E07F', translate: [-20, 15] },
  { key: 'companion', property: 'companionCount', color: '#4DA6FF', translate: [0, 24] },
  { key: 'room', property: 'roomCount', color: '#B26BFF', translate: [20, 15] },
  { key: 'observer', property: 'observerCount', color: '#FFB347', translate: [0, -25] },
  { key: 'other', property: 'otherCount', color: '#94A3B8', translate: [20, -12] }
];

function nodeClusterProperties() {
  return {
    repeaterCount: ['+', ['case', ['==', ['get', 'role'], 'repeater'], 1, 0]],
    companionCount: ['+', ['case', ['==', ['get', 'role'], 'companion'], 1, 0]],
    roomCount: ['+', ['case', ['==', ['get', 'role'], 'room_server'], 1, 0]],
    observerCount: ['+', ['case', ['==', ['get', 'observer'], true], 1, 0]],
    otherCount: ['+', ['case', ['all', ['!=', ['get', 'observer'], true], ['any', ['==', ['get', 'role'], 'sensor'], ['==', ['get', 'role'], 'unknown']]], 1, 0]]
  };
}

function clusterRoleBadgeCircleLayers(): maplibregl.LayerSpecification[] {
  return CLUSTER_ROLE_BADGES.map((badge) => ({
    id: `${CLUSTER_ROLE_BADGE_LAYER_PREFIX}-${badge.key}-dot`,
    type: 'circle',
    source: NODE_SOURCE,
    maxzoom: DETAIL_MIN_ZOOM,
    filter: ['all', ['has', 'point_count'], ['>', ['coalesce', ['get', badge.property], 0], 0]],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 7.2, 7, 9.5],
      'circle-color': badge.color,
      'circle-translate': badge.translate,
      'circle-stroke-color': 'rgba(255, 255, 255, 0.92)',
      'circle-stroke-width': 1.25,
      'circle-opacity': 0.96
    }
  }));
}

function clusterRoleBadgeTextLayers(): maplibregl.LayerSpecification[] {
  return CLUSTER_ROLE_BADGES.map((badge) => ({
    id: `${CLUSTER_ROLE_BADGE_LAYER_PREFIX}-${badge.key}-count`,
    type: 'symbol',
    source: NODE_SOURCE,
    maxzoom: DETAIL_MIN_ZOOM,
    filter: ['all', ['has', 'point_count'], ['>', ['coalesce', ['get', badge.property], 0], 0]],
    layout: {
      'text-field': ['case', ['>', ['coalesce', ['get', badge.property], 0], 99], '99+', ['to-string', ['coalesce', ['get', badge.property], 0]]],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 7.2, 7, 8.4],
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-allow-overlap': true,
      'text-ignore-placement': true
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': '#020617',
      'text-halo-width': 1.2,
      'text-halo-blur': 0.2,
      'text-translate': badge.translate
    }
  }));
}

function activityHeatmapLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: ACTIVITY_HEATMAP_LAYER,
      type: 'heatmap',
      source: ACTIVITY_HEATMAP_SOURCE,
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', 'intensity'], 0], 0, 0, 1, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, 0.42, 7, 0.72, 12, 0.38],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 22, 7, 42, 12, 64],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.42, 9, 0.34, 13, 0.12, 15, 0],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(0, 0, 0, 0)',
          0.18,
          'rgba(20, 184, 166, 0.16)',
          0.42,
          'rgba(56, 189, 248, 0.24)',
          0.68,
          'rgba(250, 204, 21, 0.3)',
          1,
          'rgba(244, 63, 94, 0.38)'
        ]
      }
    },
    {
      id: ACTIVITY_SPARKLE_LAYER,
      type: 'circle',
      source: ACTIVITY_HEATMAP_SOURCE,
      paint: {
        'circle-color': ['coalesce', ['get', 'color'], '#67e8f9'],
        'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'spark'], 0], 0, 0.6, 1, 4.8],
        'circle-blur': 0.55,
        'circle-opacity': ['*', ['coalesce', ['get', 'spark'], 0], 0.58],
        'circle-stroke-width': 0
      }
    }
  ];
}

const NODE_CIRCLE_COLOR: any = [
  'case',
  ['==', ['get', 'observer'], true],
  '#FFB347',
  ['==', ['get', 'staleLevel'], 2],
  '#243142',
  ['==', ['get', 'staleLevel'], 1],
  '#64748b',
  ['get', 'color']
];

const NODE_CIRCLE_STROKE_COLOR: any = [
  'case',
  ['==', ['get', 'selected'], true],
  '#ffffff',
  ['==', ['get', 'path'], true],
  '#facc15',
  ['==', ['get', 'observer'], true],
  '#fff7ed',
  ['==', ['get', 'neighbor'], true],
  '#67e8f9',
  ['==', ['get', 'staleLevel'], 2],
  'rgba(148, 163, 184, 0.28)',
  ['==', ['get', 'staleLevel'], 1],
  'rgba(203, 213, 225, 0.45)',
  'rgba(248, 250, 252, 0.82)'
];

const NODE_CIRCLE_OPACITY: any = [
  'case',
  ['==', ['get', 'dimmed'], true],
  0.24,
  ['==', ['get', 'observer'], true],
  0.96,
  ['==', ['get', 'staleLevel'], 2],
  0.4,
  ['==', ['get', 'staleLevel'], 1],
  0.58,
  0.9
];

export const originalMapStyle: maplibregl.StyleSpecification = {
  version: 8,
  projection: { type: 'mercator' },
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    [CARTO_DARK_SOURCE]: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }
  },
  layers: [
    {
      id: 'map-background',
      type: 'background',
      paint: { 'background-color': '#05070b' }
    },
    {
      id: CARTO_DARK_LAYER,
      type: 'raster',
      source: CARTO_DARK_SOURCE,
      minzoom: 0,
      maxzoom: 20
    }
  ]
};

export const lightOriginalMapStyle: maplibregl.StyleSpecification = {
  version: 8,
  projection: { type: 'mercator' },
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    [CARTO_LIGHT_SOURCE]: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }
  },
  layers: [
    {
      id: 'map-background',
      type: 'background',
      paint: { 'background-color': '#eef5fb' }
    },
    {
      id: CARTO_LIGHT_LAYER,
      type: 'raster',
      source: CARTO_LIGHT_SOURCE,
      minzoom: 0,
      maxzoom: 20
    }
  ]
};

export const mapOverlayStyle: maplibregl.StyleSpecification = {
  version: 8,
  projection: { type: 'mercator' },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    [OPENFREEMAP_SOURCE]: {
      type: 'vector',
      url: OPENFREEMAP_TILEJSON_URL
    },
    [TERRAIN_SOURCE]: {
      type: 'raster-dem',
      tiles: [TERRAIN_TILE_URL],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15
    },
    [HILLSHADE_SOURCE]: {
      type: 'raster-dem',
      tiles: [TERRAIN_TILE_URL],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15
    },
    [NODE_SOURCE]: {
      type: 'geojson',
      data: emptyCollection() as any,
      cluster: true,
      clusterMaxZoom: NODE_CLUSTER_MAX_ZOOM,
      clusterRadius: 58,
      clusterProperties: nodeClusterProperties()
    } as any,
    [ACTIVITY_HEATMAP_SOURCE]: {
      type: 'geojson',
      data: emptyCollection() as any
    },
    [ROUTE_SOURCE]: {
      type: 'geojson',
      data: emptyCollection() as any
    },
    [ANALYSIS_ROUTE_SOURCE]: {
      type: 'geojson',
      data: emptyCollection() as any
    },
    [ROUTE_PAYLOAD_GLOW_SOURCE]: {
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
      paint: { 'background-color': '#030712' }
    },
    {
      id: 'dark-landcover-wood',
      type: 'fill',
      source: OPENFREEMAP_SOURCE,
      'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'],
      paint: {
        'fill-color': '#0f2a21',
        'fill-opacity': 0.58
      }
    },
    {
      id: 'dark-landcover-grass',
      type: 'fill',
      source: OPENFREEMAP_SOURCE,
      'source-layer': 'landcover',
      filter: ['match', ['get', 'class'], ['grass', 'wetland'], true, false],
      paint: {
        'fill-color': '#15331f',
        'fill-opacity': 0.4
      }
    },
    {
      id: 'dark-park',
      type: 'fill',
      source: OPENFREEMAP_SOURCE,
      'source-layer': 'park',
      paint: {
        'fill-color': '#12351f',
        'fill-opacity': 0.62
      }
    },
    {
      id: 'dark-landuse',
      type: 'fill',
      source: OPENFREEMAP_SOURCE,
      'source-layer': 'landuse',
      filter: ['match', ['get', 'class'], ['residential', 'industrial', 'commercial', 'school', 'hospital'], true, false],
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'industrial',
          '#182033',
          'commercial',
          '#1e1b2f',
          'school',
          '#172538',
          'hospital',
          '#2b1720',
          '#111827'
        ],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.22, 13, 0.55]
      }
    },
    {
      id: 'dark-water',
      type: 'fill',
      source: OPENFREEMAP_SOURCE,
      'source-layer': 'water',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: {
        'fill-color': '#0b2440'
      }
    },
    {
      id: 'dark-waterway',
      type: 'line',
      source: OPENFREEMAP_SOURCE,
      'source-layer': 'waterway',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#1d4f7a',
        'line-opacity': 0.82,
        'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 8, 0.5, 14, 1.3, 18, 4]
      }
    },
    {
      id: HILLSHADE_LAYER,
      type: 'hillshade',
      source: HILLSHADE_SOURCE,
      paint: {
        'hillshade-method': 'multidirectional',
        'hillshade-highlight-color': ['#1e293b', '#334155', '#475569', '#64748b'],
        'hillshade-shadow-color': ['#020617', '#08111f', '#0f172a', '#1e293b'],
        'hillshade-illumination-direction': [270, 315, 0, 45],
        'hillshade-illumination-altitude': [24, 30, 36, 28],
        'hillshade-exaggeration': 0.54
      } as any
    },
    {
      id: 'dark-boundary',
      type: 'line',
      source: OPENFREEMAP_SOURCE,
      'source-layer': 'boundary',
      filter: ['all', ['<=', ['coalesce', ['get', 'admin_level'], 99], 4], ['!=', ['get', 'maritime'], 1]],
      paint: {
        'line-color': '#475569',
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.36, 6, 0.8],
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 8, 1.5, 12, 2.4]
      }
    },
    {
      id: 'dark-road-casing',
      type: 'line',
      source: OPENFREEMAP_SOURCE,
      'source-layer': 'transportation',
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#020617',
        'line-opacity': 0.72,
        'line-width': ['interpolate', ['exponential', 1.45], ['zoom'], 5, 0.5, 10, 1.2, 14, 5, 18, 18]
      }
    },
    {
      id: 'dark-road',
      type: 'line',
      source: OPENFREEMAP_SOURCE,
      'source-layer': 'transportation',
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match',
          ['get', 'class'],
          'motorway',
          '#a16207',
          'trunk',
          '#854d0e',
          'primary',
          '#713f12',
          'secondary',
          '#334155',
          'tertiary',
          '#263449',
          '#1f2937'
        ],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.45, 12, 0.86],
        'line-width': ['interpolate', ['exponential', 1.35], ['zoom'], 5, 0.3, 10, 0.8, 14, 3.2, 18, 12]
      }
    },
    {
      id: 'dark-rail',
      type: 'line',
      source: OPENFREEMAP_SOURCE,
      'source-layer': 'transportation',
      filter: ['match', ['get', 'class'], ['rail', 'transit'], true, false],
      paint: {
        'line-color': '#64748b',
        'line-opacity': 0.64,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 16, 1.4]
      }
    },
    {
      id: 'dark-place-labels',
      type: 'symbol',
      source: OPENFREEMAP_SOURCE,
      'source-layer': 'place',
      filter: ['match', ['get', 'class'], ['city', 'town', 'village', 'state', 'country'], true, false],
      layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 7, 14, 12, 18],
        'text-max-width': 8
      },
      paint: {
        'text-color': '#cbd5e1',
        'text-halo-color': '#020617',
        'text-halo-width': 1.6,
        'text-halo-blur': 0.4
      }
    },
    {
      id: ANALYSIS_ROUTE_GLOW_LAYER,
      type: 'line',
      source: ANALYSIS_ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 2.4, 5, 7, 8, 12, 11],
        'line-blur': ['interpolate', ['linear'], ['zoom'], 2.4, 4, 10, 7],
        'line-opacity': ['coalesce', ['get', 'glowOpacity'], 0.24]
      }
    },
    {
      id: ANALYSIS_ROUTE_LAYER,
      type: 'line',
      source: ANALYSIS_ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 2.4, 2.4, 7, 3.6, 12, 5.2],
        'line-opacity': ['coalesce', ['get', 'opacity'], 0.86]
      }
    },
    ...activityHeatmapLayers(),
    {
      id: ROUTE_GLOW_LAYER,
      type: 'line',
      source: ROUTE_SOURCE,
      minzoom: DETAIL_MIN_ZOOM,
      filter: ROUTE_FOCUS_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': [
          'case',
          ['==', ['get', 'selected'], true],
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
          ['==', ['get', 'selected'], true],
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
      source: ROUTE_PAYLOAD_GLOW_SOURCE,
      minzoom: 2.5,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 2.5, ['*', ['coalesce', ['get', 'glowWidth'], 6], 0.55], 7, ['coalesce', ['get', 'glowWidth'], 6], 13, ['*', ['coalesce', ['get', 'glowWidth'], 6], 1.45]],
        'line-blur': 4,
        'line-opacity': ['coalesce', ['get', 'opacity'], 0]
      }
    },
    {
      id: ROUTE_LAYER,
      type: 'line',
      source: ROUTE_SOURCE,
      minzoom: DETAIL_MIN_ZOOM,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': [
          'case',
          ['==', ['get', 'selected'], true],
          ROUTE_ACTIVE_WIDTH,
          ['==', ['get', 'path'], true],
          ROUTE_PATH_WIDTH,
          ['==', ['get', 'connected'], true],
          ROUTE_CONNECTED_WIDTH,
          ['coalesce', ['get', 'routeWidth'], ROUTE_BASE_WIDTH]
        ],
        'line-opacity': [
          'case',
          ['==', ['get', 'selected'], true],
          ROUTE_ACTIVE_OPACITY,
          ['==', ['get', 'path'], true],
          ROUTE_PATH_OPACITY,
          ['==', ['get', 'connected'], true],
          ROUTE_CONNECTED_OPACITY,
          ['==', ['get', 'dimmed'], true],
          ['*', ROUTE_DIMMED_OPACITY, ['coalesce', ['get', 'routeOpacity'], ROUTE_BASE_OPACITY]],
          ['coalesce', ['get', 'routeOpacity'], ROUTE_BASE_OPACITY]
        ]
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
        'circle-color': ['step', ['get', 'point_count'], '#164e63', 25, '#166534', 75, '#9a3412'],
        'circle-radius': ['step', ['get', 'point_count'], 17, 25, 22, 75, 28],
        'circle-stroke-width': ['step', ['get', 'point_count'], 1.9, 25, 2.3, 75, 2.8],
        'circle-stroke-color': 'rgba(255, 255, 255, 0.9)',
        'circle-opacity': 0.94,
        'circle-blur': 0.04
      }
    },
    ...clusterRoleBadgeCircleLayers(),
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
    ...clusterRoleBadgeTextLayers(),
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
          ['case', ['==', ['get', 'selected'], true], 7, ['==', ['get', 'path'], true], 6.1, ['==', ['get', 'observer'], true], 5.8, ['==', ['get', 'neighbor'], true], 5.4, 3],
          8,
          ['case', ['==', ['get', 'selected'], true], 8, ['==', ['get', 'path'], true], 7.1, ['==', ['get', 'observer'], true], 7.4, ['==', ['get', 'neighbor'], true], 6.4, 5.5],
          12,
          ['case', ['==', ['get', 'selected'], true], 9, ['==', ['get', 'path'], true], 8.1, ['==', ['get', 'observer'], true], 8.2, ['==', ['get', 'neighbor'], true], 7.2, 7]
        ],
        'circle-color': NODE_CIRCLE_COLOR,
        'circle-stroke-color': NODE_CIRCLE_STROKE_COLOR,
        'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 2.2, ['==', ['get', 'path'], true], 1.95, ['==', ['get', 'observer'], true], 2, ['==', ['get', 'neighbor'], true], 1.7, 1.15],
        'circle-opacity': NODE_CIRCLE_OPACITY,
        'circle-stroke-opacity': ['case', ['==', ['get', 'dimmed'], true], 0.22, ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'path'], true], ['==', ['get', 'neighbor'], true], ['==', ['get', 'observer'], true]], 1, ['==', ['get', 'staleLevel'], 2], 0.34, ['==', ['get', 'staleLevel'], 1], 0.52, 0.86]
      }
    },
    {
      id: NODE_ICON_LAYER,
      type: 'symbol',
      source: NODE_SOURCE,
      minzoom: DETAIL_MIN_ZOOM,
      filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'observer'], true]],
      layout: {
        'icon-image': [
          'match',
          ['get', 'role'],
          'repeater',
          nodeMapImageID('repeater'),
          'companion',
          nodeMapImageID('companion'),
          'room_server',
          nodeMapImageID('room_server'),
          'sensor',
          nodeMapImageID('sensor'),
          nodeMapImageID('unknown')
        ],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.34, 11, 0.5],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      },
      paint: {
        'icon-opacity': ['case', ['==', ['get', 'selected'], true], 1, ['==', ['get', 'dimmed'], true], 0.3, ['==', ['get', 'staleLevel'], 2], 0.55, 0.92]
      }
    },
    {
      id: OBSERVER_LAYER,
      type: 'symbol',
      source: NODE_SOURCE,
      minzoom: DETAIL_MIN_ZOOM,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'observer'], true]],
      layout: {
        'icon-image': OBSERVER_NODE_VISUAL.mapImageID,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.42, 11, 0.58],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      },
      paint: {
        'icon-opacity': ['case', ['==', ['get', 'selected'], true], 1, ['==', ['get', 'dimmed'], true], 0.34, 0.94]
      }
    },
    {
      id: OBSERVER_LABEL_LAYER,
      type: 'symbol',
      source: NODE_SOURCE,
      minzoom: DETAIL_MIN_ZOOM,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'observer'], true]],
      layout: {
        'text-field': ['get', 'mapLabel'],
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 11, 12],
        'text-anchor': 'top',
        'text-offset': [0, 1.3],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-rotation-alignment': 'viewport',
        'text-pitch-alignment': 'viewport'
      },
      paint: {
        'text-color': '#fbbf24',
        'text-halo-color': 'rgba(2, 6, 23, 0.85)',
        'text-halo-width': 1.2,
        'text-opacity': ['case', ['==', ['get', 'dimmed'], true], 0.28, 0.55]
      }
    }
  ]
};

export const lightMapOverlayStyle: maplibregl.StyleSpecification = {
  ...mapOverlayStyle,
  layers: mapOverlayStyle.layers.map(lightOverlayLayer)
};

export const openFreeMapStyle: string | maplibregl.StyleSpecification = OPENFREEMAP_STYLE_URL || mapOverlayStyle;
export const mapStyle: string | maplibregl.StyleSpecification = originalMapStyle;

function openFreeMapStyleForTheme(themeMode: MapThemeMode): string | maplibregl.StyleSpecification {
  if (OPENFREEMAP_STYLE_URL) return OPENFREEMAP_STYLE_URL;
  return themeMode === 'light' ? lightMapOverlayStyle : mapOverlayStyle;
}

function mapStyleForMode(mode: MapBaseMode, themeMode: MapThemeMode): string | maplibregl.StyleSpecification {
  if (mode === 'openfreemap') return openFreeMapStyleForTheme(themeMode);
  return themeMode === 'light' ? lightOriginalMapStyle : originalMapStyle;
}

function ensureMercatorProjection(map: maplibregl.Map) {
  try {
    map.setProjection({ type: 'mercator' });
  } catch {
    // Older or externally supplied styles may already be locked to Mercator.
  }
}

function customLayerProjectionReady(map: maplibregl.Map): boolean {
  const projection = (map as any).style?.projection;
  return Boolean(projection?.shaderPreludeCode?.vertexSource);
}

function supportsOpenFreeMapCustom3D(map: maplibregl.Map): boolean {
  if (typeof window !== 'undefined') {
    if (window.innerWidth < 700 || window.innerHeight < 520) return false;
    if (window.matchMedia?.('(pointer: coarse)').matches) return false;
  }
  const canvas = map.getCanvas();
  return canvas.clientWidth >= 700 && canvas.clientHeight >= 520;
}

function lightOverlayLayer(layer: maplibregl.LayerSpecification): maplibregl.LayerSpecification {
  const next = { ...layer, paint: { ...((layer as any).paint ?? {}) } } as any;
  switch (layer.id) {
    case 'map-background':
      next.paint['background-color'] = '#eef5fb';
      break;
    case 'dark-landcover-wood':
      next.paint['fill-color'] = '#c7ead4';
      next.paint['fill-opacity'] = 0.5;
      break;
    case 'dark-landcover-grass':
      next.paint['fill-color'] = '#d9f0d2';
      next.paint['fill-opacity'] = 0.42;
      break;
    case 'dark-park':
      next.paint['fill-color'] = '#c8ead0';
      next.paint['fill-opacity'] = 0.58;
      break;
    case 'dark-landuse':
      next.paint['fill-color'] = [
        'match',
        ['get', 'class'],
        'industrial',
        '#e5e7eb',
        'commercial',
        '#f3e8ff',
        'school',
        '#dbeafe',
        'hospital',
        '#ffe4e6',
        '#edf2f7'
      ];
      next.paint['fill-opacity'] = ['interpolate', ['linear'], ['zoom'], 6, 0.2, 13, 0.55];
      break;
    case 'dark-water':
      next.paint['fill-color'] = '#b9ddf2';
      break;
    case 'dark-waterway':
      next.paint['line-color'] = '#60a5ca';
      next.paint['line-opacity'] = 0.78;
      break;
    case HILLSHADE_LAYER:
      next.paint['hillshade-highlight-color'] = ['#ffffff', '#f8fafc', '#dbeafe', '#bfdbfe'];
      next.paint['hillshade-shadow-color'] = ['#94a3b8', '#cbd5e1', '#d1d5db', '#e5e7eb'];
      next.paint['hillshade-exaggeration'] = 0.44;
      break;
    case 'dark-boundary':
      next.paint['line-color'] = '#64748b';
      next.paint['line-opacity'] = ['interpolate', ['linear'], ['zoom'], 2, 0.42, 6, 0.82];
      break;
    case 'dark-road-casing':
      next.paint['line-color'] = '#ffffff';
      next.paint['line-opacity'] = 0.72;
      break;
    case 'dark-road':
      next.paint['line-color'] = [
        'match',
        ['get', 'class'],
        'motorway',
        '#d97706',
        'trunk',
        '#f59e0b',
        'primary',
        '#eab308',
        'secondary',
        '#94a3b8',
        'tertiary',
        '#a8b5c7',
        '#cbd5e1'
      ];
      next.paint['line-opacity'] = ['interpolate', ['linear'], ['zoom'], 4, 0.48, 12, 0.88];
      break;
    case 'dark-rail':
      next.paint['line-color'] = '#64748b';
      next.paint['line-opacity'] = 0.54;
      break;
    case 'dark-place-labels':
      next.paint['text-color'] = '#0f172a';
      next.paint['text-halo-color'] = '#ffffff';
      next.paint['text-halo-width'] = 1.7;
      break;
    case CLUSTER_COUNT_LAYER:
      next.paint['text-color'] = '#f8fafc';
      next.paint['text-halo-color'] = '#0f172a';
      break;
    default:
      return layer;
  }
  return next as maplibregl.LayerSpecification;
}

function defaultPitchForMode(mode: MapBaseMode): number {
  return mode === 'openfreemap' ? DEFAULT_OPENFREEMAP_MAP_PITCH : DEFAULT_ORIGINAL_MAP_PITCH;
}

function defaultBearingForMode(mode: MapBaseMode): number {
  return mode === 'openfreemap' ? DEFAULT_OPENFREEMAP_MAP_BEARING : DEFAULT_ORIGINAL_MAP_BEARING;
}

function defaultMapViewFromConfig(config?: PublicMapConfig | null): MapViewState {
  const center = config?.defaultCenter;
  const lng = Array.isArray(center) && Number.isFinite(center[0]) ? center[0] : DEFAULT_WORLD_CENTER.lng;
  const lat = Array.isArray(center) && Number.isFinite(center[1]) ? center[1] : DEFAULT_WORLD_CENTER.lat;
  const z = Number.isFinite(config?.defaultZoom) ? Number(config?.defaultZoom) : DEFAULT_WORLD_CENTER.z;
  return { lat, lng, z };
}

function CanadaMap({
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
  analysisSegments,
  layerSettings = DEFAULT_MAP_LAYER_SETTINGS,
  packetVisualSettings = DEFAULT_PACKET_VISUAL_SETTINGS,
  plotMode,
  mapAction,
  routeGifExportRequest,
  baseMode,
  themeMode,
  initialView,
  mapConfig,
  loading,
  onPositionedNodesRendered,
  onViewChange,
  onSelectNode,
  onPlotNodePick,
  onPlotMapPoint,
  onClearSelection
}: Props) {
  const [hoveredNode, setHoveredNode] = useState<HoveredNodeToast | null>(null);
  const [screenNodeLabels, setScreenNodeLabels] = useState<ScreenNodeLabel[]>([]);
  const [messageBubbles, setMessageBubbles] = useState<MessageBubble[]>([]);
  const initialDefaultView = defaultMapViewFromConfig(mapConfig);
  const [mapZoom, setMapZoom] = useState(initialDefaultView.z);
  const [mapCenter, setMapCenter] = useState({ lat: initialDefaultView.lat, lng: initialDefaultView.lng });
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
  const openFreeMap3DRef = useRef<OpenFreeMap3DController | null>(null);
  const openFreeMap3DImportRef = useRef<Promise<void> | null>(null);
  const loadedRef = useRef(false);
  const layerEventsBoundRef = useRef(false);
  const initialViewAppliedRef = useRef(false);
  const fitInitialNodesRef = useRef(false);
  const positionedNodesReadyRef = useRef(false);
  const seenPulseIDsRef = useRef<Set<string>>(new Set());
  const seenObserverBurstIDsRef = useRef<Set<string>>(new Set());
  const pendingPulsesRef = useRef<PublicRoutePulse[]>([]);
  const pendingObserverBurstsRef = useRef<PublicObserverBurst[]>([]);
  const followTrafficRef = useRef(followTraffic);
  const followTrafficStateRef = useRef<FollowTrafficState>({ lastAt: 0, lastID: '' });
  const themeModeRef = useRef<MapThemeMode>(themeMode);
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
  const nodeSourceSignatureRef = useRef('');
  const mapVisualModeRef = useRef<MapVisualMode>(visualModeForZoom(initialView?.z ?? 3.35));
  const nodeLabelFrameRef = useRef<number | null>(null);
  const messageBubbleCleanupTimersRef = useRef<Map<string, number>>(new Map());
  const shownBubbleTextsRef = useRef<Set<string>>(new Set());
  const pageHiddenRef = useRef(typeof document !== 'undefined' ? document.hidden : false);
  const pausedRef = useRef(paused);
  const initialViewRef = useRef(initialView);
  const mapConfigRef = useRef(mapConfig);
  const mapConfigAppliedRef = useRef(false);
  const baseModeRef = useRef<MapBaseMode>(baseMode);
  const nodesRef = useRef(nodes);
  const routesRef = useRef(routes);
  const selectedNodeIDRef = useRef(selectedNodeID);
  const selectedRouteIDRef = useRef(selectedRouteID);
  const nodeFocusRef = useRef(nodeFocus);
  const analysisSegmentsRef = useRef(analysisSegments);
  const layerSettingsRef = useRef(layerSettings);
  const packetVisualSettingsRef = useRef(packetVisualSettings);
  const routeSourceSignatureRef = useRef('');
  const analysisRouteSignatureRef = useRef('');
  const replayActionTimerRef = useRef<number | null>(null);
  const replayChaseTimerRef = useRef<number | null>(null);
  const replayChaseCleanupRef = useRef<(() => void) | null>(null);
  const routeGifExportCleanupRef = useRef<(() => void) | null>(null);
  const routeColorSignatureRef = useRef('');
  const positionedNodesRenderedRef = useRef(onPositionedNodesRendered);
  const viewChangeRef = useRef(onViewChange);
  const selectedNodeRef = useRef(onSelectNode);
  const plotModeRef = useRef(plotMode);
  const plotNodePickRef = useRef(onPlotNodePick);
  const plotMapPointRef = useRef(onPlotMapPoint);
  const clearSelectionRef = useRef(onClearSelection);

  const destroyOpenFreeMap3D = () => {
    openFreeMap3DRef.current?.destroy();
    openFreeMap3DRef.current = null;
  };

  const stopReplayChaseCamera = () => {
    if (replayChaseTimerRef.current !== null) {
      window.clearTimeout(replayChaseTimerRef.current);
      replayChaseTimerRef.current = null;
    }
    replayChaseCleanupRef.current?.();
    replayChaseCleanupRef.current = null;
  };

  const updateOpenFreeMap3D = () => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const enabled = baseModeRef.current === 'openfreemap'
      && supportsOpenFreeMapCustom3D(map)
      && (layerSettingsRef.current.nodeModels3D || layerSettingsRef.current.routeArcs3D || layerSettingsRef.current.packetComets3D);
    if (!enabled) {
      destroyOpenFreeMap3D();
      return;
    }
    const applyUpdate = (controller: OpenFreeMap3DController) => {
      controller.setPaused(pausedRef.current || pageHiddenRef.current);
      controller.update({
        nodes: nodesRef.current,
        routes: routesRef.current,
        focus: nodeFocusRef.current,
        selectedRouteID: selectedRouteIDRef.current,
        analysisSegments: analysisSegmentsRef.current,
        layerSettings: layerSettingsRef.current,
        packetVisualSettings: packetVisualSettingsRef.current,
        themeMode: themeModeRef.current
      });
    };
    if (openFreeMap3DRef.current) {
      applyUpdate(openFreeMap3DRef.current);
      return;
    }
    if (openFreeMap3DImportRef.current) return;
    openFreeMap3DImportRef.current = import('./openFreeMap3D')
      .then(({ createOpenFreeMap3DController, OPENFREEMAP_3D_LAYER_ID }) => {
        openFreeMap3DImportRef.current = null;
        const currentMap = mapRef.current;
        if (!currentMap || currentMap !== map || baseModeRef.current !== 'openfreemap' || !loadedRef.current) return;
        if (!supportsOpenFreeMapCustom3D(currentMap)) return;
        ensureMercatorProjection(currentMap);
        if (!customLayerProjectionReady(currentMap)) {
          window.setTimeout(updateOpenFreeMap3D, 120);
          return;
        }
        const controller = createOpenFreeMap3DController();
        openFreeMap3DRef.current = controller;
        if (!currentMap.getLayer(OPENFREEMAP_3D_LAYER_ID)) {
          try {
            currentMap.addLayer(controller.layer, currentMap.getLayer(NODE_HALO_LAYER) ? NODE_HALO_LAYER : undefined);
          } catch (error) {
            openFreeMap3DRef.current = null;
            controller.destroy();
            setMapInitError(`OpenFreeMap 3D warning: ${error instanceof Error ? error.message : String(error)}`);
            return;
          }
        }
        applyUpdate(controller);
      })
      .catch((error) => {
        openFreeMap3DImportRef.current = null;
        setMapInitError(`OpenFreeMap 3D warning: ${error instanceof Error ? error.message : String(error)}`);
      });
  };

  const addPulseTo3D = (map: maplibregl.Map, pulse: PublicRoutePulse, options: { force?: boolean } = {}) => {
    const allowLowZoom = options.force === true || packetVisualSettingsRef.current.showLiveCometsAtAllZooms;
    if (baseModeRef.current !== 'openfreemap' || !layerSettingsRef.current.packetComets3D || !layerSettingsRef.current.liveComets || (!allowLowZoom && !isDetailMode(map))) return false;
    updateOpenFreeMap3D();
    return openFreeMap3DRef.current?.addPulse(pulse, options) === true;
  };

  const startReplayChaseCamera = (map: maplibregl.Map, segments: PublicRoutePulse['segments'], travelDurationMs: number) => {
    if (baseModeRef.current !== 'openfreemap' || segments.length === 0) return;
    const path = buildPacketReplayChasePath(segments);
    if (path.totalDistanceKm <= 0 || path.points.length < 2) return;
    stopReplayChaseCamera();
    let cancelled = false;
    const canvas = map.getCanvas();
    const cancel = () => {
      cancelled = true;
      stopReplayChaseCamera();
    };
    canvas.addEventListener('pointerdown', cancel, { once: true });
    canvas.addEventListener('wheel', cancel, { once: true });
    replayChaseCleanupRef.current = () => {
      canvas.removeEventListener('pointerdown', cancel);
      canvas.removeEventListener('wheel', cancel);
    };

    const steps = Math.max(12, Math.min(34, Math.round(travelDurationMs / 260)));
    const stepMs = Math.max(170, Math.round(travelDurationMs / steps));
    const zoomAtStart = map.getZoom();
    let index = 0;
    const step = () => {
      if (cancelled || !mapRef.current) return;
      const progress = Math.min(0.985, index / Math.max(1, steps));
      const frame = replayChaseCameraFrame(path, progress, zoomAtStart);
      map.easeTo({
        center: [frame.center.lng, frame.center.lat],
        bearing: frame.bearing,
        pitch: frame.pitch,
        zoom: frame.zoom,
        duration: stepMs + 60,
        essential: true,
        easing: easeLinear
      });
      index += 1;
      if (index <= steps) {
        replayChaseTimerRef.current = window.setTimeout(step, stepMs);
      } else {
        replayChaseTimerRef.current = null;
        replayChaseCleanupRef.current?.();
        replayChaseCleanupRef.current = null;
      }
    };
    step();
  };

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
    if (pausedRef.current) return;
    const shouldAnimate = shouldAnimateLiveEvent(visualReceivedAt(pulse), Date.now(), pageHiddenRef.current);
    if (!map) return;
    if (shouldAnimate) followTrafficPulse(map, pulse, followTrafficRef.current, followTrafficStateRef);
    const renderComet = shouldAnimate
      && layerSettingsRef.current.liveComets
      && (packetVisualSettingsRef.current.showLiveCometsAtAllZooms || isDetailMode(map));
    if (shouldAnimate && layerSettingsRef.current.messageBubbles && shouldShowMessageBubble(pulse)) {
      const text = publicSafeMessage(pulse);
      const key = `pulse:${hashBubbleText(text)}`;
      if (!shownBubbleTextsRef.current.has(key)) {
        shownBubbleTextsRef.current.add(key);
        showMessageBubble(map, messageBubbleFromPulse(map, pulse));
      }
    }
    addPulseNodeActivity(map, nodeActivityRef.current, pulse);
    addPulseNodeMeshActivity(nodeMeshActivityAtRef.current, pulse);
    setActivityHeatmapSource(map, nodesRef.current, nodeActivityRef.current, nodeMeshActivityAtRef.current);
    if (isClusterMode(map)) {
      if (renderComet && !addPulseTo3D(map, pulse)) animatorRef.current?.add(pulse);
      if (shouldAnimate && layerSettingsRef.current.observerBursts && addPulseClusterActivityGlow(map, clusterActivityGlowRef.current, pulse)) {
        startClusterActivityGlowTimer(map, clusterActivityGlowRef, clusterActivityGlowTimerRef);
      }
      setScreenNodeLabels([]);
      return;
    }
    if (renderComet && !addPulseTo3D(map, pulse)) animatorRef.current?.add(pulse);
    if (shouldAnimate && layerSettingsRef.current.analysisPaths) {
      addPulseRoutePayloadGlow(routePayloadGlowRef.current, pulse);
      setRoutePayloadGlowSource(map, routesRef.current, routePayloadGlowRef.current, selectedRouteIDRef.current, nodeFocusRef.current);
      startRoutePayloadGlowTimer(map, routesRef, routePayloadGlowRef, selectedRouteIDRef, nodeFocusRef, routePayloadGlowTimerRef);
    }
    if (layerSettingsRef.current.nodeLabels) {
      setScreenNodeLabels(projectNodeLabels(map, nodesRef.current, nodeFocusRef.current, pulse.heardAt, nodeMeshActivityAtRef.current, nodeActivityRef.current));
    }
    startNodeActivityTimer(map, nodeActivityRef, nodeActivityTimerRef, nodesRef, nodeMeshActivityAtRef);
  };

  const renderScheduledObserverBurst = (burst: PublicObserverBurst) => {
    const map = mapRef.current;
    if (pausedRef.current) return;
    const shouldAnimate = shouldAnimateLiveEvent(visualReceivedAt(burst), Date.now(), pageHiddenRef.current);
    if (map && shouldAnimate) followTrafficObserverBurst(map, burst, followTrafficRef.current, followTrafficStateRef);
    if (map && shouldAnimate && layerSettingsRef.current.messageBubbles && shouldShowMessageBubble(burst)) {
      const text = publicSafeMessage(burst);
      const key = `burst:${hashBubbleText(text)}`;
      if (!shownBubbleTextsRef.current.has(key)) {
        shownBubbleTextsRef.current.add(key);
        showMessageBubble(map, messageBubbleFromObserverBurst(map, burst));
      }
    }
    if (map && isClusterMode(map)) {
      if (shouldAnimate && layerSettingsRef.current.observerBursts && addObserverBurstClusterActivityGlow(map, clusterActivityGlowRef.current, burst)) {
        startClusterActivityGlowTimer(map, clusterActivityGlowRef, clusterActivityGlowTimerRef);
      }
      return;
    }
    if (shouldAnimate && layerSettingsRef.current.observerBursts && !(baseModeRef.current === 'openfreemap' && openFreeMap3DRef.current?.addObserverBurst(burst))) {
      animatorRef.current?.addObserverBurst(burst);
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
    mapConfigRef.current = mapConfig;
    const map = mapRef.current;
    if (!map || initialViewRef.current || mapConfigAppliedRef.current || !mapConfig) return;
    const view = defaultMapViewFromConfig(mapConfig);
    mapConfigAppliedRef.current = true;
    map.easeTo({ center: [view.lng, view.lat], zoom: view.z, duration: 0 });
  }, [mapConfig]);

  useEffect(() => {
    routesRef.current = routes;
  }, [routes]);

  useEffect(() => {
    selectedNodeIDRef.current = selectedNodeID;
  }, [selectedNodeID]);

  useEffect(() => {
    selectedRouteIDRef.current = selectedRouteID;
  }, [selectedRouteID]);

  useEffect(() => {
    nodeFocusRef.current = nodeFocus;
  }, [nodeFocus]);

  useEffect(() => {
    analysisSegmentsRef.current = analysisSegments;
  }, [analysisSegments]);

  useEffect(() => {
    layerSettingsRef.current = layerSettings;
  }, [layerSettings]);

  useEffect(() => {
    packetVisualSettingsRef.current = packetVisualSettings;
    animatorRef.current?.setVisualSettings(packetVisualSettings);
    updateOpenFreeMap3D();
  }, [packetVisualSettings]);

  useEffect(() => {
    positionedNodesRenderedRef.current = onPositionedNodesRendered;
    viewChangeRef.current = onViewChange;
    selectedNodeRef.current = onSelectNode;
    plotModeRef.current = plotMode;
    plotNodePickRef.current = onPlotNodePick;
    plotMapPointRef.current = onPlotMapPoint;
    clearSelectionRef.current = onClearSelection;
  }, [onPositionedNodesRendered, onViewChange, onSelectNode, plotMode, onPlotNodePick, onPlotMapPoint, onClearSelection]);

  useEffect(() => {
    const handleVisibility = () => {
      pageHiddenRef.current = document.hidden;
      animatorRef.current?.setPaused(document.hidden || pausedRef.current);
      openFreeMap3DRef.current?.setPaused(document.hidden || pausedRef.current);
      if (document.hidden) {
        animatorRef.current?.clear();
        setMessageBubbles([]);
      }
    };
    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current || mapRef.current) return;
    const startupView = initialViewRef.current ?? parseSharedView(window.location.search);
    const defaultView = defaultMapViewFromConfig(mapConfigRef.current);
    if (startupView) initialViewRef.current = startupView;
    if (startupView) fitInitialNodesRef.current = true;
    setMapZoom(Number((startupView?.z ?? defaultView.z).toFixed(2)));
    const initialStyle = mapStyleForMode(baseModeRef.current, themeModeRef.current);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle,
      center: startupView ? [startupView.lng, startupView.lat] : [defaultView.lng, defaultView.lat],
      zoom: startupView?.z ?? defaultView.z,
      pitch: startupView?.pitch ?? defaultPitchForMode(baseModeRef.current),
      bearing: startupView?.bearing ?? defaultBearingForMode(baseModeRef.current),
      minZoom: 2.4,
      maxZoom: 18,
      maxPitch: 85,
      fadeDuration: 0,
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
      attributionControl: { compact: true }
    });
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), 'bottom-right');
    (window as any).__meshcoreMap = map;
    (window as any).__meshcoreMapStyle = initialStyle;
    mapRef.current = map;
    animatorRef.current = new PacketAnimator(map, canvasRef.current, {
      maskLayerIDs: [CLUSTER_LAYER, NODE_HALO_LAYER, NODE_LAYER, NODE_ICON_LAYER, OBSERVER_LAYER],
      layerSettings: layerSettingsRef.current,
      visualSettings: packetVisualSettingsRef.current
    });

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
      if (layerSettingsRef.current.nodeLabels) {
        setScreenNodeLabels(projectNodeLabels(map, nodesRef.current, nodeFocusRef.current, Date.now(), nodeMeshActivityAtRef.current, nodeActivityRef.current));
      } else {
        setScreenNodeLabels([]);
      }
      if (layerSettingsRef.current.messageBubbles) {
        setMessageBubbles((current) => projectMessageBubbles(map, current, performance.now()));
      } else {
        setMessageBubbles([]);
      }
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
    map.on('moveend', scheduleMapOverlays);
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
      let baseWarning = '';
      if (baseModeRef.current === 'openfreemap') {
        try {
          ensureMercatorProjection(map);
          addOpenFreeMap3DBase(map, themeModeRef.current);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          baseWarning = `OpenFreeMap base warning: ${message}`;
        }
      } else {
        ensureHillshadeLayer(map, themeModeRef.current);
        ensureBuildingExtrusions(map, themeModeRef.current);
        ensureWeatherCloudLayer(map);
      }
      try {
        addPublicLayers(map);
        applyLayerSettings(map, layerSettingsRef.current);
        if (!layerEventsBoundRef.current) {
          bindLayerEvents(map, nodesRef, nodeMeshActivityAtRef, selectedNodeRef, plotModeRef, plotNodePickRef, plotMapPointRef, clearSelectionRef, setHoveredNode);
          layerEventsBoundRef.current = true;
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
      setMapInitError(baseWarning);
      loadedRef.current = true;
      if (initialViewRef.current && !initialViewAppliedRef.current) {
        initialViewAppliedRef.current = true;
        fitInitialNodesRef.current = true;
        map.jumpTo({
          center: [initialViewRef.current.lng, initialViewRef.current.lat],
          zoom: initialViewRef.current.z,
          pitch: initialViewRef.current.pitch ?? defaultPitchForMode(baseModeRef.current),
          bearing: initialViewRef.current.bearing ?? defaultBearingForMode(baseModeRef.current)
        });
      }
      updateNodeRendering(map, nodesRef.current, nodeFocusRef.current, Date.now(), nodeMeshActivityAtRef.current, nodeSourceSignatureRef, true);
      setActivityHeatmapSource(map, nodesRef.current, nodeActivityRef.current, nodeMeshActivityAtRef.current);
      updateRouteRendering(
        map,
        routesRef.current,
        selectedRouteIDRef.current,
        nodeFocusRef.current,
        routeSourceSignatureRef,
        routeColorSignatureRef,
        animatorRef,
        themeModeRef.current,
        true
      );
      updateAnalysisRouteRendering(
        map,
        routesRef.current,
        selectedRouteIDRef.current,
        nodeFocusRef.current,
        analysisSegmentsRef.current,
        analysisRouteSignatureRef,
        themeModeRef.current,
        true
      );
      updateOpenFreeMap3D();
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
      map.off('moveend', scheduleMapOverlays);
      map.off('moveend', publishView);
      map.off('error', recordMapError);
      map.off('load', initializeMapLayers);
      map.off('style.load', initializeMapLayers);
      map.off('styledata', initializeMapLayers);
      if (nodeLabelFrameRef.current !== null) window.cancelAnimationFrame(nodeLabelFrameRef.current);
      nodeLabelFrameRef.current = null;
      if (pulseSchedulerTimerRef.current !== null) window.clearTimeout(pulseSchedulerTimerRef.current);
      if (observerSchedulerTimerRef.current !== null) window.clearTimeout(observerSchedulerTimerRef.current);
      if (replayActionTimerRef.current !== null) window.clearTimeout(replayActionTimerRef.current);
      routeGifExportCleanupRef.current?.();
      routeGifExportCleanupRef.current = null;
      stopReplayChaseCamera();
      pulseSchedulerTimerRef.current = null;
      observerSchedulerTimerRef.current = null;
      replayActionTimerRef.current = null;
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
      destroyOpenFreeMap3D();
      animatorRef.current?.destroy();
      animatorRef.current = null;
      map.remove();
      if ((window as any).__meshcoreMap === map) delete (window as any).__meshcoreMap;
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (baseModeRef.current === baseMode && themeModeRef.current === themeMode) return;
    baseModeRef.current = baseMode;
    themeModeRef.current = themeMode;
    const map = mapRef.current;
    if (!map) return;

    loadedRef.current = false;
    nodeSourceSignatureRef.current = '';
    routeSourceSignatureRef.current = '';
    routeColorSignatureRef.current = '';
    setMapInitError('');
    setScreenNodeLabels([]);
    setMessageBubbles([]);
    animatorRef.current?.clear();

    clearNodeActivityStates(map, nodeActivityRef.current);
    stopNodeActivityTimer(nodeActivityTimerRef);
    clearRoutePayloadGlowStates(map, routePayloadGlowRef.current);
    stopRoutePayloadGlowTimer(routePayloadGlowTimerRef);
    clearClusterActivityGlowStates(map, clusterActivityGlowRef.current);
    stopClusterActivityGlowTimer(clusterActivityGlowTimerRef);
    destroyOpenFreeMap3D();

    const nextStyle = mapStyleForMode(baseMode, themeMode);
    (window as any).__meshcoreMapStyle = nextStyle;
    map.setStyle(nextStyle);
    if (baseMode === 'openfreemap') ensureMercatorProjection(map);
    map.easeTo({
      pitch: defaultPitchForMode(baseMode),
      bearing: defaultBearingForMode(baseMode),
      duration: 500
    });
  }, [baseMode, themeMode]);

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
      if (layerSettingsRef.current.nodeLabels) {
        setScreenNodeLabels(projectNodeLabels(map, nodesRef.current, nodeFocusRef.current, Date.now(), nodeMeshActivityAtRef.current, nodeActivityRef.current));
      } else {
        setScreenNodeLabels([]);
      }
      if (layerSettingsRef.current.messageBubbles) {
        setMessageBubbles((current) => projectMessageBubbles(map, current, performance.now()));
      } else {
        setMessageBubbles([]);
      }
    }, 500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (loadedRef.current) updateNodeRendering(map, nodes, nodeFocus, nodeLabelClock, nodeMeshActivityAtRef.current, nodeSourceSignatureRef);
    if (loadedRef.current) setActivityHeatmapSource(map, nodes, nodeActivityRef.current, nodeMeshActivityAtRef.current);
    if (isClusterMode(map)) {
      setScreenNodeLabels([]);
      stopNodeActivityTimer(nodeActivityTimerRef);
      clearNodeActivityStates(map, nodeActivityRef.current);
      if (loadedRef.current) setActivityHeatmapSource(map, nodes, nodeActivityRef.current, nodeMeshActivityAtRef.current);
      markPositionedNodesReady(map, nodes, fitInitialNodesRef, positionedNodesReadyRef, positionedNodesRenderedRef);
      return;
    }
    if (layerSettings.nodeLabels) {
      setScreenNodeLabels(projectNodeLabels(map, nodes, nodeFocus, nodeLabelClock, nodeMeshActivityAtRef.current, nodeActivityRef.current));
    } else {
      setScreenNodeLabels([]);
    }
    if (addChangedNodeActivity(map, nodeActivityRef.current, nodeTelemetryRef.current, nodeMeshActivityAtRef.current, nodes)) {
      setActivityHeatmapSource(map, nodes, nodeActivityRef.current, nodeMeshActivityAtRef.current);
      startNodeActivityTimer(map, nodeActivityRef, nodeActivityTimerRef, nodesRef, nodeMeshActivityAtRef);
    }
    if (updateNodeActivityFeatureStates(map, nodeActivityRef.current) > 0) {
      setActivityHeatmapSource(map, nodes, nodeActivityRef.current, nodeMeshActivityAtRef.current);
      startNodeActivityTimer(map, nodeActivityRef, nodeActivityTimerRef, nodesRef, nodeMeshActivityAtRef);
    }
    markPositionedNodesReady(map, nodes, fitInitialNodesRef, positionedNodesReadyRef, positionedNodesRenderedRef);
    updateOpenFreeMap3D();
  }, [nodes, nodeFocus, nodeLabelClock, layerSettings.nodeLabels]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (loadedRef.current) {
      updateRouteRendering(map, routes, selectedRouteID, nodeFocus, routeSourceSignatureRef, routeColorSignatureRef, animatorRef, themeModeRef.current);
      updateAnalysisRouteRendering(map, routes, selectedRouteID, nodeFocus, analysisSegments, analysisRouteSignatureRef, themeModeRef.current);
      setRoutePayloadGlowSource(map, routes, routePayloadGlowRef.current, selectedRouteID, nodeFocus);
      updateOpenFreeMap3D();
    }
  }, [routes, selectedRouteID, nodeFocus, analysisSegments]);

  useEffect(() => {
    pausedRef.current = paused;
    animatorRef.current?.setPaused(paused || pageHiddenRef.current);
    openFreeMap3DRef.current?.setPaused(paused || pageHiddenRef.current);
  }, [paused]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    animatorRef.current?.setLayerSettings(layerSettings);
    applyLayerSettings(map, layerSettings);
    if (layerSettings.activityHeatmap) setActivityHeatmapSource(map, nodesRef.current, nodeActivityRef.current, nodeMeshActivityAtRef.current);
    if (!layerSettings.messageBubbles) setMessageBubbles([]);
    if (!layerSettings.nodeLabels) setScreenNodeLabels([]);
    updateOpenFreeMap3D();
  }, [layerSettings]);

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
    destroyOpenFreeMap3D();
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
    shownBubbleTextsRef.current.clear();
    pendingPulsesRef.current = [];
    pendingObserverBurstsRef.current = [];
    if (pulseSchedulerTimerRef.current !== null) window.clearTimeout(pulseSchedulerTimerRef.current);
    if (observerSchedulerTimerRef.current !== null) window.clearTimeout(observerSchedulerTimerRef.current);
    if (replayActionTimerRef.current !== null) window.clearTimeout(replayActionTimerRef.current);
    pulseSchedulerTimerRef.current = null;
    observerSchedulerTimerRef.current = null;
    replayActionTimerRef.current = null;
    updateOpenFreeMap3D();
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
    if (replayActionTimerRef.current !== null) {
      window.clearTimeout(replayActionTimerRef.current);
      replayActionTimerRef.current = null;
    }
    stopReplayChaseCamera();
    if (mapAction.type === 'reset') fitToNodes(map, nodesRef.current, 600);
    if (mapAction.type === 'latest-route') {
      const latest = [...routesRef.current].sort((a, b) => b.lastHeard - a.lastHeard)[0];
      if (latest) fitToRoute(map, latest, 700);
    }
    if (mapAction.type === 'route') {
      const route = routesRef.current.find((item) => item.id === mapAction.routeID);
      if (route) fitToRoute(map, route, 700);
    }
    if (mapAction.type === 'packet') {
      fitToSegments(map, mapAction.segments, 760);
    }
    if (mapAction.type === 'packet-replay') {
      map.stop();
      animatorRef.current?.clear();
      updateAnalysisRouteRendering(
        map,
        routesRef.current,
        selectedRouteIDRef.current,
        nodeFocusRef.current,
        mapAction.segments,
        analysisRouteSignatureRef,
        themeModeRef.current,
        true
      );
      fitToSegments(map, mapAction.segments, 900, true);
      replayActionTimerRef.current = window.setTimeout(() => {
        replayActionTimerRef.current = null;
        if (!layerSettingsRef.current.liveComets) return;
        const options = {
          force: true,
          travelDurationMs: mapAction.travelDurationMs,
          brightness: mapAction.pulse.replayOptions?.brightness,
          trailScale: mapAction.pulse.replayOptions?.trailScale,
          animationStyle: mapAction.pulse.replayOptions?.animationStyle
        };
        startReplayChaseCamera(map, mapAction.segments, mapAction.travelDurationMs);
        if (!addPulseTo3D(map, mapAction.pulse, options)) animatorRef.current?.add(mapAction.pulse, options);
      }, 900 + mapAction.settleMs);
    }
    if (mapAction.type === 'node') {
      const node = nodesRef.current.find((item) => item.id === mapAction.nodeID);
      if (node) map.easeTo({ center: [node.longitude, node.latitude], zoom: Math.max(map.getZoom(), 8), duration: 700 });
    }
  }, [mapAction]);

  useEffect(() => {
    const request = routeGifExportRequest;
    if (!request) return;
    const map = mapRef.current;
    const overlayCanvas = canvasRef.current;
    const animator = animatorRef.current;
    if (!map || !overlayCanvas || !animator) {
      request.onError(new Error('Map is not ready for GIF export'));
      return;
    }

    routeGifExportCleanupRef.current?.();
    let cancelled = false;
    const cleanup = () => {
      cancelled = true;
    };
    routeGifExportCleanupRef.current = cleanup;

    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = ROUTE_GIF_WIDTH;
    captureCanvas.height = ROUTE_GIF_HEIGHT;
    const captureCtx = canvas2D(captureCanvas);
    const frameDelayMs = Math.round(1000 / ROUTE_GIF_FPS);

    const run = async () => {
      try {
        request.onProgress(0.03);
        map.stop();
        stopReplayChaseCamera();
        animator.clear();
        updateAnalysisRouteRendering(
          map,
          routesRef.current,
          selectedRouteIDRef.current,
          nodeFocusRef.current,
          request.pulse.segments,
          analysisRouteSignatureRef,
          themeModeRef.current,
          true
        );
        fitToSegmentsForRouteGif(map, request.pulse.segments, 900);
        await waitForMapIdleOrTimeout(map, 900 + request.settleMs + 700);
        if (cancelled) return;
        request.onProgress(0.1);

        const now = Date.now();
        const pulse: PublicRoutePulse = {
          ...request.pulse,
          id: `${request.pulse.id}-gif-${request.token}`,
          receivedAt: now,
          displayAt: now,
          replayOptions: {
            ...request.pulse.replayOptions,
            force: true,
            travelDurationMs: request.travelDurationMs
          }
        };
        const pulseOptions = {
          force: true,
          travelDurationMs: request.travelDurationMs,
          brightness: pulse.replayOptions?.brightness,
          trailScale: pulse.replayOptions?.trailScale,
          animationStyle: pulse.replayOptions?.animationStyle
        };
        if (!addPulseTo3D(map, pulse, pulseOptions)) animator.add(pulse, pulseOptions);
        await waitAnimationFrames(2);

        const blob = await createRouteMapGifBlob(
          request.packet,
          async ({ frameIndex, progress, width, height }) => {
            if (cancelled) throw new Error('GIF export cancelled');
            if (frameIndex > 0) await waitMs(frameDelayMs);
            map.triggerRepaint();
            await waitAnimationFrames(2);
            return captureActualMapGifFrame(map, overlayCanvas, captureCanvas, captureCtx, request.packet, progress, width, height);
          },
          {
            width: ROUTE_GIF_WIDTH,
            height: ROUTE_GIF_HEIGHT,
            frames: ROUTE_GIF_FRAMES,
            fps: ROUTE_GIF_FPS,
            onProgress: (progress) => request.onProgress(0.1 + progress * 0.88)
          }
        );
        if (!cancelled) request.onComplete(blob);
      } catch (error) {
        if (!cancelled) request.onError(error);
      } finally {
        if (routeGifExportCleanupRef.current === cleanup) routeGifExportCleanupRef.current = null;
      }
    };

    void run();
    return cleanup;
  }, [routeGifExportRequest]);

  return (
    <div
      className={`map-wrap ${loading ? 'loading' : ''}`}
      data-map-zoom={mapZoom}
      data-map-base-mode={baseMode}
      data-map-theme-mode={themeMode}
      data-map-center-lat={mapCenter.lat}
      data-map-center-lng={mapCenter.lng}
      data-node-ref-count={nodesRef.current.length}
      data-label-count={screenNodeLabels.length}
      data-map-init-error={mapInitError}
    >
      <div
        ref={containerRef}
        className="map-container"
        role="application"
        aria-label="Live MeshCore Canada network map"
        aria-description={`${nodes.length} nodes, ${routes.length} routes visible`}
      />
      {mapInitError && !loading && (
        <div className="map-error-fallback">
          <div className="map-error-message">
            <strong>Map failed to load</strong>
            <p>{mapInitError}</p>
          </div>
          <button type="button" className="map-error-reload" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
      <div className="map-vignette" />
      <canvas ref={canvasRef} className="rf-canvas" />
      <div className="node-label-overlay" aria-hidden="true">
        {layerSettings.nodeLabels && screenNodeLabels.map((label) => (
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
          </div>
        ))}
      </div>
      <div className="packet-message-overlay" aria-hidden="true">
        {layerSettings.messageBubbles && messageBubbles.map((bubble) => (
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

export default memo(CanadaMap);

function addOpenFreeMap3DBase(map: maplibregl.Map, themeMode: MapThemeMode) {
  if (!map.getSource(OPENFREEMAP_SOURCE)) {
    map.addSource(OPENFREEMAP_SOURCE, {
      type: 'vector',
      url: OPENFREEMAP_TILEJSON_URL
    });
  }
  ensureTerrainSources(map, themeMode);
  ensureWeatherCloudLayer(map);
  addLayerIfMissing(map, {
    id: BUILDINGS_3D_LAYER,
    type: 'fill-extrusion',
    source: OPENFREEMAP_SOURCE,
    'source-layer': 'building',
    minzoom: 14.2,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      'fill-extrusion-color': [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'render_height'], 0],
        0,
        themeMode === 'light' ? '#dbe3ee' : '#172033',
        80,
        themeMode === 'light' ? '#cbd5e1' : '#243047',
        200,
        themeMode === 'light' ? '#b6c3d3' : '#334155',
        420,
        themeMode === 'light' ? '#94a3b8' : '#475569'
      ],
      'fill-extrusion-height': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14.2,
        0,
        15.1,
        ['coalesce', ['get', 'render_height'], 0]
      ],
      'fill-extrusion-base': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14.2,
        0,
        15.1,
        ['coalesce', ['get', 'render_min_height'], 0],
      ],
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14.2, 0.16, 15.5, themeMode === 'light' ? 0.56 : 0.62]
    }
  }, firstTextSymbolLayerID(map));
}

function ensureTerrainSources(map: maplibregl.Map, themeMode: MapThemeMode) {
  if (!map.getSource(TERRAIN_SOURCE)) {
    map.addSource(TERRAIN_SOURCE, { type: 'raster-dem', tiles: [TERRAIN_TILE_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 15 });
  }
  if (!map.getSource(HILLSHADE_SOURCE)) {
    map.addSource(HILLSHADE_SOURCE, { type: 'raster-dem', tiles: [TERRAIN_TILE_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 15 });
  }
  const labelLayerID = firstTextSymbolLayerID(map);
  addLayerIfMissing(map, {
    id: HILLSHADE_LAYER,
    type: 'hillshade',
    source: HILLSHADE_SOURCE,
    paint: {
      'hillshade-method': 'multidirectional',
      'hillshade-highlight-color': themeMode === 'light' ? ['#ffffff', '#f8fafc', '#e2e8f0', '#cbd5e1'] : ['#1e293b', '#334155', '#475569', '#64748b'],
      'hillshade-shadow-color': themeMode === 'light' ? ['#94a3b8', '#cbd5e1', '#d1d5db', '#e5e7eb'] : ['#020617', '#08111f', '#0f172a', '#1e293b'],
      'hillshade-illumination-direction': [270, 315, 0, 45],
      'hillshade-illumination-altitude': [24, 32, 36, 28],
      'hillshade-exaggeration': themeMode === 'light' ? 0.42 : 0.54
    } as any
  }, labelLayerID);
  map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: TERRAIN_EXAGGERATION });
  map.setSky({
    'sky-color': themeMode === 'light' ? '#dbeafe' : '#0f172a',
    'horizon-color': themeMode === 'light' ? '#bfdbfe' : '#172554',
    'fog-color': themeMode === 'light' ? '#eff6ff' : '#07111f',
    'sky-horizon-blend': 0.34,
    'horizon-fog-blend': themeMode === 'light' ? 0.18 : 0.34,
    'fog-ground-blend': themeMode === 'light' ? 0.08 : 0.18
  });
}

function clearMapTerrain(map: maplibregl.Map) {
  try {
    (map as any).setTerrain(null);
  } catch {
    // The original basemap has no terrain source; this is only needed after toggling back from OpenFreeMap.
  }
  try {
    (map as any).setSky(null);
  } catch {
    // Older MapLibre styles may not have sky support enabled.
  }
}

function ensureHillshadeLayer(map: maplibregl.Map, themeMode: MapThemeMode) {
  if (!map.getSource(HILLSHADE_SOURCE)) {
    map.addSource(HILLSHADE_SOURCE, { type: 'raster-dem', tiles: [TERRAIN_TILE_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 15 });
  }
  const labelLayerID = firstTextSymbolLayerID(map);
  addLayerIfMissing(map, {
    id: HILLSHADE_LAYER,
    type: 'hillshade',
    source: HILLSHADE_SOURCE,
    paint: {
      'hillshade-method': 'multidirectional',
      'hillshade-highlight-color': themeMode === 'light' ? ['#ffffff', '#f8fafc', '#e2e8f0', '#cbd5e1'] : ['#1e293b', '#334155', '#475569', '#64748b'],
      'hillshade-shadow-color': themeMode === 'light' ? ['#94a3b8', '#cbd5e1', '#d1d5db', '#e5e7eb'] : ['#020617', '#08111f', '#0f172a', '#1e293b'],
      'hillshade-illumination-direction': [270, 315, 0, 45],
      'hillshade-illumination-altitude': [24, 32, 36, 28],
      'hillshade-exaggeration': themeMode === 'light' ? 0.42 : 0.54
    } as any
  }, labelLayerID);
}

function ensureBuildingExtrusions(map: maplibregl.Map, themeMode: MapThemeMode) {
  if (!map.getSource(OPENFREEMAP_SOURCE)) {
    map.addSource(OPENFREEMAP_SOURCE, {
      type: 'vector',
      url: OPENFREEMAP_TILEJSON_URL
    });
  }
  addLayerIfMissing(map, {
    id: BUILDINGS_3D_LAYER,
    type: 'fill-extrusion',
    source: OPENFREEMAP_SOURCE,
    'source-layer': 'building',
    minzoom: 14.2,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      'fill-extrusion-color': [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'render_height'], 0],
        0,
        themeMode === 'light' ? '#dbe3ee' : '#172033',
        80,
        themeMode === 'light' ? '#cbd5e1' : '#243047',
        200,
        themeMode === 'light' ? '#b6c3d3' : '#334155',
        420,
        themeMode === 'light' ? '#94a3b8' : '#475569'
      ],
      'fill-extrusion-height': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14.2,
        0,
        15.1,
        ['coalesce', ['get', 'render_height'], 0]
      ],
      'fill-extrusion-base': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14.2,
        0,
        15.1,
        ['coalesce', ['get', 'render_min_height'], 0],
      ],
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14.2, 0.16, 15.5, themeMode === 'light' ? 0.56 : 0.62]
    }
  }, firstTextSymbolLayerID(map));
}

function ensureWeatherCloudLayer(map: maplibregl.Map) {
  if (!WEATHER_API_KEY) return;
  if (!map.getSource(WEATHER_CLOUD_SOURCE)) {
    map.addSource(WEATHER_CLOUD_SOURCE, {
      type: 'raster',
      tiles: [`https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${WEATHER_API_KEY}`],
      tileSize: 256,
      maxzoom: 12,
      attribution: '&copy; OpenWeatherMap'
    });
  }
  addLayerIfMissing(map, {
    id: WEATHER_CLOUD_LAYER,
    type: 'raster',
    source: WEATHER_CLOUD_SOURCE,
    minzoom: 0,
    maxzoom: 12,
    paint: {
      'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.48, 3, 0.38, 5, 0.22, 7, 0.08, 8, 0],
      'raster-fade-duration': 300
    }
  });
}

function addPublicLayers(map: maplibregl.Map) {
  addGeneratedNodeIcons(map);

  if (!map.getSource(NODE_SOURCE)) {
    map.addSource(NODE_SOURCE, {
      type: 'geojson',
      data: emptyCollection() as any,
      cluster: true,
      clusterMaxZoom: NODE_CLUSTER_MAX_ZOOM,
      clusterRadius: 58,
      clusterProperties: nodeClusterProperties()
    } as any);
  }
  if (!map.getSource(ACTIVITY_HEATMAP_SOURCE)) {
    map.addSource(ACTIVITY_HEATMAP_SOURCE, {
      type: 'geojson',
      data: emptyCollection() as any
    });
  }
  if (!map.getSource(ROUTE_SOURCE)) {
    map.addSource(ROUTE_SOURCE, {
      type: 'geojson',
      data: emptyCollection() as any
    });
  }
  if (!map.getSource(ANALYSIS_ROUTE_SOURCE)) {
    map.addSource(ANALYSIS_ROUTE_SOURCE, {
      type: 'geojson',
      data: emptyCollection() as any
    });
  }
  if (!map.getSource(ROUTE_PAYLOAD_GLOW_SOURCE)) {
    map.addSource(ROUTE_PAYLOAD_GLOW_SOURCE, {
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
    id: ANALYSIS_ROUTE_GLOW_LAYER,
    type: 'line',
    source: ANALYSIS_ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 2.4, 5, 7, 8, 12, 11],
      'line-blur': ['interpolate', ['linear'], ['zoom'], 2.4, 4, 10, 7],
      'line-opacity': ['coalesce', ['get', 'glowOpacity'], 0.24]
    }
  });

  addLayerIfMissing(map, {
    id: ANALYSIS_ROUTE_LAYER,
    type: 'line',
    source: ANALYSIS_ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 2.4, 2.4, 7, 3.6, 12, 5.2],
      'line-opacity': ['coalesce', ['get', 'opacity'], 0.86]
    }
  });

  for (const layer of activityHeatmapLayers()) addLayerIfMissing(map, layer);

  addLayerIfMissing(map, {
    id: ROUTE_GLOW_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    filter: ROUTE_FOCUS_FILTER,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'case',
        ['==', ['get', 'selected'], true],
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
        ['==', ['get', 'selected'], true],
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
    source: ROUTE_PAYLOAD_GLOW_SOURCE,
    minzoom: 2.5,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 2.5, ['*', ['coalesce', ['get', 'glowWidth'], 6], 0.55], 7, ['coalesce', ['get', 'glowWidth'], 6], 13, ['*', ['coalesce', ['get', 'glowWidth'], 6], 1.45]],
      'line-blur': 4,
      'line-opacity': ['coalesce', ['get', 'opacity'], 0]
    }
  });

  addLayerIfMissing(map, {
    id: ROUTE_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'case',
        ['==', ['get', 'selected'], true],
        ROUTE_ACTIVE_WIDTH,
        ['==', ['get', 'path'], true],
        ROUTE_PATH_WIDTH,
      ['==', ['get', 'connected'], true],
      ROUTE_CONNECTED_WIDTH,
      ['coalesce', ['get', 'routeWidth'], ROUTE_BASE_WIDTH]
    ],
      'line-opacity': [
        'case',
        ['==', ['get', 'selected'], true],
        ROUTE_ACTIVE_OPACITY,
        ['==', ['get', 'path'], true],
        ROUTE_PATH_OPACITY,
      ['==', ['get', 'connected'], true],
      ROUTE_CONNECTED_OPACITY,
      ['==', ['get', 'dimmed'], true],
      ['*', ROUTE_DIMMED_OPACITY, ['coalesce', ['get', 'routeOpacity'], ROUTE_BASE_OPACITY]],
      ['coalesce', ['get', 'routeOpacity'], ROUTE_BASE_OPACITY]
    ]
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
      'circle-color': ['step', ['get', 'point_count'], '#164e63', 25, '#166534', 75, '#9a3412'],
      'circle-radius': ['step', ['get', 'point_count'], 17, 25, 22, 75, 28],
      'circle-stroke-width': ['step', ['get', 'point_count'], 1.9, 25, 2.3, 75, 2.8],
      'circle-stroke-color': 'rgba(255, 255, 255, 0.9)',
      'circle-opacity': 0.94,
      'circle-blur': 0.04
    }
  });

  for (const layer of clusterRoleBadgeCircleLayers()) addLayerIfMissing(map, layer);

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

  for (const layer of clusterRoleBadgeTextLayers()) addLayerIfMissing(map, layer);

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
      'circle-color': NODE_CIRCLE_COLOR,
      'circle-stroke-color': NODE_CIRCLE_STROKE_COLOR,
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], true], 2.2, ['==', ['get', 'path'], true], 1.95, ['==', ['get', 'observer'], true], 2, ['==', ['get', 'neighbor'], true], 1.7, 1.15],
      'circle-opacity': NODE_CIRCLE_OPACITY,
      'circle-stroke-opacity': ['case', ['==', ['get', 'dimmed'], true], 0.22, ['any', ['==', ['get', 'selected'], true], ['==', ['get', 'path'], true], ['==', ['get', 'neighbor'], true], ['==', ['get', 'observer'], true]], 1, ['==', ['get', 'staleLevel'], 2], 0.34, ['==', ['get', 'staleLevel'], 1], 0.52, 0.86]
    }
  });

  addLayerIfMissing(map, {
    id: NODE_ICON_LAYER,
    type: 'symbol',
    source: NODE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'observer'], true]],
    layout: {
      'icon-image': [
        'match',
        ['get', 'role'],
        'repeater',
        nodeMapImageID('repeater'),
        'companion',
        nodeMapImageID('companion'),
        'room_server',
        nodeMapImageID('room_server'),
        'sensor',
        nodeMapImageID('sensor'),
        nodeMapImageID('unknown')
      ],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.34, 11, 0.5],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true
    },
    paint: {
      'icon-opacity': ['case', ['==', ['get', 'selected'], true], 1, ['==', ['get', 'dimmed'], true], 0.3, ['==', ['get', 'staleLevel'], 2], 0.55, 0.92]
    }
  });

  addLayerIfMissing(map, {
    id: OBSERVER_LAYER,
    type: 'symbol',
    source: NODE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'observer'], true]],
    layout: {
      'icon-image': OBSERVER_NODE_VISUAL.mapImageID,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.42, 11, 0.58],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true
    },
    paint: {
      'icon-opacity': ['case', ['==', ['get', 'selected'], true], 1, ['==', ['get', 'dimmed'], true], 0.34, 0.94]
    }
  });

  addLayerIfMissing(map, {
    id: OBSERVER_LABEL_LAYER,
    type: 'symbol',
    source: NODE_SOURCE,
    minzoom: DETAIL_MIN_ZOOM,
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'observer'], true]],
    layout: {
      'text-field': ['get', 'mapLabel'],
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 11, 12],
      'text-anchor': 'top',
      'text-offset': [0, 1.3],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport'
    },
    paint: {
      'text-color': '#fbbf24',
      'text-halo-color': 'rgba(2, 6, 23, 0.85)',
      'text-halo-width': 1.2,
      'text-opacity': ['case', ['==', ['get', 'dimmed'], true], 0.28, 0.55]
    }
  });

}

function addLayerIfMissing(map: maplibregl.Map, layer: maplibregl.LayerSpecification, beforeID?: string) {
  if (map.getLayer(layer.id)) return;
  if (beforeID && map.getLayer(beforeID)) map.addLayer(layer, beforeID);
  else map.addLayer(layer);
}

function applyLayerSettings(map: maplibregl.Map, settings: MapLayerSettings) {
  const clusterLayers = [
    CLUSTER_LAYER,
    CLUSTER_COUNT_LAYER,
    ...CLUSTER_ROLE_BADGES.flatMap((badge) => [`${CLUSTER_ROLE_BADGE_LAYER_PREFIX}-${badge.key}-dot`, `${CLUSTER_ROLE_BADGE_LAYER_PREFIX}-${badge.key}-count`])
  ];
  const activityHeatmapLayers = [ACTIVITY_HEATMAP_LAYER, ACTIVITY_SPARKLE_LAYER];
  const nodeLayers = [NODE_HALO_LAYER, NODE_LAYER, NODE_ICON_LAYER, OBSERVER_LAYER, OBSERVER_LABEL_LAYER];
  const routeLayers = [ROUTE_LAYER];
  const analysisLayers = [ROUTE_GLOW_LAYER, ROUTE_PAYLOAD_GLOW_LAYER, ANALYSIS_ROUTE_GLOW_LAYER, ANALYSIS_ROUTE_LAYER];
  const observerBurstLayers = [CLUSTER_ACTIVITY_AURA_LAYER, CLUSTER_ACTIVITY_RING_LAYER];
  for (const layerID of clusterLayers) setLayerVisibility(map, layerID, settings.clusters);
  for (const layerID of activityHeatmapLayers) setLayerVisibility(map, layerID, settings.activityHeatmap);
  for (const layerID of nodeLayers) setLayerVisibility(map, layerID, settings.nodes);
  for (const layerID of routeLayers) setLayerVisibility(map, layerID, settings.routes);
  for (const layerID of analysisLayers) setLayerVisibility(map, layerID, settings.analysisPaths);
  for (const layerID of observerBurstLayers) setLayerVisibility(map, layerID, settings.observerBursts);
  setLayerVisibility(map, BUILDINGS_3D_LAYER, settings.buildingExtrusions);
  setLayerVisibility(map, HILLSHADE_LAYER, settings.terrainHeightmap);
  setLayerVisibility(map, WEATHER_CLOUD_LAYER, settings.weatherClouds);
}

function setLayerVisibility(map: maplibregl.Map, layerID: string, visible: boolean) {
  if (!map.getLayer(layerID)) return;
  map.setLayoutProperty(layerID, 'visibility', visible ? 'visible' : 'none');
}

function firstTextSymbolLayerID(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.type === 'symbol' && Boolean((layer as any).layout?.['text-field']))?.id;
}

function mapStyleSourcesReady(map: maplibregl.Map): boolean {
  try {
    return map.isStyleLoaded() === true;
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
  const { width, height } = mapViewportSize(map);
  if (!isDetailMode(map)) {
    return [];
  }
  const maxLabels = 40;
  const margin = 80;

  const projected = nodes
    .filter(isMappableNode)
    .filter((node) => !node.isObserver)
    .map((node) => {
      const point = projectLngLat(map, node.longitude, node.latitude);
      const activityAt = meshActivityAtByNodeID.get(node.id);
      const ageMs = activityAt ? Math.max(0, now - activityAt) : Number.POSITIVE_INFINITY;
      const recentActive = ageMs <= NODE_LABEL_RECENT_VISIBLE_MS;
      const selected = node.id === focus.selectedNodeID;
      const neighbour = focus.neighbourNodeIDs.has(node.id);
      const path = focus.pathNodeIDs.has(node.id);
      const observer = node.isObserver === true;
      const recentActivity = recentActivityByNodeID.get(node.id);
      const frequencyHeat = nodeActivityHeat(recentActivity?.hits.length ?? 0);
      const activityProgress = recentActive ? nodeLabelActivityProgress(ageMs, NODE_LABEL_RECENT_VISIBLE_MS) : 0;
      const pulseGlow = activityProgress * 0.05;
      const glow = selected
        ? Math.max(0.58, pulseGlow)
        : path
          ? Math.max(0.46, pulseGlow)
        : neighbour
          ? Math.max(0.3, pulseGlow)
          : Math.max(0.32, pulseGlow);
      const activeOpacity = recentActive ? 0.78 + activityProgress * 0.04 : 0.7;
      const opacity = selected
        ? 1
        : path
          ? 0.9
        : neighbour
          ? 0.88
          : activeOpacity;
      const color = selected
        ? '#ffffff'
        : path
          ? '#facc15'
        : neighbour
          ? '#67e8f9'
          : '#fbbf24';
      return {
        id: node.id,
        name: compactNodeLabel(node.label, 20),
        x: point.x,
        y: point.y + 12,
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
  const visible = inView.filter((label) => label.opacity > 0);
  return visible
    .sort((a, b) => b.rank - a.rank)
    .slice(0, maxLabels)
    .map((label) => ({
      id: label.id,
      name: label.name,
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

function mercatorPoint(lng: number, lat: number, scale: number): { x: number; y: number } {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
  };
}

function messageBubbleFromPulse(map: maplibregl.Map, pulse: PublicRoutePulse): MessageBubble | null {
  if (!pulse.segments || pulse.segments.length === 0) return null;
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
  return text.length > 0;
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

function addPulseRoutePayloadGlow(glows: Map<string, RoutePayloadGlow>, pulse: PublicRoutePulse) {
  const now = performance.now();
  const color = payloadVisual(pulse.payloadTypeName).color;
  const routeIDs = new Set(pulse.segments.map((segment) => segment.routeId).filter(Boolean));
  for (const routeID of routeIDs) {
    glows.set(routeID, { color, startedAt: now, expiresAt: now + ROUTE_PAYLOAD_GLOW_MS });
  }
}

function setRoutePayloadGlowSource(
  map: maplibregl.Map,
  routes: PublicRoute[],
  glows: Map<string, RoutePayloadGlow>,
  selectedRouteID: string | null,
  focus: NodeFocus,
  now = performance.now()
): number {
  const activeGlowCount = pruneRoutePayloadGlows(glows, now);
  setSourceData(map, ROUTE_PAYLOAD_GLOW_SOURCE, routePayloadGlowsToGeoJSON(routes, glows, selectedRouteID, focus, now));
  return activeGlowCount;
}

function startRoutePayloadGlowTimer(
  map: maplibregl.Map,
  routesRef: MutableRefObject<PublicRoute[]>,
  glowsRef: MutableRefObject<Map<string, RoutePayloadGlow>>,
  selectedRouteIDRef: MutableRefObject<string | null>,
  nodeFocusRef: MutableRefObject<NodeFocus>,
  timerRef: MutableRefObject<number | null>
) {
  if (timerRef.current !== null) return;
  timerRef.current = window.setInterval(() => {
    const activeGlowCount = setRoutePayloadGlowSource(map, routesRef.current, glowsRef.current, selectedRouteIDRef.current, nodeFocusRef.current);
    if (activeGlowCount === 0) stopRoutePayloadGlowTimer(timerRef);
  }, ROUTE_PAYLOAD_GLOW_UPDATE_MS);
}

function stopRoutePayloadGlowTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current === null) return;
  window.clearInterval(timerRef.current);
  timerRef.current = null;
}

function clearRoutePayloadGlowStates(map: maplibregl.Map, glows: Map<string, RoutePayloadGlow>) {
  glows.clear();
  setSourceData(map, ROUTE_PAYLOAD_GLOW_SOURCE, emptyCollection());
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
  timerRef: MutableRefObject<number | null>,
  nodesRef?: MutableRefObject<PublicNode[]>,
  meshActivityAtByNodeIDRef?: MutableRefObject<Map<string, number>>
) {
  if (timerRef.current !== null) return;
  timerRef.current = window.setInterval(() => {
    const activeGlowCount = updateNodeActivityFeatureStates(map, activitiesRef.current);
    if (nodesRef && meshActivityAtByNodeIDRef) {
      setActivityHeatmapSource(map, nodesRef.current, activitiesRef.current, meshActivityAtByNodeIDRef.current);
    }
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
  nodeMeshActivityAtRef: MutableRefObject<Map<string, number>>,
  selectedNodeRef: MutableRefObject<(nodeID: string) => void>,
  plotModeRef: MutableRefObject<'off' | 'node' | 'area'>,
  plotNodePickRef: MutableRefObject<(nodeID: string) => void>,
  plotMapPointRef: MutableRefObject<(point: { lat: number; lng: number }) => void>,
  clearSelectionRef: MutableRefObject<() => void>,
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
      return { node, x, y, lastHeardAt: nodeEffectiveActivityAt(node, nodeMeshActivityAtRef.current.get(node.id)) };
    });
  };
  map.on('click', async (event) => {
    const nodeLayers = [OBSERVER_LAYER, NODE_ICON_LAYER, NODE_LAYER].filter((layerID) => map.getLayer(layerID));
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

    clearSelectionRef.current();
  });
  map.on('mousemove', NODE_LAYER, handleNodePointerMove);
  map.on('mousemove', NODE_ICON_LAYER, handleNodePointerMove);
  map.on('mousemove', OBSERVER_LAYER, handleNodePointerMove);
  map.on('mouseleave', NODE_LAYER, () => setHoveredNode(null));
  map.on('mouseleave', NODE_ICON_LAYER, () => setHoveredNode(null));
  map.on('mouseleave', OBSERVER_LAYER, () => setHoveredNode(null));
  for (const layer of [CLUSTER_LAYER, CLUSTER_COUNT_LAYER, NODE_LAYER, NODE_ICON_LAYER, OBSERVER_LAYER]) {
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = '';
    });
  }
}

function NodeHoverToast({ hovered, now }: { hovered: HoveredNodeToast; now: number }) {
  const { node, x, y, lastHeardAt } = hovered;
  const regions = node.iatasHeardIn.length > 0 ? node.iatasHeardIn.slice(0, 4).join(', ') : 'No region';
  return (
    <div className="node-hover-toast" style={{ left: x, top: y }}>
      <strong>{node.label}</strong>
      <span>{formatNodeRole(node.role)} - {regions}</span>
      <dl>
        <div>
          <dt>Last heard</dt>
          <dd>{nodeLastHeardAgeLabel(lastHeardAt, now).replace(/^last /, '')}</dd>
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
  const meshActivityAt = meshActivityAtByNodeID.get(node.id);
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
    observer: node.isObserver === true,
    staleLevel: nodeStaleLevel(node, labelClock, meshActivityAt)
  };
}

function updateNodeRendering(
  map: maplibregl.Map,
  nodes: PublicNode[],
  focus: NodeFocus,
  labelClock: number,
  meshActivityAtByNodeID: Map<string, number>,
  signatureRef: MutableRefObject<string>,
  force = false
) {
  const nextSignature = nodeSourceSignature(nodes, focus, labelClock, meshActivityAtByNodeID);
  if (!force && nextSignature === signatureRef.current) return;
  signatureRef.current = nextSignature;
  setSourceData(map, NODE_SOURCE, nodesToGeoJSON(nodes, focus, labelClock, meshActivityAtByNodeID));
}

function setActivityHeatmapSource(
  map: maplibregl.Map,
  nodes: PublicNode[],
  activities: Map<string, NodeActivity>,
  meshActivityAtByNodeID: Map<string, number>
) {
  if (!map.getSource(ACTIVITY_HEATMAP_SOURCE)) return;
  setSourceData(map, ACTIVITY_HEATMAP_SOURCE, activityHeatmapToGeoJSON(nodes, activities, meshActivityAtByNodeID));
}

function updateRouteRendering(
  map: maplibregl.Map,
  routes: PublicRoute[],
  selectedRouteID: string | null,
  focus: NodeFocus,
  routeSignatureRef: MutableRefObject<string>,
  colorSignatureRef: MutableRefObject<string>,
  animatorRef: MutableRefObject<PacketAnimator | null>,
  themeMode: MapThemeMode,
  force = false
) {
  const now = Date.now();
  const nextRouteSignature = routeSourceSignature(routes, selectedRouteID, focus, now);
  if (force || nextRouteSignature !== routeSignatureRef.current) {
    routeSignatureRef.current = nextRouteSignature;
    setSourceData(map, ROUTE_SOURCE, routesToGeoJSON(routes, selectedRouteID, focus, now, themeMode));
  }

  const nextColorSignature = `${themeMode}:${routeColorSignature(routes)}`;
  if (force || nextColorSignature !== colorSignatureRef.current) {
    colorSignatureRef.current = nextColorSignature;
    animatorRef.current?.setRouteColors(new Map(routes.map((route) => [route.id, routeColorForBucket(route.frequencyBucket, themeMode)])));
  }
}

function updateAnalysisRouteRendering(
  map: maplibregl.Map,
  routes: PublicRoute[],
  selectedRouteID: string | null,
  focus: NodeFocus,
  analysisSegments: PublicRoutePulse['segments'],
  signatureRef: MutableRefObject<string>,
  themeMode: MapThemeMode,
  force = false
) {
  const signature = `${themeMode}:${analysisRouteSignature(routes, selectedRouteID, focus, analysisSegments)}`;
  if (!force && signature === signatureRef.current) return;
  signatureRef.current = signature;
  setSourceData(map, ANALYSIS_ROUTE_SOURCE, analysisRoutesToGeoJSON(routes, selectedRouteID, focus, analysisSegments, themeMode));
}

function analysisRouteSignature(routes: PublicRoute[], selectedRouteID: string | null, focus: NodeFocus, analysisSegments: PublicRoutePulse['segments']): string {
  const routeIDs = new Set<string>([...focus.pathRouteIDs, ...focus.connectedRouteIDs]);
  if (selectedRouteID) routeIDs.add(selectedRouteID);
  const matchedRoutes = routes
    .filter((route) => routeIDs.has(route.id))
    .map((route) => `${route.id}:${route.from.lat.toFixed(4)},${route.from.lng.toFixed(4)}>${route.to.lat.toFixed(4)},${route.to.lng.toFixed(4)}`)
    .sort();
  const segmentSig = analysisSegments
    .map((segment) => `${segment.routeId}:${segment.from.lat.toFixed(4)},${segment.from.lng.toFixed(4)}>${segment.to.lat.toFixed(4)},${segment.to.lng.toFixed(4)}`)
    .sort();
  return `${selectedRouteID ?? ''}|${matchedRoutes.join(';')}|${segmentSig.join(';')}`;
}

function followTrafficPulse(
  map: maplibregl.Map,
  pulse: PublicRoutePulse,
  enabled: boolean,
  stateRef: MutableRefObject<FollowTrafficState>,
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
  stateRef: MutableRefObject<FollowTrafficState>,
  immediate = false
) {
  if (!enabled) return;
  followTrafficTarget(map, burst.id, [[burst.location.lng, burst.location.lat]], stateRef, immediate);
}

function followTrafficTarget(
  map: maplibregl.Map,
  id: string,
  points: Array<[number, number]>,
  stateRef: MutableRefObject<FollowTrafficState>,
  immediate: boolean
) {
  const usablePoints = points.filter(isFollowPoint);
  if (usablePoints.length === 0) return;
  const now = Date.now();
  const state = stateRef.current;
  const decision = followTrafficDecision(state, { id, now, immediate, mapMoving: map.isMoving() });
  if (!decision.shouldMove) return;
  state.lastAt = now;
  state.lastID = id;
  map.stop();
  if (usablePoints.length === 1) {
    const currentZoom = map.getZoom();
    const zoom = Math.max(FOLLOW_TRAFFIC_POINT_ZOOM, Math.min(currentZoom, FOLLOW_TRAFFIC_ROUTE_MAX_ZOOM + 0.3));
    map.easeTo({
      center: usablePoints[0],
      zoom,
      duration: decision.durationMs,
      easing: easeLinear
    });
    return;
  }
  const bounds = usablePoints.reduce((acc, point) => acc.extend(point), new maplibregl.LngLatBounds(usablePoints[0], usablePoints[0]));
  map.fitBounds(bounds, {
    padding: followTrafficPadding(map),
    maxZoom: FOLLOW_TRAFFIC_ROUTE_MAX_ZOOM,
    duration: decision.durationMs,
    easing: easeLinear
  });
}

function routePulsePoints(pulse: PublicRoutePulse): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const segment of pulse.segments) {
    points.push([segment.from.lng, segment.from.lat], [segment.to.lng, segment.to.lat]);
  }
  return points;
}

function fitToSegmentsForRouteGif(map: maplibregl.Map, segments: PublicRoutePulse['segments'], duration: number): void {
  const points = segments.flatMap((segment) => [
    [segment.from.lng, segment.from.lat] as [number, number],
    [segment.to.lng, segment.to.lat] as [number, number]
  ]).filter(isFollowPoint);
  if (points.length === 0) return;
  const { width, height } = mapViewportSize(map);
  const compact = width < 760 || height < 560;
  const padding: maplibregl.PaddingOptions = compact
    ? { top: 120, right: 42, bottom: 206, left: 42 }
    : { top: 132, right: 126, bottom: 238, left: 126 };
  const maxZoom = compact ? 8.2 : 9.6;

  map.stop();
  if (points.length === 1) {
    map.easeTo({ center: points[0], zoom: Math.max(map.getZoom(), 8), pitch: 0, bearing: 0, duration, easing: easeOutCubic });
    return;
  }

  const bounds = points.reduce((acc, point) => acc.extend(point), new maplibregl.LngLatBounds(points[0], points[0]));
  const camera = map.cameraForBounds(bounds, { padding, maxZoom });
  if (camera) {
    map.easeTo({ ...camera, pitch: 0, bearing: 0, duration, easing: easeOutCubic });
    return;
  }
  map.fitBounds(bounds, { padding, maxZoom, duration, easing: easeOutCubic });
}

function captureActualMapGifFrame(
  map: maplibregl.Map,
  overlayCanvas: HTMLCanvasElement,
  captureCanvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  packet: RouteMapGifExportRequest['packet'],
  progress: number,
  width: number,
  height: number
): ImageData {
  if (captureCanvas.width !== width) captureCanvas.width = width;
  if (captureCanvas.height !== height) captureCanvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(map.getCanvas(), 0, 0, width, height);
  ctx.drawImage(overlayCanvas, 0, 0, width, height);
  drawRouteMapGifOverlay(ctx, packet, progress, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function canvas2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('GIF capture canvas unavailable');
  return ctx;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}

function waitAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = Math.max(1, count);
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  });
}

function waitForMapIdleOrTimeout(map: maplibregl.Map, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let timer: number | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer !== null) window.clearTimeout(timer);
      map.off('idle', finish);
      resolve();
    };
    timer = window.setTimeout(finish, Math.max(250, timeoutMs));
    map.once('idle', finish);
  });
}

function addGeneratedNodeIcons(map: maplibregl.Map) {
  for (const visual of NODE_ROLE_VISUALS) {
    addMapImageFromURL(map, visual.mapImageID, visual.icon, createIcon(visual.color, visual.shape));
  }
  addMapImageFromURL(
    map,
    OBSERVER_NODE_VISUAL.mapImageID,
    OBSERVER_NODE_VISUAL.icon,
    createIcon(OBSERVER_NODE_VISUAL.color, OBSERVER_NODE_VISUAL.shape)
  );
}

function addMapImageFromURL(map: maplibregl.Map, name: string, url: string, fallback: ImageData) {
  if (map.hasImage(name)) return;
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    if (!map.hasImage(name)) map.addImage(name, image, { pixelRatio: 2 });
  };
  image.onerror = () => {
    if (!map.hasImage(name)) map.addImage(name, fallback, { pixelRatio: 2 });
  };
  image.src = url;
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

function envURL(key: string, fallback: string): string {
  const value = (import.meta.env[key] as string | undefined)?.trim();
  return value || fallback;
}

function envFloat(key: string, fallback: number): number {
  const value = (import.meta.env[key] as string | undefined)?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
