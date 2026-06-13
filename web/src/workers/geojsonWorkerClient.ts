export interface GeoJSONTransformRequest<TPayload = unknown> {
  id: string;
  type: 'nodes' | 'routes' | 'heatmap' | 'history' | 'propagation' | 'analysis';
  payload: TPayload;
}

export interface GeoJSONTransformResponse<TGeoJSON = unknown> {
  id: string;
  sourceId: string;
  signature: string;
  geojson: TGeoJSON;
}

export type GeoJSONTransformHandler<TPayload = unknown, TGeoJSON = unknown> = (request: GeoJSONTransformRequest<TPayload>) => GeoJSONTransformResponse<TGeoJSON>;

export interface GeoJSONWorkerClient<TPayload = unknown, TGeoJSON = unknown> {
  transform: (request: Omit<GeoJSONTransformRequest<TPayload>, 'id'>) => Promise<GeoJSONTransformResponse<TGeoJSON>>;
  dispose: () => void;
}

export function createMainThreadGeoJSONClient<TPayload, TGeoJSON>(handler: GeoJSONTransformHandler<TPayload, TGeoJSON>): GeoJSONWorkerClient<TPayload, TGeoJSON> {
  let nextID = 0;
  let disposed = false;
  let latestID = '';
  return {
    transform: async (request) => {
      if (disposed) throw new Error('geojson transform client disposed');
      const id = `geojson-${++nextID}`;
      latestID = id;
      const response = handler({ ...request, id });
      if (response.id !== latestID) {
        throw new Error('stale geojson transform response');
      }
      return response;
    },
    dispose: () => {
      disposed = true;
    }
  };
}

export function geoJSONSignature(parts: readonly unknown[]): string {
  return parts.map((part) => {
    if (typeof part === 'string' || typeof part === 'number' || typeof part === 'boolean') return String(part);
    if (Array.isArray(part)) return String(part.length);
    if (part && typeof part === 'object') return String(Object.keys(part).length);
    return '';
  }).join('|');
}
