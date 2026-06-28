import type { GeoJSONTransformRequest } from './geojsonWorkerClient';
import { transformGeoJSON, type GeoJSONTransformPayload } from './geojsonTransforms';

type GeoJSONWorkerScope = {
  addEventListener: typeof self.addEventListener;
  postMessage: (message: unknown) => void;
};

const workerScope = self as unknown as GeoJSONWorkerScope;

workerScope.addEventListener('message', (event: MessageEvent<GeoJSONTransformRequest<GeoJSONTransformPayload>>) => {
  try {
    workerScope.postMessage(transformGeoJSON(event.data));
  } catch (error) {
    workerScope.postMessage({
      id: event.data?.id,
      error: error instanceof Error ? error.message : 'geojson transform failed'
    });
  }
});
