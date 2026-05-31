import type { PublicRoute, PublicRoutePulse } from '../types';
import { isMappableEndpoint } from './geo';
import type { NodeFocus } from './nodeFocus';
import { routeArcCoordinates } from './routeArcs';
import { routeColorForBucket, routeHighlightColor, type RouteThemeMode } from './routeSource';
import type { FeatureCollection } from './sourceDataQueue';

export function analysisRoutesToGeoJSON(
  routes: PublicRoute[],
  selectedRouteID: string | null,
  focus: NodeFocus,
  analysisSegments: PublicRoutePulse['segments'],
  themeMode: RouteThemeMode = 'dark'
): FeatureCollection {
  const features: Array<Record<string, unknown>> = [];
  const routeIDs = new Set<string>([...focus.pathRouteIDs, ...focus.connectedRouteIDs]);
  if (selectedRouteID) routeIDs.add(selectedRouteID);
  for (const route of routes) {
    if (!routeIDs.has(route.id)) continue;
    const path = focus.pathRouteIDs.has(route.id);
    const selected = route.id === selectedRouteID;
    const connected = focus.connectedRouteIDs.has(route.id);
    const color = selected
      ? routeHighlightColor('selected', themeMode)
      : path
        ? routeHighlightColor('path', themeMode)
        : connected
          ? routeHighlightColor('connected', themeMode)
          : routeColorForBucket(route.frequencyBucket, themeMode);
    features.push(lineFeature(route.id, routeArcCoordinates(route.from, route.to, { distanceKm: route.distanceKm }), {
      color,
      opacity: selected ? 0.96 : path ? 0.9 : 0.72,
      glowOpacity: selected ? 0.34 : path ? 0.28 : 0.18
    }));
  }
  for (const [index, segment] of analysisSegments.entries()) {
    if (!isMappableEndpoint(segment.from) || !isMappableEndpoint(segment.to)) continue;
    features.push(lineFeature(`packet-${segment.routeId}-${index}`, routeArcCoordinates(segment.from, segment.to, { distanceKm: segment.distanceKm }), {
      color: routeHighlightColor('path', themeMode),
      opacity: 0.94,
      glowOpacity: 0.32
    }));
  }
  return { type: 'FeatureCollection', features };
}

function lineFeature(id: string, coordinates: Array<[number, number]>, properties: Record<string, unknown>) {
  return {
    type: 'Feature',
    id,
    properties: { id, ...properties },
    geometry: {
      type: 'LineString',
      coordinates
    }
  };
}
