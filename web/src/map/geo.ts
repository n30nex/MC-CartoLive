import type { PublicNode, PublicRouteEndpoint } from '../types';

export const WORLD_MAP_BOUNDS = {
  minLat: -85,
  maxLat: 85,
  minLng: -180,
  maxLng: 180
};

export function isMappableLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat !== 0 &&
    lng !== 0 &&
    lat >= WORLD_MAP_BOUNDS.minLat &&
    lat <= WORLD_MAP_BOUNDS.maxLat &&
    lng >= WORLD_MAP_BOUNDS.minLng &&
    lng <= WORLD_MAP_BOUNDS.maxLng
  );
}

export function isMappableNode(node: PublicNode): boolean {
  return isMappableLatLng(node.latitude, node.longitude);
}

export function isMappableEndpoint(endpoint: PublicRouteEndpoint): boolean {
  return isMappableLatLng(endpoint.lat, endpoint.lng);
}
