import { describe, expect, it } from 'vitest';
import {
  createRouteMapGifBlob,
  routeGifAnimationDurationMs,
  routeGifFilename,
  routeGifFrameProgress,
  routeGifRoutePoints
} from './routeGifExport';
import type { PublicPacketPath } from './types';

const packet = (): PublicPacketPath => ({
  id: 'packet-1',
  at: Date.UTC(2026, 5, 6, 12, 0, 0),
  region: 'YYZ',
  payloadTypeName: 'GROUP_TEXT',
  hopCount: 2,
  segmentCount: 2,
  distanceKm: 42.5,
  routeIds: ['r1', 'r2'],
  endpointLabels: ['Alpha Node', 'Charlie Node'],
  segments: [
    {
      routeId: 'r1',
      distanceKm: 20,
      from: { nodeId: 'a', label: 'Alpha Node', lat: 43.65, lng: -79.38 },
      to: { nodeId: 'b', label: 'Bravo Node', lat: 43.75, lng: -79.1 }
    },
    {
      routeId: 'r2',
      distanceKm: 22.5,
      from: { nodeId: 'b', label: 'Bravo Node', lat: 43.75, lng: -79.1 },
      to: { nodeId: 'c', label: 'Charlie Node', lat: 43.92, lng: -78.95 }
    }
  ]
});

describe('route GIF export helpers', () => {
  it('dedupes connected segment endpoints into one public route path', () => {
    const points = routeGifRoutePoints(packet());
    expect(points.map((point) => point.label)).toEqual(['Alpha Node', 'Bravo Node', 'Charlie Node']);
  });

  it('uses a frame duration that matches the GIF cadence', () => {
    expect(routeGifAnimationDurationMs(61, 12)).toBe(5000);
  });

  it('uses a monotonic eased packet progress', () => {
    const values = Array.from({ length: 10 }, (_, index) => routeGifFrameProgress(index, 10));
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
    }
  });

  it('builds a safe social filename from the route summary', () => {
    expect(routeGifFilename(packet())).toBe('mc-cartolive-yyz-alpha-node-charlie-node-2026-06-06.gif');
  });

  it('encodes captured map frames instead of drawing a synthetic route', async () => {
    const calls: number[] = [];
    const blob = await createRouteMapGifBlob(
      packet(),
      ({ frameIndex, progress, width, height }) => {
        calls.push(progress);
        const data = new Uint8ClampedArray(width * height * 4);
        for (let index = 0; index < data.length; index += 4) {
          data[index] = frameIndex % 2 === 0 ? 12 : 220;
          data[index + 1] = 40;
          data[index + 2] = 80;
          data[index + 3] = 255;
        }
        return { data, width, height } as ImageData;
      },
      { width: 4, height: 4, frames: 8, fps: 4 }
    );
    expect(blob.type).toBe('image/gif');
    expect(calls).toHaveLength(8);
    expect(calls[0]).toBe(0);
    expect(calls.at(-1)).toBe(1);
  });
});
