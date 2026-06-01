import { describe, expect, it } from 'vitest';
import type { PublicRoutePulse } from '../types';
import {
  buildPacketReplayChasePath,
  pointAlongReplayChasePath,
  replayChaseBearing,
  replayChaseBearingAt,
  replayChaseCameraFrame,
  replayChaseFollowDistanceKm,
  replayChaseLookaheadDistanceKm,
  replayChasePitchForDistance,
  replayChaseZoomForDistance
} from './packetReplayChase';
import { sampleRouteArc } from './routeArcs';

type Segment = PublicRoutePulse['segments'][number];

describe('packet replay chase helpers', () => {
  it('builds replay chase points from route arc samples', () => {
    const segment = makeSegment({ lat: 43.65, lng: -79.38 }, { lat: 45.42, lng: -75.69 }, 350);
    const path = buildPacketReplayChasePath([segment]);
    const arc = sampleRouteArc(segment.from, segment.to, { distanceKm: 350 });

    expect(path.totalDistanceKm).toBe(350);
    expect(path.points).toHaveLength(arc.length);
    expect(path.points[0]).toMatchObject({ lng: -79.38, lat: 43.65, altitudeMeters: 0, distanceKm: 0, progress: 0 });
    expect(path.points[path.points.length - 1]).toMatchObject({
      lng: -75.69,
      lat: 45.42,
      altitudeMeters: expect.closeTo(0, 6),
      distanceKm: 350,
      progress: 1
    });

    const midpoint = path.points[Math.floor(path.points.length / 2)];
    const arcMidpoint = arc[Math.floor(arc.length / 2)];
    expect(midpoint.altitudeMeters).toBe(arcMidpoint.altitudeMeters);
    expect(midpoint.progress).toBeCloseTo(midpoint.distanceKm / path.totalDistanceKm, 6);
  });

  it('interpolates across long multi-hop routes by global progress', () => {
    const path = buildPacketReplayChasePath([
      makeSegment({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 100),
      makeSegment({ lat: 0, lng: 10 }, { lat: 10, lng: 10 }, 300)
    ]);

    const firstHopEnd = pointAlongReplayChasePath(path, 0.25);
    expect(firstHopEnd.distanceKm).toBeCloseTo(100, 6);
    expect(firstHopEnd.lng).toBeCloseTo(10, 6);
    expect(firstHopEnd.lat).toBeCloseTo(0, 6);

    const secondHopMidpoint = pointAlongReplayChasePath(path, 0.625);
    expect(secondHopMidpoint.distanceKm).toBeCloseTo(250, 6);
    expect(secondHopMidpoint.lng).toBeCloseTo(10, 6);
    expect(secondHopMidpoint.lat).toBeCloseTo(5, 6);
    expect(secondHopMidpoint.altitudeMeters).toBeGreaterThan(0);
    expect(secondHopMidpoint.progress).toBeCloseTo(0.625, 6);
  });

  it('handles empty, invalid, and zero-distance segments without unsafe numbers', () => {
    const emptyPath = buildPacketReplayChasePath([]);
    expect(emptyPath).toEqual({ points: [], totalDistanceKm: 0 });
    expect(pointAlongReplayChasePath(emptyPath, 0.5)).toEqual({
      lng: 0,
      lat: 0,
      altitudeMeters: 0,
      distanceKm: 0,
      progress: 0
    });

    const path = buildPacketReplayChasePath([
      makeSegment({ lat: Number.NaN, lng: -79 }, { lat: 45, lng: -75 }, 100),
      makeSegment({ lat: 50, lng: -100 }, { lat: 50, lng: -100 }, 0),
      makeSegment({ lat: 50, lng: -100 }, { lat: 51, lng: -101 }, Number.NaN)
    ]);

    expect(path.totalDistanceKm).toBeGreaterThan(0);
    expect(path.points[0]).toMatchObject({ lat: 50, lng: -100, distanceKm: 0, progress: 0 });
    expect(path.points.every((point) => Object.values(point).every(Number.isFinite))).toBe(true);
    expect(pointAlongReplayChasePath(path, -1).progress).toBe(0);
    expect(pointAlongReplayChasePath(path, 2).progress).toBe(1);
  });

  it('computes dateline-safe bearings for worldwide coordinates', () => {
    const bearing = replayChaseBearing(
      { lat: 10, lng: 179, altitudeMeters: 0, distanceKm: 0, progress: 0 },
      { lat: 10, lng: -179, altitudeMeters: 0, distanceKm: 1, progress: 1 }
    );

    expect(bearing).toBeGreaterThan(80);
    expect(bearing).toBeLessThan(100);
  });

  it('uses lookahead bearing along a chase path', () => {
    const path = buildPacketReplayChasePath([
      makeSegment({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 100),
      makeSegment({ lat: 0, lng: 10 }, { lat: 10, lng: 10 }, 100)
    ]);

    expect(replayChaseBearingAt(path, 0.1)).toBeCloseTo(90, 1);
    expect(replayChaseBearingAt(path, 0.75)).toBeCloseTo(0, 1);
    expect(replayChaseBearingAt(path, 1)).toBeCloseTo(0, 1);
  });

  it('keeps chase zoom in distance bands and tolerates invalid inputs', () => {
    expect(replayChaseZoomForDistance(700, 7)).toBe(7.7);
    expect(replayChaseZoomForDistance(200, 8)).toBe(9);
    expect(replayChaseZoomForDistance(40, 11)).toBe(12.3);
    expect(replayChaseZoomForDistance(Number.NaN, Number.NaN)).toBe(9.2);
  });

  it('builds cinematic chase camera frames behind the packet with lookahead bearing', () => {
    const path = buildPacketReplayChasePath([
      makeSegment({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 100)
    ]);

    const frame = replayChaseCameraFrame(path, 0.5, 8);

    expect(frame.subject.lng).toBeCloseTo(5, 1);
    expect(frame.center.lng).toBeLessThan(frame.subject.lng);
    expect(frame.lookahead.lng).toBeGreaterThan(frame.subject.lng);
    expect(frame.bearing).toBeCloseTo(90, 1);
    expect(frame.pitch).toBe(68);
    expect(frame.zoom).toBeGreaterThan(9);
  });

  it('scales chase follow distance, lookahead, and pitch by route distance', () => {
    expect(replayChaseFollowDistanceKm(60)).toBeGreaterThan(0.5);
    expect(replayChaseFollowDistanceKm(800)).toBeGreaterThan(replayChaseFollowDistanceKm(60));
    expect(replayChaseLookaheadDistanceKm(800)).toBeGreaterThan(replayChaseFollowDistanceKm(800));
    expect(replayChasePitchForDistance(40)).toBe(68);
    expect(replayChasePitchForDistance(300)).toBe(64);
    expect(replayChasePitchForDistance(900)).toBe(60);
  });
});

function makeSegment(from: { lat: number; lng: number }, to: { lat: number; lng: number }, distanceKm: number): Segment {
  return {
    routeId: `${from.lat},${from.lng}-${to.lat},${to.lng}`,
    from: { nodeId: 'from', label: 'from', ...from },
    to: { nodeId: 'to', label: 'to', ...to },
    distanceKm
  };
}
