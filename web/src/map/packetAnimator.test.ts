import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PACKET_AFTERGLOW_MS,
  PACKET_MAX_TRAVEL_DURATION_MS,
  PACKET_SINGLE_HOP_DURATION_MS,
  OBSERVER_AURA_ALPHA_CAP,
  ROUTE_RESIDUE_ALPHA_CAP,
  CANVAS_MAX_DPR,
  MASK_CACHE_INTERVAL_MS,
  MAX_OBSERVER_AURA_LOCATIONS,
  MAX_ACTIVE_OBSERVER_BURSTS,
  MAX_OBSERVER_BURSTS_PER_LOCATION,
  OBSERVER_AURA_WINDOW_MS,
  OBSERVER_BURST_LOCATION_INTERVAL_MS,
  MAX_ROUTE_SPARKLES_PER_TRACE,
  MAX_TRACE_AURA_ROUTES,
  RESIDUE_IDLE_FRAME_INTERVAL_MS,
  ROUTE_SPARKLE_WINDOW_MS,
  PacketAnimator,
  clusterMaskRadius,
  mapFeatureMaskRadius,
  nodeMaskRadius,
  observerAuraAlpha,
  observerBurstAllowed,
  observerBurstKey,
  packetTravelDuration,
  routeResidueAlpha,
  routeResidueSparkleAlpha,
  routeResidueSparkleCount,
  sequentialSegmentProgress
} from './packetAnimator';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('packet animation timing', () => {
  it('uses fast-readable bounded travel durations', () => {
    expect(packetTravelDuration(1)).toBe(PACKET_SINGLE_HOP_DURATION_MS);
    expect(packetTravelDuration(1, 2)).toBe(Math.round(PACKET_SINGLE_HOP_DURATION_MS / 2));
    expect(packetTravelDuration(2)).toBeGreaterThan(PACKET_SINGLE_HOP_DURATION_MS);
    expect(packetTravelDuration(99)).toBe(PACKET_MAX_TRAVEL_DURATION_MS);
    expect(PACKET_AFTERGLOW_MS).toBe(1200);
  });

  it('advances multi-hop packets sequentially segment by segment', () => {
    expect(sequentialSegmentProgress(0, 3)).toEqual({ segmentIndex: 0, localProgress: 0 });
    const middle = sequentialSegmentProgress(0.4, 3);
    expect(middle.segmentIndex).toBe(1);
    expect(middle.localProgress).toBeCloseTo(0.2);
    const late = sequentialSegmentProgress(0.7, 3);
    expect(late.segmentIndex).toBe(2);
    expect(late.localProgress).toBeCloseTo(0.1);
    expect(sequentialSegmentProgress(1, 3)).toEqual({ segmentIndex: 2, localProgress: 1 });
  });

  it('cuts packet canvas around visible cluster bubbles and node markers', () => {
    expect(clusterMaskRadius(13)).toBe(25);
    expect(clusterMaskRadius(25)).toBe(30);
    expect(clusterMaskRadius(100)).toBe(36);
    expect(nodeMaskRadius(false, 3)).toBeCloseTo(7.04);
    expect(nodeMaskRadius(false, 8)).toBeCloseTo(11.36);
    expect(nodeMaskRadius(false, 12)).toBeCloseTo(14);
    expect(nodeMaskRadius(true, 12)).toBeCloseTo(16);
    expect(mapFeatureMaskRadius({ point_count: 100 })).toBe(36);
    expect(mapFeatureMaskRadius({ selected: true }, 12)).toBeCloseTo(16);
  });

  it('caps neon residue and observer aura intensity for readability', () => {
    expect(routeResidueAlpha(0, 1)).toBe(0);
    expect(routeResidueAlpha(1, 1)).toBeGreaterThan(0);
    expect(routeResidueAlpha(999, 1)).toBeCloseTo(ROUTE_RESIDUE_ALPHA_CAP);
    expect(routeResidueAlpha(999, 0.5)).toBeLessThanOrEqual(ROUTE_RESIDUE_ALPHA_CAP);
    expect(routeResidueAlpha(999, 0)).toBe(0);
    expect(observerAuraAlpha(0, 1)).toBe(0);
    expect(observerAuraAlpha(999, 1)).toBeCloseTo(OBSERVER_AURA_ALPHA_CAP);
    expect(observerAuraAlpha(999, 0)).toBe(0);
  });

  it('keeps expensive overlay work bounded for smooth desktop animation', () => {
    expect(CANVAS_MAX_DPR).toBeLessThanOrEqual(1.5);
    expect(RESIDUE_IDLE_FRAME_INTERVAL_MS).toBeGreaterThanOrEqual(80);
    expect(MASK_CACHE_INTERVAL_MS).toBeGreaterThanOrEqual(100);
    expect(MAX_TRACE_AURA_ROUTES).toBeLessThanOrEqual(200);
    expect(MAX_OBSERVER_AURA_LOCATIONS).toBeLessThanOrEqual(140);
    expect(MAX_ACTIVE_OBSERVER_BURSTS).toBe(24);
    expect(MAX_OBSERVER_BURSTS_PER_LOCATION).toBe(1);
    expect(OBSERVER_AURA_WINDOW_MS).toBe(150_000);
  });

  it('bounds recent route sparkle residue for visible but cheap packet trails', () => {
    expect(routeResidueSparkleCount(0, 100)).toBe(0);
    expect(routeResidueSparkleCount(1, 100)).toBe(1);
    expect(routeResidueSparkleCount(999, 100)).toBe(MAX_ROUTE_SPARKLES_PER_TRACE);
    expect(routeResidueSparkleCount(999, ROUTE_SPARKLE_WINDOW_MS + 1)).toBe(0);
    expect(routeResidueSparkleAlpha(100, 1, 0.2)).toBeGreaterThan(0);
    expect(routeResidueSparkleAlpha(ROUTE_SPARKLE_WINDOW_MS + 1, 1, 0.2)).toBe(0);
  });

  it('caps observer burst pressure by total, location, and interval', () => {
    expect(observerBurstAllowed(MAX_ACTIVE_OBSERVER_BURSTS - 1, 0, undefined, 2000)).toBe(true);
    expect(observerBurstAllowed(MAX_ACTIVE_OBSERVER_BURSTS, 0, undefined, 2000)).toBe(false);
    expect(observerBurstAllowed(1, MAX_OBSERVER_BURSTS_PER_LOCATION, undefined, 2000)).toBe(false);
    expect(observerBurstAllowed(1, 0, 2000 - OBSERVER_BURST_LOCATION_INTERVAL_MS + 1, 2000)).toBe(false);
    expect(observerBurstAllowed(1, 0, 2000 - OBSERVER_BURST_LOCATION_INTERVAL_MS, 2000)).toBe(true);
    expect(observerBurstKey({ location: { label: 'Toronto', iata: 'YYZ', lat: 43.65322, lng: -79.38318 } })).toBe('Toronto|YYZ|43.6532|-79.3832');
  });

  it('schedules a bound animation frame during construction', () => {
    const callbacks: FrameRequestCallback[] = [];
    const originalRAF = window.requestAnimationFrame;
    const originalCancelRAF = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ width: 120, height: 80 })
    });
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      setTransform: vi.fn()
    } as unknown as CanvasRenderingContext2D);
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      getLayer: vi.fn(() => false),
      getZoom: vi.fn(() => 8),
      queryRenderedFeatures: vi.fn(() => [])
    };

    const animator = new PacketAnimator(map as any, canvas);
    expect(callbacks).toHaveLength(1);
    expect(() => callbacks[0](0)).not.toThrow();
    animator.destroy();
    window.requestAnimationFrame = originalRAF;
    window.cancelAnimationFrame = originalCancelRAF;
  });

  it('records route and observer residue hits when live visuals are accepted', () => {
    const originalRAF = window.requestAnimationFrame;
    const originalCancelRAF = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn(() => 1) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ width: 120, height: 80 })
    });
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      setTransform: vi.fn()
    } as unknown as CanvasRenderingContext2D);
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      getLayer: vi.fn(() => false),
      getZoom: vi.fn(() => 8),
      queryRenderedFeatures: vi.fn(() => [])
    };

    const animator = new PacketAnimator(map as any, canvas);
    animator.add({
      id: 'pulse-1',
      payloadTypeName: 'PLAIN_TEXT',
      heardAt: Date.now(),
      segments: [
        {
          routeId: 'r-ab',
          from: { nodeId: 'node-a', label: 'A', lat: 43.45, lng: -80.49 },
          to: { nodeId: 'node-b', label: 'B', lat: 43.65, lng: -79.38 },
          distanceKm: 93
        }
      ]
    });
    animator.addObserverBurst({
      id: 'observer-1',
      payloadTypeName: 'PLAIN_TEXT',
      heardAt: Date.now(),
      location: { label: 'YYZ observer', iata: 'YYZ', lat: 43.65, lng: -79.38 }
    });

    expect((animator as any).traceHits).toHaveLength(1);
    expect((animator as any).observerBurstHits).toHaveLength(1);
    animator.destroy();
    window.requestAnimationFrame = originalRAF;
    window.cancelAnimationFrame = originalCancelRAF;
  });

  it('allows a forced packet replay while the live animator is paused', () => {
    const originalRAF = window.requestAnimationFrame;
    const originalCancelRAF = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn(() => 1) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ width: 120, height: 80 })
    });
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      setTransform: vi.fn()
    } as unknown as CanvasRenderingContext2D);
    const map = {
      on: vi.fn(),
      off: vi.fn(),
      getLayer: vi.fn(() => false),
      getZoom: vi.fn(() => 8),
      queryRenderedFeatures: vi.fn(() => [])
    };

    const animator = new PacketAnimator(map as any, canvas);
    animator.setPaused(true);
    animator.add({
      id: 'pulse-skipped',
      payloadTypeName: 'PLAIN_TEXT',
      heardAt: Date.now(),
      segments: [{
        routeId: 'r-skip',
        from: { nodeId: 'node-a', label: 'A', lat: 43.45, lng: -80.49 },
        to: { nodeId: 'node-b', label: 'B', lat: 43.65, lng: -79.38 },
        distanceKm: 93
      }]
    });
    expect((animator as any).pulses).toHaveLength(0);
    animator.add({
      id: 'pulse-forced',
      payloadTypeName: 'PLAIN_TEXT',
      heardAt: Date.now(),
      segments: [{
        routeId: 'r-force',
        from: { nodeId: 'node-a', label: 'A', lat: 43.45, lng: -80.49 },
        to: { nodeId: 'node-b', label: 'B', lat: 43.65, lng: -79.38 },
        distanceKm: 93
      }]
    }, { force: true, travelDurationMs: 6000, brightness: 1.4, trailScale: 1.5, animationStyle: 'pulse' });
    expect((animator as any).pulses).toHaveLength(1);
    expect((animator as any).pulses[0].travelDuration).toBe(6000);
    expect((animator as any).pulses[0].animationStyle).toBe('pulse');
    animator.destroy();
    window.requestAnimationFrame = originalRAF;
    window.cancelAnimationFrame = originalCancelRAF;
  });
});
