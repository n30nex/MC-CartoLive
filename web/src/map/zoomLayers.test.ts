import { describe, expect, it } from 'vitest';
import { mapOverlayStyle } from './CanadaMap';
import { DETAIL_MIN_ZOOM } from './zoomMode';

describe('map zoom layer consistency', () => {
  it('keeps idle routes, route focus glow, nodes, labels, and observers behind the same detail zoom gate', () => {
    for (const id of ['route-focus-glow', 'route-lines', 'selected-node-halo', 'node-symbols', 'node-map-labels', 'observer-symbols', 'observer-map-labels']) {
      expect(layer(id)?.minzoom).toBe(DETAIL_MIN_ZOOM);
    }
  });

  it('allows bounded recent packet glows below detail zoom without exposing all idle routes', () => {
    expect(layer('route-payload-glow')?.minzoom).toBeLessThan(DETAIL_MIN_ZOOM);
  });

  it('keeps only highlighted analysis paths visible at low zoom', () => {
    expect(layer('analysis-route-overview-glow')?.minzoom).toBeUndefined();
    expect(layer('analysis-route-overview-line')?.minzoom).toBeUndefined();
    expect(mapOverlayStyle.sources['analysis-route-paths']).toBeTruthy();
  });

  it('adds propagation insight layers at detail zoom with a dedicated public source', () => {
    expect(mapOverlayStyle.sources['propagation-events']).toBeTruthy();
    expect(layer('propagation-event-glow')?.minzoom).toBe(DETAIL_MIN_ZOOM);
    expect(layer('propagation-event-line')?.minzoom).toBe(DETAIL_MIN_ZOOM);
    expect(layer('propagation-event-labels')?.minzoom).toBe(DETAIL_MIN_ZOOM);
  });

  it('keeps all cluster-only layers below detail mode', () => {
    for (const item of mapOverlayStyle.layers) {
      if (item.id === 'node-clusters' || item.id === 'node-cluster-counts' || item.id.startsWith('node-cluster-role-') || item.id.startsWith('cluster-activity-')) {
        expect(item.maxzoom).toBe(DETAIL_MIN_ZOOM);
      }
    }
  });

  it('uses restrained OpenFreeMap terrain and keeps 3D buildings out of low zoom', () => {
    const hillshade = layer('meshcore-topographic-hillshade') as any;
    expect(hillshade?.paint?.['hillshade-exaggeration']).toBeLessThanOrEqual(0.54);
    expect((mapOverlayStyle.sources['meshcore-terrain-dem'] as any).encoding).toBe('terrarium');
    expect((mapOverlayStyle.sources['meshcore-hillshade-dem'] as any).attribution).toContain('Elevation tiles');
  });

  it('aggregates role counts on the clustered node source', () => {
    const source = mapOverlayStyle.sources['public-nodes'] as any;
    expect(source.cluster).toBe(true);
    expect(source.clusterProperties).toMatchObject({
      repeaterCount: expect.any(Array),
      companionCount: expect.any(Array),
      roomCount: expect.any(Array),
      observerCount: expect.any(Array),
      otherCount: expect.any(Array)
    });
  });
});

function layer(id: string) {
  return mapOverlayStyle.layers.find((item) => item.id === id);
}
