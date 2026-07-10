export interface SharedViewState {
  lat: number;
  lng: number;
  z: number;
  pitch?: number;
  bearing?: number;
  route?: string;
  node?: string;
  q?: string;
  studio?: boolean;
  replayPacket?: string;
  replayRoute?: string;
}

export interface MapViewState {
  lat: number;
  lng: number;
  z: number;
  pitch?: number;
  bearing?: number;
}

export function parseSharedView(search: string): SharedViewState | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  if (!params.has('lat') || !params.has('lng') || !params.has('z')) return null;
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const z = Number(params.get('z'));
  const pitch = optionalNumberParam(params, 'pitch');
  const bearing = optionalNumberParam(params, 'bearing');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(z)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || z < 0 || z > 24) return null;
  if (pitch !== undefined && (!Number.isFinite(pitch) || pitch < 0 || pitch > 85)) return null;
  if (bearing !== undefined && (!Number.isFinite(bearing) || bearing < -180 || bearing > 180)) return null;
  const route = safePublicIdentifier(params.get('route'));
  const node = route ? undefined : safePublicIdentifier(params.get('node'));
  const q = undefined;
  const studio = params.get('studio') === '1';
  const replayPacket = safePublicIdentifier(params.get('replayPacket'));
  const replayRoute = safePublicIdentifier(params.get('replayRoute'));
  return { lat, lng, z, ...(pitch !== undefined ? { pitch } : {}), ...(bearing !== undefined ? { bearing } : {}), route, node, q, ...(studio ? { studio, replayPacket, replayRoute } : {}) };
}

export function buildSharedViewURL(baseHref: string, view: MapViewState, options: { route?: string | null; node?: string | null; q?: string; studio?: boolean; replayPacket?: string; replayRoute?: string }): string {
  const url = new URL(baseHref);
  url.searchParams.set('lat', fixedCoordinate(view.lat));
  url.searchParams.set('lng', fixedCoordinate(view.lng));
  url.searchParams.set('z', fixedZoom(view.z));
  setOptionalNumberParam(url, 'pitch', view.pitch, fixedCameraAngle);
  setOptionalNumberParam(url, 'bearing', view.bearing, fixedCameraAngle);
  url.searchParams.delete('route');
  url.searchParams.delete('node');
  const routeID = safePublicIdentifier(options.route);
  const nodeID = safePublicIdentifier(options.node);
  if (routeID) {
    url.searchParams.set('route', routeID);
  } else if (nodeID) {
    url.searchParams.set('node', nodeID);
  }
  url.searchParams.delete('q');
  for (const key of ['studio', 'replayPacket', 'replayRoute']) url.searchParams.delete(key);
  if (options.studio) {
    url.searchParams.set('studio', '1');
    const packetID = safePublicIdentifier(options.replayPacket);
    const routeID = safePublicIdentifier(options.replayRoute);
    if (packetID) url.searchParams.set('replayPacket', packetID);
    if (routeID) url.searchParams.set('replayRoute', routeID);
  }
  return url.toString();
}

function safePublicIdentifier(value: string | null | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && /^[a-zA-Z0-9._:-]{1,96}$/.test(candidate) ? candidate : undefined;
}

function fixedCoordinate(value: number): string {
  return value.toFixed(5).replace(/\.?0+$/, '');
}

function fixedZoom(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function fixedCameraAngle(value: number): string {
  return value.toFixed(1).replace(/\.?0+$/, '');
}

function optionalNumberParam(params: URLSearchParams, key: string): number | undefined {
  if (!params.has(key)) return undefined;
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : Number.NaN;
}

function setOptionalNumberParam(url: URL, key: string, value: number | undefined, formatter: (value: number) => string) {
  if (Number.isFinite(value)) url.searchParams.set(key, formatter(value as number));
  else url.searchParams.delete(key);
}
