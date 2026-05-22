import type { ReachableNode } from './connectivity';
import type { PublicActivity, PublicNode, PublicRoute } from './types';

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface RouteBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface NodeMessageHistoryItem {
  id: string;
  heardAt: number;
  sender: string;
  text: string;
  payloadTypeName: string;
  routeLabels: string[];
}

export function meshcorePathCopyText(path: ReachableNode | null): string {
  return path?.meshcorePath3 ?? '';
}

export function meshcorePathAvailable(path: ReachableNode | null): boolean {
  return meshcorePathCopyText(path).length > 0;
}

export function boundsFromPoints(a: MapPoint, b: MapPoint): RouteBounds {
  return {
    north: Math.max(a.lat, b.lat),
    south: Math.min(a.lat, b.lat),
    east: Math.max(a.lng, b.lng),
    west: Math.min(a.lng, b.lng)
  };
}

export function routesInBounds(routes: PublicRoute[], bounds: RouteBounds): PublicRoute[] {
  return routes
    .filter((route) => routeIntersectsBounds(route, bounds))
    .sort((left, right) => right.packetCount - left.packetCount || right.lastHeard - left.lastHeard || left.id.localeCompare(right.id));
}

export function routeNodeIDs(routes: PublicRoute[]): Set<string> {
  const out = new Set<string>();
  for (const route of routes) {
    out.add(route.from.nodeId);
    out.add(route.to.nodeId);
  }
  return out;
}

export function messageHistoryForNode(node: PublicNode | null, routes: PublicRoute[], activity: PublicActivity[], limit = 80): NodeMessageHistoryItem[] {
  if (!node) return [];
  const routeByID = new Map(routes.map((route) => [route.id, route]));
  const directRouteIDs = new Set(
    routes
      .filter((route) => route.from.nodeId === node.id || route.to.nodeId === node.id)
      .map((route) => route.id)
  );

  return activity
    .filter((item) => (item.messageText ?? '').trim().length > 0)
    .filter((item) => messageTouchesNode(item, node, directRouteIDs))
    .map((item) => ({
      id: item.id,
      heardAt: item.heardAt,
      sender: (item.messageSender ?? '').trim() || item.messageAnchor?.label || 'Unknown',
      text: (item.messageText ?? '').trim(),
      payloadTypeName: item.payloadTypeName,
      routeLabels: routeLabelsForActivity(item, routeByID)
    }))
    .sort((left, right) => right.heardAt - left.heardAt)
    .slice(0, limit);
}

function messageTouchesNode(item: PublicActivity, node: PublicNode, directRouteIDs: Set<string>): boolean {
  if (item.messageAnchor?.nodeId === node.id) return true;
  if ((item.routeIds ?? []).some((routeID) => directRouteIDs.has(routeID))) return true;
  if (!item.observerLocation) return false;
  return Math.abs(item.observerLocation.lat - node.latitude) < 0.0001 && Math.abs(item.observerLocation.lng - node.longitude) < 0.0001;
}

function routeLabelsForActivity(item: PublicActivity, routeByID: Map<string, PublicRoute>): string[] {
  const labels: string[] = [];
  for (const routeID of item.routeIds ?? []) {
    const route = routeByID.get(routeID);
    if (!route) continue;
    labels.push(`${route.from.label} -> ${route.to.label}`);
  }
  return labels.slice(0, 3);
}

function routeIntersectsBounds(route: PublicRoute, bounds: RouteBounds): boolean {
  const a = { lat: route.from.lat, lng: route.from.lng };
  const b = { lat: route.to.lat, lng: route.to.lng };
  if (pointInBounds(a, bounds) || pointInBounds(b, bounds)) return true;
  if (Math.max(a.lat, b.lat) < bounds.south || Math.min(a.lat, b.lat) > bounds.north) return false;
  if (Math.max(a.lng, b.lng) < bounds.west || Math.min(a.lng, b.lng) > bounds.east) return false;
  const corners: MapPoint[] = [
    { lat: bounds.south, lng: bounds.west },
    { lat: bounds.south, lng: bounds.east },
    { lat: bounds.north, lng: bounds.east },
    { lat: bounds.north, lng: bounds.west }
  ];
  return corners.some((corner, index) => segmentsIntersect(a, b, corner, corners[(index + 1) % corners.length]));
}

function pointInBounds(point: MapPoint, bounds: RouteBounds): boolean {
  return point.lat >= bounds.south && point.lat <= bounds.north && point.lng >= bounds.west && point.lng <= bounds.east;
}

function segmentsIntersect(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

function orientation(a: MapPoint, b: MapPoint, c: MapPoint): number {
  const value = (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  if (Math.abs(value) < 1e-10) return 0;
  return value > 0 ? 1 : 2;
}
