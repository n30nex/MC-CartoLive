import type { PublicRoute } from '../types';
import { isMappableEndpoint } from './geo';
import type { NodeFocus } from './nodeFocus';
import { routeArcCoordinates } from './routeArcs';

export const routeColors = ['#1d4ed8', '#0891b2', '#15803d', '#c2410c', '#be123c'];
export const ROUTE_FRESH_MS = 15 * 60_000;
export const ROUTE_RECENT_MS = 60 * 60_000;
export const ROUTE_KNOWN_MS = 6 * 60 * 60_000;

export interface RoutePayloadGlow {
  color: string;
  startedAt: number;
  expiresAt: number;
}

type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<Record<string, unknown>>;
};

export function routesToGeoJSON(
  routes: PublicRoute[],
  selectedRouteID: string | null,
  focus: NodeFocus,
  now = Date.now()
): FeatureCollection {
  const hasFocusedRoute = Boolean(selectedRouteID || focus.selectedNodeID || focus.pathRouteIDs.size > 0);
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((route) => isMappableEndpoint(route.from) && isMappableEndpoint(route.to))
      .map((route) => {
        const selected = route.id === selectedRouteID;
        const connected = focus.connectedRouteIDs.has(route.id);
        const path = focus.pathRouteIDs.has(route.id);
        return {
          type: 'Feature',
          id: route.id,
          properties: {
            id: route.id,
            color: routeColors[Math.max(0, Math.min(4, route.frequencyBucket))],
            selected,
            path,
            connected,
            dimmed: hasFocusedRoute && !selected && !path && !connected,
            freshnessLevel: routeFreshnessLevel(route.lastHeard, now),
            freshnessOpacity: routeFreshnessOpacity(route.lastHeard, now)
          },
          geometry: {
            type: 'LineString',
            coordinates: routeArcCoordinates(route.from, route.to, { distanceKm: route.distanceKm })
          }
        };
      })
  };
}

export function routeSourceSignature(routes: PublicRoute[], selectedRouteID: string | null, focus: NodeFocus, now = Date.now()): string {
  return [
    selectedRouteID ?? '',
    focus.selectedNodeID ?? '',
    stableSetSignature(focus.connectedRouteIDs),
    stableSetSignature(focus.pathRouteIDs),
    routes.map((route) => routeRenderIdentity(route, now)).sort().join('|')
  ].join('~');
}

export function routeColorSignature(routes: PublicRoute[]): string {
  return routes.map((route) => `${route.id}:${Math.max(0, Math.min(4, route.frequencyBucket))}`).sort().join('|');
}

export function pruneRoutePayloadGlows(glows: Map<string, RoutePayloadGlow>, now: number, minIntensity = 0.01): number {
  let activeGlowCount = 0;
  for (const [routeID, glow] of glows.entries()) {
    const intensity = routePayloadGlowIntensity(glow, now);
    if (now >= glow.expiresAt || intensity <= minIntensity) {
      glows.delete(routeID);
      continue;
    }
    activeGlowCount += 1;
  }
  return activeGlowCount;
}

export function routePayloadGlowsToGeoJSON(
  routes: PublicRoute[],
  glows: Map<string, RoutePayloadGlow>,
  selectedRouteID: string | null,
  focus: NodeFocus,
  now: number
): FeatureCollection {
  const routeByID = new Map(routes.map((route) => [route.id, route]));
  const hasFocusedRoute = Boolean(selectedRouteID || focus.selectedNodeID || focus.pathRouteIDs.size > 0);
  const features: Array<Record<string, unknown>> = [];

  for (const [routeID, glow] of glows.entries()) {
    const route = routeByID.get(routeID);
    if (!route || !isMappableEndpoint(route.from) || !isMappableEndpoint(route.to)) continue;
    const intensity = routePayloadGlowIntensity(glow, now);
    if (intensity <= 0.01) continue;
    const selected = routeID === selectedRouteID;
    const connected = focus.connectedRouteIDs.has(routeID);
    const path = focus.pathRouteIDs.has(routeID);
    const dimmed = hasFocusedRoute && !selected && !path && !connected;
    features.push({
      type: 'Feature',
      id: routeID,
      properties: {
        id: routeID,
        color: glow.color,
        opacity: intensity * (dimmed ? 0.18 : 0.42)
      },
      geometry: {
        type: 'LineString',
        coordinates: routeArcCoordinates(route.from, route.to, { distanceKm: route.distanceKm })
      }
    });
  }

  return { type: 'FeatureCollection', features };
}

function routePayloadGlowIntensity(glow: RoutePayloadGlow, now: number): number {
  const duration = Math.max(1, glow.expiresAt - glow.startedAt);
  const progress = Math.max(0, Math.min(1, (now - glow.startedAt) / duration));
  return Math.pow(1 - progress, 0.72);
}

export function routeFreshnessLevel(lastHeard: number, now: number): number {
  if (lastHeard <= 0) return 3;
  const age = Math.max(0, now - lastHeard);
  if (age <= ROUTE_FRESH_MS) return 0;
  if (age <= ROUTE_RECENT_MS) return 1;
  if (age <= ROUTE_KNOWN_MS) return 2;
  return 3;
}

export function routeFreshnessOpacity(lastHeard: number, now: number): number {
  switch (routeFreshnessLevel(lastHeard, now)) {
    case 0:
      return 1;
    case 1:
      return 0.78;
    case 2:
      return 0.54;
    default:
      return 0.34;
  }
}

function routeRenderIdentity(route: PublicRoute, now: number): string {
  return [
    route.id,
    route.frequencyBucket,
    routeFreshnessLevel(route.lastHeard, now),
    route.from.nodeId,
    route.from.lat,
    route.from.lng,
    route.to.nodeId,
    route.to.lat,
    route.to.lng
  ].join(':');
}

function stableSetSignature(values: Set<string>): string {
  return [...values].sort().join(',');
}
