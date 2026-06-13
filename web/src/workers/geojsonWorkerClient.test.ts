import { describe, expect, it } from 'vitest';
import { createMainThreadGeoJSONClient, geoJSONSignature } from './geojsonWorkerClient';

describe('geojsonWorkerClient', () => {
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
});
