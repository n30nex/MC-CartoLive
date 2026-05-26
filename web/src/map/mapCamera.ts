import maplibregl from 'maplibre-gl';
import type { PublicNode, PublicRoute, PublicRoutePulse } from '../types';
import type { MapViewState } from '../shareView';
import { isMappableNode } from './geo';

const FOLLOW_TRAFFIC_POINT_ZOOM = 8.4;

export function mapViewportSize(map: maplibregl.Map): { width: number; height: number } {
  const canvas = map.getCanvas();
  const container = map.getContainer();
  return {
    width: canvas.clientWidth || container.clientWidth || window.innerWidth || 1,
    height: canvas.clientHeight || container.clientHeight || window.innerHeight || 1
  };
}

export function mapViewFromMap(map: maplibregl.Map): MapViewState {
  const center = map.getCenter();
  return { lat: center.lat, lng: center.lng, z: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
}

export function fitToNodes(map: maplibregl.Map, nodes: PublicNode[], duration: number) {
  const points = nodes.filter(isMappableNode).map((node) => [node.longitude, node.latitude] as [number, number]);
  if (points.length === 0) return;
  const bounds = points.reduce((acc, point) => acc.extend(point), new maplibregl.LngLatBounds(points[0], points[0]));
  map.fitBounds(bounds, { padding: 76, maxZoom: 5.4, duration });
}

export function fitToRoute(map: maplibregl.Map, route: PublicRoute, duration: number) {
  const points: Array<[number, number]> = [
    [route.from.lng, route.from.lat],
    [route.to.lng, route.to.lat]
  ];
  const bounds = points.reduce((acc, point) => acc.extend(point), new maplibregl.LngLatBounds(points[0], points[0]));
  map.fitBounds(bounds, { padding: 120, maxZoom: 10.5, duration });
}

export function fitToSegments(map: maplibregl.Map, segments: PublicRoutePulse['segments'], duration: number, overview = false) {
  const points = segments.flatMap((segment) => [
    [segment.from.lng, segment.from.lat] as [number, number],
    [segment.to.lng, segment.to.lat] as [number, number]
  ]).filter(isFollowPoint);
  if (points.length === 0) return;
  if (points.length === 1) {
    map.easeTo({ center: points[0], zoom: Math.max(map.getZoom(), FOLLOW_TRAFFIC_POINT_ZOOM - 0.2), duration });
    return;
  }
  const bounds = points.reduce((acc, point) => acc.extend(point), new maplibregl.LngLatBounds(points[0], points[0]));
  map.fitBounds(bounds, { padding: overview ? overviewRoutePadding(map) : followTrafficPadding(map), maxZoom: overview ? 8.8 : 10.8, duration, easing: easeOutCubic });
}

export function overviewRoutePadding(map: maplibregl.Map): maplibregl.PaddingOptions {
  const { width, height } = mapViewportSize(map);
  const compact = width < 720 || height < 560;
  if (compact) {
    return { top: 86, right: 38, bottom: 116, left: 38 };
  }
  return { top: 132, right: 132, bottom: 150, left: 132 };
}

export function isFollowPoint(point: [number, number]): boolean {
  const [lng, lat] = point;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0 && lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180;
}

export function followTrafficPadding(map: maplibregl.Map): maplibregl.PaddingOptions {
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

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
