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
  const latestIDByType = new Map<GeoJSONTransformRequest['type'], string>();
  return {
    transform: async (request) => {
      if (disposed) throw new Error('geojson transform client disposed');
      const id = `geojson-${++nextID}`;
      latestIDByType.set(request.type, id);
      const response = handler({ ...request, id });
      if (response.id !== latestIDByType.get(request.type)) {
        throw new Error('stale geojson transform response');
      }
      return response;
    },
    dispose: () => {
      disposed = true;
    }
  };
}

export function createBrowserGeoJSONClient<TPayload, TGeoJSON>(
  handler: GeoJSONTransformHandler<TPayload, TGeoJSON>,
  createWorker: () => Worker = () => new Worker(new URL('./geojson.worker.ts', import.meta.url), { type: 'module' })
): GeoJSONWorkerClient<TPayload, TGeoJSON> {
  if (typeof Worker === 'undefined') {
    return createMainThreadGeoJSONClient(handler);
  }

  let worker: Worker | null = null;
  try {
    worker = createWorker();
  } catch {
    return createMainThreadGeoJSONClient(handler);
  }

  let nextID = 0;
  let disposed = false;
  const latestIDByType = new Map<GeoJSONTransformRequest['type'], string>();
  const pending = new Map<string, {
    type: GeoJSONTransformRequest['type'];
    resolve: (response: GeoJSONTransformResponse<TGeoJSON>) => void;
    reject: (error: Error) => void;
  }>();

  const rejectAll = (error: Error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  worker.addEventListener('message', (event: MessageEvent<GeoJSONTransformResponse<TGeoJSON> | { id?: string; error?: string }>) => {
    const data = event.data;
    const id = typeof data?.id === 'string' ? data.id : '';
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if ('error' in data && data.error) {
      request.reject(new Error(data.error));
      return;
    }
    if (id !== latestIDByType.get(request.type)) {
      request.reject(new Error('stale geojson transform response'));
      return;
    }
    request.resolve(data as GeoJSONTransformResponse<TGeoJSON>);
  });
  worker.addEventListener('error', (event) => {
    rejectAll(new Error(event.message || 'geojson worker error'));
  });
  worker.addEventListener('messageerror', () => {
    rejectAll(new Error('geojson worker message error'));
  });

  return {
    transform: (request) => {
      if (disposed || worker === null) return Promise.reject(new Error('geojson transform client disposed'));
      const id = `geojson-${++nextID}`;
      latestIDByType.set(request.type, id);
      return new Promise((resolve, reject) => {
        pending.set(id, { type: request.type, resolve, reject });
        worker?.postMessage({ ...request, id });
      });
    },
    dispose: () => {
      disposed = true;
      rejectAll(new Error('geojson transform client disposed'));
      worker?.terminate();
      worker = null;
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
