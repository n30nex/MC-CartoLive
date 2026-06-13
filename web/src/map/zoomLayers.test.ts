import { describe, expect, it } from 'vitest';
import { mapOverlayStyle, WEATHER_CLOUD_FADE_END_ZOOM, WEATHER_CLOUD_OPACITY, weatherCloudRasterLayer } from './CanadaMap';
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

  it('uses restrained OpenFreeMap terrain relief and keeps 3D buildings out of low zoom', () => {
    const colorRelief = layer('meshcore-elevation-color-relief') as any;
    const hillshade = layer('meshcore-topographic-hillshade') as any;
    expect(colorRelief?.type).toBe('color-relief');
    expect(colorRelief?.layout?.visibility).toBe('none');
    expect(JSON.stringify(colorRelief?.paint?.['color-relief-color'])).toContain('elevation');
    expect(maxExpressionNumber(colorRelief?.paint?.['color-relief-opacity'])).toBeLessThanOrEqual(0.12);
    expect(hillshade?.layout?.visibility).toBe('none');
    expect(hillshade?.paint?.['hillshade-illumination-anchor']).toBe('map');
    expect(hillshade?.paint?.['hillshade-exaggeration']).toBeLessThanOrEqual(0.46);
    expect(layerIndex('meshcore-elevation-color-relief')).toBeLessThan(layerIndex('meshcore-topographic-hillshade'));
    expect(layerIndex('meshcore-topographic-hillshade')).toBeLessThan(layerIndex('dark-road'));
    expect((mapOverlayStyle.sources['meshcore-terrain-dem'] as any).encoding).toBe('terrarium');
    expect((mapOverlayStyle.sources['meshcore-hillshade-dem'] as any).attribution).toContain('Elevation tiles');
  });

  it('keeps weather clouds subtle and gone before detail zoom', () => {
    const weather = weatherCloudRasterLayer() as any;
    expect(WEATHER_CLOUD_FADE_END_ZOOM).toBeLessThan(DETAIL_MIN_ZOOM);
    expect(weather.maxzoom).toBe(WEATHER_CLOUD_FADE_END_ZOOM);
    expect(weather.paint['raster-opacity']).toBe(WEATHER_CLOUD_OPACITY);
    expect(weather.paint['raster-saturation']).toBeLessThan(0);
    expect(weather.paint['raster-fade-duration']).toBe(0);
    expect(WEATHER_CLOUD_OPACITY.at(-1)).toBe(0);
    const opacityStops = WEATHER_CLOUD_OPACITY.slice(3).filter((_: unknown, index: number) => index % 2 === 1) as number[];
    expect(Math.max(...opacityStops)).toBeLessThanOrEqual(0.28);
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

function layerIndex(id: string) {
  return mapOverlayStyle.layers.findIndex((item) => item.id === id);
}

function maxExpressionNumber(value: unknown): number {
  if (!Array.isArray(value)) return Number.NaN;
  return Math.max(...value.slice(3).filter((item: unknown, index: number) => index % 2 === 1 && typeof item === 'number') as number[]);
}
