import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserGeoJSONClient, createMainThreadGeoJSONClient, geoJSONSignature, type GeoJSONTransformResponse } from './geojsonWorkerClient';

describe('geojsonWorkerClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { Worker?: typeof Worker }).Worker;
  });

  it('runs transforms through a request id contract', async () => {
    const client = createMainThreadGeoJSONClient((request) => ({
      id: request.id,
      sourceId: 'routes',
      signature: geoJSONSignature([request.type, [1, 2, 3]]),
      geojson: { type: 'FeatureCollection', features: [] }
    }));

    await expect(client.transform({ type: 'routes', payload: {} })).resolves.toMatchObject({
      sourceId: 'routes',
      signature: 'routes|3'
    });
  });

  it('rejects after disposal', async () => {
    const client = createMainThreadGeoJSONClient((request) => ({
      id: request.id,
      sourceId: 'nodes',
      signature: 'nodes',
      geojson: {}
    }));
    client.dispose();
    await expect(client.transform({ type: 'nodes', payload: {} })).rejects.toThrow(/disposed/);
  });

  it('uses a browser worker when available', async () => {
    type Listener = (event: MessageEvent<GeoJSONTransformResponse>) => void;
    const listeners: Listener[] = [];
    class FakeWorker {
      addEventListener(type: string, listener: Listener) {
        if (type === 'message') listeners.push(listener);
      }
      postMessage(message: { id: string; type: string }) {
        queueMicrotask(() => {
          listeners.forEach((listener) => listener({
            data: {
              id: message.id,
              sourceId: message.type,
              signature: message.type,
              geojson: { type: 'FeatureCollection', features: [] }
            }
          } as MessageEvent<GeoJSONTransformResponse>));
        });
      }
      terminate() {}
    }
    (globalThis as { Worker?: typeof Worker }).Worker = FakeWorker as unknown as typeof Worker;
    const handler = vi.fn();
    const client = createBrowserGeoJSONClient(handler, () => new FakeWorker() as unknown as Worker);

    await expect(client.transform({ type: 'routes', payload: {} })).resolves.toMatchObject({
      sourceId: 'routes',
      signature: 'routes'
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
