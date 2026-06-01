import type maplibregl from 'maplibre-gl';
import type { PublicObserverBurst, PublicRoutePulse } from '../types';
import {
  DEFAULT_MAP_LAYER_SETTINGS,
  DEFAULT_PACKET_VISUAL_SETTINGS,
  normalizeLayerSettings,
  normalizePacketVisualSettings,
  type MapLayerSettings,
  type PacketAnimationStyle,
  type PacketVisualSettings
} from '../mapSettings';
import { payloadVisual } from '../payloadVisuals';
import { recordPacketFrame, recordPacketSkippedFrame } from '../perfDiagnostics';
import { isMappableEndpoint } from './geo';

export const PACKET_SINGLE_HOP_DURATION_MS = 2100;
export const PACKET_MAX_TRAVEL_DURATION_MS = 3200;
export const PACKET_AFTERGLOW_MS = 1200;
export const ROUTE_TRACE_WINDOW_MS = 15 * 60_000;
export const OBSERVER_AURA_WINDOW_MS = 150_000;
export const OBSERVER_BURST_DURATION_MS = 5200;
export const OBSERVER_BURST_AFTERGLOW_MS = 3600;
export const ROUTE_RESIDUE_ALPHA_CAP = 0.12;
export const OBSERVER_AURA_ALPHA_CAP = 0.055;
export const CANVAS_MAX_DPR = 1.5;
export const RESIDUE_IDLE_FRAME_INTERVAL_MS = 90;
export const MASK_CACHE_INTERVAL_MS = 140;
export const MAX_TRACE_AURA_ROUTES = 180;
export const MAX_OBSERVER_AURA_LOCATIONS = 120;
export const MAX_ACTIVE_OBSERVER_BURSTS = 24;
export const MAX_OBSERVER_BURSTS_PER_LOCATION = 1;
export const OBSERVER_BURST_LOCATION_INTERVAL_MS = 4200;
export const ROUTE_SPARKLE_WINDOW_MS = 6500;
export const MAX_ROUTE_SPARKLES_PER_TRACE = 5;

const RESIDUE_PRUNE_INTERVAL_MS = 1000;

interface ActivePulse {
  pulse: PublicRoutePulse;
  segments: PublicRoutePulse['segments'];
  color: string;
  started: number;
  travelDuration: number;
  afterglowDuration: number;
  brightness: number;
  trailScale: number;
  animationStyle: PacketAnimationStyle;
  force: boolean;
}

interface TraceHit {
  routeId: string;
  color: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  addedAt: number;
}

interface TraceAggregate {
  routeId: string;
  color: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  count: number;
  latestAt: number;
}

interface ActiveObserverBurst {
  burst: PublicObserverBurst;
  started: number;
  duration: number;
  afterglowDuration: number;
  brightness: number;
}

interface ObserverBurstHit {
  key: string;
  color: string;
  location: { lat: number; lng: number };
  addedAt: number;
}

interface ObserverBurstAggregate {
  key: string;
  color: string;
  location: { lat: number; lng: number };
  count: number;
  latestAt: number;
}

interface PacketAnimatorOptions {
  maskLayerIDs?: string[];
  layerSettings?: MapLayerSettings;
  visualSettings?: PacketVisualSettings;
}

export interface PacketAnimationOptions {
  force?: boolean;
  travelDurationMs?: number;
  brightness?: number;
  trailScale?: number;
  animationStyle?: PacketAnimationStyle;
}

interface RenderedPointFeature {
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: Record<string, unknown>;
}

interface RelayOverlay {
  x: number;
  y: number;
  color: string;
  progress: number;
  alpha: number;
  mode: 'launch' | 'arrival';
}

interface ObserverOverlay {
  x: number;
  y: number;
  color: string;
  progress: number;
  alpha: number;
  label: string;
}

export class PacketAnimator {
  private ctx: CanvasRenderingContext2D;
  private map: maplibregl.Map;
  private pulses: ActivePulse[] = [];
  private traceHits: TraceHit[] = [];
  private observerBursts: ActiveObserverBurst[] = [];
  private observerBurstHits: ObserverBurstHit[] = [];
  private routeColors = new Map<string, string>();
  private raf = 0;
  private idleTimer = 0;
  private paused = false;
  private maskLayerIDs: string[];
  private backingWidth = 0;
  private backingHeight = 0;
  private backingDpr = 0;
  private displayWidth = 0;
  private displayHeight = 0;
  private canvasHasContent = false;
  private lastRenderedAt = 0;
  private forceNextFrame = true;
  private lastTracePruneAt = 0;
  private lastObserverPruneAt = 0;
  private traceAggregates: TraceAggregate[] = [];
  private observerBurstAggregates: ObserverBurstAggregate[] = [];
  private traceAggregatesDirty = true;
  private observerAggregatesDirty = true;
  private maskFeatures: RenderedPointFeature[] = [];
  private nextMaskRefreshAt = 0;
  private observerBurstLastAtByLocation = new Map<string, number>();
  private layerSettings = DEFAULT_MAP_LAYER_SETTINGS;
  private visualSettings = DEFAULT_PACKET_VISUAL_SETTINGS;
  private handleMapMotion = () => {
    this.forceNextFrame = true;
    this.requestFrame();
  };

  constructor(map: maplibregl.Map, private canvas: HTMLCanvasElement, options: PacketAnimatorOptions = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas context unavailable');
    this.ctx = ctx;
    this.map = map;
    this.maskLayerIDs = options.maskLayerIDs ?? [];
    this.layerSettings = normalizeLayerSettings(options.layerSettings);
    this.visualSettings = normalizePacketVisualSettings(options.visualSettings);
    this.frame = this.frame.bind(this);
    this.resize();
    this.map.on('move', this.handleMapMotion);
    this.map.on('zoom', this.handleMapMotion);
    this.requestFrame();
  }

  private requestFrame(delayMs = 0) {
    if (this.raf !== 0) return;
    if (delayMs > 0) {
      if (this.idleTimer !== 0) return;
      this.idleTimer = window.setTimeout(() => {
        this.idleTimer = 0;
        this.requestFrame();
      }, delayMs);
      return;
    }
    if (this.idleTimer !== 0) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = 0;
    }
    this.raf = window.requestAnimationFrame(this.frame);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(CANVAS_MAX_DPR, window.devicePixelRatio || 1);
    this.displayWidth = Math.max(1, rect.width);
    this.displayHeight = Math.max(1, rect.height);
    const backingWidth = Math.max(1, Math.floor(rect.width * dpr));
    const backingHeight = Math.max(1, Math.floor(rect.height * dpr));
    if (backingWidth === this.backingWidth && backingHeight === this.backingHeight && dpr === this.backingDpr) return;
    this.backingWidth = backingWidth;
    this.backingHeight = backingHeight;
    this.backingDpr = dpr;
    this.canvas.width = backingWidth;
    this.canvas.height = backingHeight;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.nextMaskRefreshAt = 0;
    this.forceNextFrame = true;
    this.requestFrame();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) this.requestFrame();
  }

  setRouteColors(colors: Map<string, string>) {
    this.routeColors = colors;
  }

  setVisualSettings(settings: PacketVisualSettings) {
    this.visualSettings = normalizePacketVisualSettings(settings);
    this.forceNextFrame = true;
    this.requestFrame();
  }

  setLayerSettings(settings: MapLayerSettings) {
    this.layerSettings = normalizeLayerSettings(settings);
    this.forceNextFrame = true;
    if (!this.layerSettings.liveComets) this.pulses = [];
    this.requestFrame();
  }

  add(pulse: PublicRoutePulse, options: PacketAnimationOptions = {}) {
    const pulseOptions = { ...pulse.replayOptions, ...options };
    if ((this.paused && !pulseOptions.force) || pulse.segments.length === 0) return;
    const validSegments = pulse.segments.filter((segment) => isMappableEndpoint(segment.from) && isMappableEndpoint(segment.to));
    if (validSegments.length === 0) return;
    const now = performance.now();
    const color = payloadVisual(pulse.payloadTypeName).color;
    const brightness = clampRange(pulseOptions.brightness ?? this.visualSettings.brightness, 0.25, 2);
    const trailScale = clampRange(pulseOptions.trailScale ?? this.visualSettings.trail, 0, 2.5);
    const animationStyle = pulseOptions.animationStyle ?? this.visualSettings.animationStyle;
    for (const segment of validSegments) {
      this.traceHits.push({
        routeId: segment.routeId,
        color: color || this.routeColors.get(segment.routeId) || routeColorFromID(segment.routeId),
        from: { lat: segment.from.lat, lng: segment.from.lng },
        to: { lat: segment.to.lat, lng: segment.to.lng },
        addedAt: now
      });
    }
    this.traceHits = this.traceHits.slice(-4000);
    this.traceAggregatesDirty = true;
    this.pulses.push({
      pulse,
      segments: validSegments,
      color,
      started: now,
      travelDuration: clampDuration(pulseOptions.travelDurationMs ?? packetTravelDuration(validSegments.length, this.visualSettings.speed)),
      afterglowDuration: PACKET_AFTERGLOW_MS * Math.max(0.2, trailScale),
      brightness,
      trailScale,
      animationStyle,
      force: pulseOptions.force === true
    });
    this.pulses = this.pulses.slice(-240);
    this.requestFrame();
  }

  addObserverBurst(burst: PublicObserverBurst) {
    if (this.paused || !isMappableObserverLocation(burst.location)) return;
    const now = performance.now();
    this.observerBursts = this.observerBursts.filter(({ started, duration, afterglowDuration }) => now - started < duration + afterglowDuration);
    const locationKey = observerBurstKey(burst);
    this.observerBurstHits.push({
      key: locationKey,
      color: payloadVisual(burst.payloadTypeName).color,
      location: { lat: burst.location.lat, lng: burst.location.lng },
      addedAt: now
    });
    this.observerBurstHits = this.observerBurstHits.slice(-4000);
    this.observerAggregatesDirty = true;
    const activeForLocation = this.observerBursts.filter((active) => observerBurstKey(active.burst) === locationKey).length;
    if (activeForLocation > 0) {
      this.requestFrame();
      return;
    }
    if (!observerBurstAllowed(this.observerBursts.length, activeForLocation, this.observerBurstLastAtByLocation.get(locationKey), now)) {
      this.requestFrame();
      return;
    }
    this.observerBurstLastAtByLocation.set(locationKey, now);
    this.observerBursts.push({
      burst,
      started: now,
      duration: OBSERVER_BURST_DURATION_MS,
      afterglowDuration: OBSERVER_BURST_AFTERGLOW_MS,
      brightness: this.visualSettings.brightness
    });
    this.observerBursts = this.observerBursts.slice(-MAX_ACTIVE_OBSERVER_BURSTS);
    this.requestFrame();
  }

  clear() {
    this.pulses = [];
    this.observerBursts = [];
    this.traceHits = [];
    this.observerBurstHits = [];
    this.traceAggregates = [];
    this.observerBurstAggregates = [];
    this.traceAggregatesDirty = true;
    this.observerAggregatesDirty = true;
    this.ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);
    this.canvasHasContent = false;
  }

  destroy() {
    if (this.raf !== 0) window.cancelAnimationFrame(this.raf);
    if (this.idleTimer !== 0) window.clearTimeout(this.idleTimer);
    this.raf = 0;
    this.idleTimer = 0;
    this.map.off('move', this.handleMapMotion);
    this.map.off('zoom', this.handleMapMotion);
    this.traceHits = [];
    this.observerBurstHits = [];
    this.observerBurstLastAtByLocation.clear();
    this.clear();
  }

  private frame(now: number) {
    const frameStart = performance.now();
    this.raf = 0;
    if (this.paused && !this.pulses.some((pulse) => pulse.force)) {
      recordPacketSkippedFrame();
      return;
    }
    this.pruneResidue(now);
    this.pulses = this.pulses.filter(({ started, travelDuration, afterglowDuration }) => now - started < travelDuration + afterglowDuration);
    this.observerBursts = this.observerBursts.filter(({ started, duration, afterglowDuration }) => now - started < duration + afterglowDuration);
    const hasActiveMotion = this.pulses.length > 0 || this.observerBursts.length > 0;
    const hasResidue = this.traceHits.length > 0 || this.observerBurstHits.length > 0;
    if (!hasActiveMotion && !hasResidue) {
      if (this.canvasHasContent) {
        this.ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);
        this.canvasHasContent = false;
      }
      this.forceNextFrame = false;
      recordPacketFrame(0, 0, performance.now() - frameStart);
      return;
    }

    this.lastRenderedAt = now;
    this.forceNextFrame = false;
    this.ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);
    this.drawTraceAura(now);
    this.drawObserverAura(now);
    const relayOverlays: RelayOverlay[] = [];
    const observerOverlays: ObserverOverlay[] = [];
    for (const active of this.pulses) {
      this.draw(active, now, relayOverlays);
    }
    for (const active of this.observerBursts) {
      this.drawObserverBurst(active, now, observerOverlays);
    }
    if (this.pulses.length > 0 || this.observerBursts.length > 0) {
      this.maskRenderedMapLayers(now);
      this.drawRelayOverlays(relayOverlays);
      this.drawObserverOverlays(observerOverlays);
    }
    this.canvasHasContent = true;
    if (this.pulses.length > 0 || this.observerBursts.length > 0) {
      this.requestFrame();
    } else if (hasResidue) {
      this.requestFrame(RESIDUE_IDLE_FRAME_INTERVAL_MS);
    }
    recordPacketFrame(this.pulses.length, this.observerBursts.length, performance.now() - frameStart);
  }

  private pruneResidue(now: number) {
    if (now - this.lastTracePruneAt >= RESIDUE_PRUNE_INTERVAL_MS) {
      const nextTraceHits = pruneTraceHits(this.traceHits, now);
      if (nextTraceHits.length !== this.traceHits.length) {
        this.traceHits = nextTraceHits;
        this.traceAggregatesDirty = true;
      }
      this.lastTracePruneAt = now;
    }
    if (now - this.lastObserverPruneAt >= RESIDUE_PRUNE_INTERVAL_MS) {
      const nextObserverHits = pruneObserverBurstHits(this.observerBurstHits, now);
      if (nextObserverHits.length !== this.observerBurstHits.length) {
        this.observerBurstHits = nextObserverHits;
        this.observerAggregatesDirty = true;
      }
      this.lastObserverPruneAt = now;
    }
  }

  private draw(active: ActivePulse, now: number, relayOverlays: RelayOverlay[]) {
    const elapsed = now - active.started;
    const travelProgress = Math.min(1, elapsed / active.travelDuration);
    const afterglowProgress = Math.max(0, Math.min(1, (elapsed - active.travelDuration) / active.afterglowDuration));
    const afterglowAlpha = elapsed > active.travelDuration ? 1 - afterglowProgress : 1;
    const segments = active.segments;
    const segmentState = sequentialSegmentProgress(travelProgress, segments.length);
    const packetColor = active.color;

    this.ctx.save();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const color = packetColor || this.routeColors.get(segment.routeId) || routeColorFromID(segment.routeId);
      const from = this.map.project([segment.from.lng, segment.from.lat]);
      const to = this.map.project([segment.to.lng, segment.to.lat]);
      const shimmer = 0.5 + 0.5 * Math.sin(now / 92 + index * 1.7);

      if (elapsed > active.travelDuration) {
        this.drawAfterglowSegment(from.x, from.y, to.x, to.y, color, afterglowAlpha, shimmer, active.brightness, active.trailScale, active.animationStyle);
        continue;
      }

      if (index < segmentState.segmentIndex) {
        this.drawCompletedSegment(from.x, from.y, to.x, to.y, color, 1 - travelProgress, active.brightness, active.animationStyle);
        continue;
      }

      if (index === segmentState.segmentIndex) {
        this.drawCometSegment(from.x, from.y, to.x, to.y, color, segmentState.localProgress, shimmer, active.brightness, active.trailScale, active.animationStyle);
        if (active.animationStyle !== 'minimal' && segmentState.localProgress < 0.32) {
          relayOverlays.push({
            x: from.x,
            y: from.y,
            color,
            progress: segmentState.localProgress / 0.32,
            alpha: 0.42,
            mode: 'launch'
          });
        }
        if (active.animationStyle !== 'minimal' && segmentState.localProgress > 0.62) {
          relayOverlays.push({
            x: to.x,
            y: to.y,
            color,
            progress: (segmentState.localProgress - 0.62) / 0.38,
            alpha: 0.56,
            mode: 'arrival'
          });
        }
      }
    }
    this.ctx.restore();
  }

  private drawTraceAura(now: number) {
    if (!this.layerSettings.packetResidue || this.visualSettings.trail <= 0) return;
    const aggregates = this.traceAggregatesForFrame();
    this.ctx.save();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    for (const trace of aggregates) {
      const age = now - trace.latestAt;
      const fade = Math.max(0, 1 - age / ROUTE_TRACE_WINDOW_MS);
      const intensity = Math.min(1, Math.log1p(trace.count) / Math.log1p(18));
      const from = this.map.project([trace.from.lng, trace.from.lat]);
      const to = this.map.project([trace.to.lng, trace.to.lat]);
      const alpha = routeResidueAlpha(trace.count, fade) * this.visualSettings.brightness * this.visualSettings.trail;
      if (alpha <= 0.002) continue;

      this.ctx.globalAlpha = alpha * 0.44;
      this.ctx.strokeStyle = trace.color;
      this.ctx.lineWidth = 7 + intensity * 11;
      this.ctx.shadowBlur = 24 + intensity * 34;
      this.ctx.shadowColor = trace.color;
      this.ctx.beginPath();
      this.ctx.moveTo(from.x, from.y);
      this.ctx.lineTo(to.x, to.y);
      this.ctx.stroke();

      this.ctx.globalAlpha = alpha;
      this.ctx.strokeStyle = trace.color;
      this.ctx.lineWidth = 1.35 + intensity * 2.1;
      this.ctx.shadowBlur = 10 + intensity * 20;
      this.ctx.shadowColor = trace.color;
      this.ctx.beginPath();
      this.ctx.moveTo(from.x, from.y);
      this.ctx.lineTo(to.x, to.y);
      this.ctx.stroke();
      this.ctx.globalAlpha = alpha * 0.42;
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 0.7;
      this.ctx.beginPath();
      this.ctx.moveTo(from.x, from.y);
      this.ctx.lineTo(to.x, to.y);
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;

      if (age < 4200 && trace.count >= 2) {
        const progress = Math.min(1, age / 4200);
        this.endpointPulse(to.x, to.y, progress, trace.color, 0.11 + intensity * 0.16);
      }
      this.drawRouteResidueSparkles(from.x, from.y, to.x, to.y, trace.color, trace.count, age, intensity, alpha);
    }
    this.ctx.restore();
  }

  private drawObserverAura(now: number) {
    const aggregates = this.observerAggregatesForFrame();
    if (aggregates.length === 0) return;
    this.ctx.save();
    for (const burst of aggregates) {
      const age = now - burst.latestAt;
      const fade = Math.max(0, 1 - age / ROUTE_TRACE_WINDOW_MS);
      const intensity = Math.min(1, Math.log1p(burst.count) / Math.log1p(24));
      const point = this.map.project([burst.location.lng, burst.location.lat]);
      const radius = 15 + intensity * 38;
      const alpha = observerAuraAlpha(burst.count, fade) * this.visualSettings.brightness;
      const gradient = this.ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
      gradient.addColorStop(0, colorWithAlpha(burst.color, alpha));
      gradient.addColorStop(0.42, colorWithAlpha(burst.color, alpha * 0.42));
      gradient.addColorStop(0.72, colorWithAlpha(burst.color, alpha * 0.16));
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      this.ctx.globalAlpha = 0.86;
      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      this.ctx.fill();

      if (intensity > 0.18) {
        this.ctx.globalAlpha = alpha * 0.72;
        this.ctx.strokeStyle = burst.color;
        this.ctx.lineWidth = 0.7 + intensity * 0.8;
        this.ctx.shadowBlur = 10 + intensity * 12;
        this.ctx.shadowColor = burst.color;
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, 8 + intensity * 11, 0, Math.PI * 2);
        this.ctx.stroke();
      }
    }
    this.ctx.restore();
  }

  private drawObserverBurst(active: ActiveObserverBurst, now: number, overlays: ObserverOverlay[]) {
    const elapsed = now - active.started;
    const progress = Math.min(1, elapsed / active.duration);
    const afterglowProgress = Math.max(0, Math.min(1, (elapsed - active.duration) / active.afterglowDuration));
    const color = payloadVisual(active.burst.payloadTypeName).color;
    const point = this.map.project([active.burst.location.lng, active.burst.location.lat]);
    const alpha = (elapsed > active.duration ? 0.14 * (1 - afterglowProgress) : 0.34) * active.brightness;
    if (alpha <= 0.01) return;

    this.ctx.save();
    const pulse = Math.sin(progress * Math.PI);
    const electric = 0.58 + pulse * 0.24;
    const outerRadius = 11 + progress * 34;
    const midRadius = 6 + progress * 21;
    const coreRadius = 3 + pulse * 2.4;

    const glow = this.ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, outerRadius);
    glow.addColorStop(0, colorWithAlpha('#ffffff', 0.2 * alpha));
    glow.addColorStop(0.24, colorWithAlpha(color, 0.28 * alpha));
    glow.addColorStop(0.66, colorWithAlpha(color, 0.1 * alpha));
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    this.ctx.globalAlpha = electric;
    this.ctx.fillStyle = glow;
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, outerRadius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.globalAlpha = alpha * 0.58;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.35;
    this.ctx.shadowBlur = 14;
    this.ctx.shadowColor = color;
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, midRadius, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.globalAlpha = alpha * 0.28;
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, outerRadius, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.globalAlpha = alpha * (0.34 + pulse * 0.26);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.shadowBlur = 10 + pulse * 10;
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, coreRadius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();

    overlays.push({
      x: point.x,
      y: point.y,
      color,
      progress,
      alpha,
      label: active.burst.location.label
    });
  }

  private drawCompletedSegment(x0: number, y0: number, x1: number, y1: number, color: string, fade: number, brightness: number, style: PacketAnimationStyle) {
    this.ctx.globalAlpha = Math.max(0.06, fade * (style === 'minimal' ? 0.14 : 0.26) * brightness);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = style === 'minimal' ? 2 : 3;
    this.ctx.shadowBlur = style === 'minimal' ? 7 : 16;
    this.ctx.shadowColor = color;
    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;
  }

  private drawAfterglowSegment(x0: number, y0: number, x1: number, y1: number, color: string, alpha: number, shimmer: number, brightness: number, trailScale: number, style: PacketAnimationStyle) {
    const styleScale = style === 'minimal' ? 0.45 : style === 'pulse' ? 0.72 : 1;
    this.ctx.globalAlpha = alpha * (0.13 + shimmer * 0.13) * brightness * trailScale * styleScale;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = (2.8 + shimmer * 1.6) * (style === 'minimal' ? 0.72 : 1);
    this.ctx.shadowBlur = (16 + shimmer * 24) * styleScale;
    this.ctx.shadowColor = color;
    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;
  }

  private drawCometSegment(x0: number, y0: number, x1: number, y1: number, color: string, progress: number, shimmer: number, brightness: number, trailScale: number, style: PacketAnimationStyle) {
    const head = pointAlongSegment(x0, y0, x1, y1, progress);
    const tailFactor = style === 'minimal' ? 0.42 : style === 'pulse' ? 0.68 : 1;
    const tail = pointAlongSegment(x0, y0, x1, y1, Math.max(0, progress - 0.068 * trailScale * tailFactor));
    const tail2 = pointAlongSegment(x0, y0, x1, y1, Math.max(0, progress - 0.16 * trailScale * tailFactor));
    const gradient = this.ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(0.28, colorWithAlpha(color, 0.56));
    gradient.addColorStop(0.76, colorWithAlpha(color, 0.96));
    gradient.addColorStop(1, 'rgba(255, 255, 255, 1)');

    const bloom = this.ctx.createLinearGradient(tail2.x, tail2.y, head.x, head.y);
    bloom.addColorStop(0, 'rgba(255, 255, 255, 0)');
    bloom.addColorStop(0.48, colorWithAlpha(color, 0.32));
    bloom.addColorStop(1, colorWithAlpha(color, 0.88));

    this.ctx.globalAlpha = (0.28 + shimmer * 0.12) * brightness * (style === 'minimal' ? 0.38 : 1);
    this.ctx.strokeStyle = bloom;
    this.ctx.lineWidth = (10 + shimmer * 5) * (style === 'minimal' ? 0.42 : style === 'pulse' ? 0.72 : 1);
    this.ctx.shadowBlur = (34 + shimmer * 30) * (style === 'minimal' ? 0.38 : 1);
    this.ctx.shadowColor = color;
    this.ctx.beginPath();
    this.ctx.moveTo(tail2.x, tail2.y);
    this.ctx.lineTo(head.x, head.y);
    this.ctx.stroke();

    this.ctx.globalAlpha = (0.92 + shimmer * 0.08) * brightness;
    this.ctx.strokeStyle = gradient;
    this.ctx.lineWidth = (3.8 + shimmer * 1.6) * (style === 'minimal' ? 0.7 : 1);
    this.ctx.shadowBlur = (24 + shimmer * 30) * (style === 'minimal' ? 0.5 : 1);
    this.ctx.shadowColor = color;
    this.ctx.beginPath();
    this.ctx.moveTo(tail.x, tail.y);
    this.ctx.lineTo(head.x, head.y);
    this.ctx.stroke();

    this.ctx.globalAlpha = 0.74 * brightness;
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1.15;
    this.ctx.shadowBlur = 14 + shimmer * 12;
    const coreTail = pointAlongSegment(x0, y0, x1, y1, Math.max(0, progress - 0.026));
    this.ctx.beginPath();
    this.ctx.moveTo(coreTail.x, coreTail.y);
    this.ctx.lineTo(head.x, head.y);
    this.ctx.stroke();

    this.ctx.globalAlpha = Math.min(1, brightness);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.shadowBlur = 26 + shimmer * 28;
    this.ctx.shadowColor = color;
    this.ctx.beginPath();
    this.ctx.arc(head.x, head.y, (style === 'minimal' ? 2.9 : 3.8) + shimmer * 1.4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalAlpha = 0.86;
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(head.x, head.y, 1.9, 0, Math.PI * 2);
    this.ctx.fill();
    if (style !== 'minimal') this.drawCometSparks(head.x, head.y, x0, y0, x1, y1, color, shimmer, progress);
    if (style === 'pulse') this.endpointPulse(head.x, head.y, 0.35 + shimmer * 0.18, color, 0.32 * brightness);
    this.ctx.shadowBlur = 0;
  }

  private endpointPulse(x: number, y: number, progress: number, color: string, alpha = 0.28) {
    const radius = 7 + progress * 22;
    this.ctx.globalAlpha = (1 - progress) * alpha;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2.4;
    this.ctx.shadowBlur = 16;
    this.ctx.shadowColor = color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;
  }

  private drawRelayOverlays(overlays: RelayOverlay[]) {
    if (overlays.length === 0) return;
    this.ctx.save();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    for (const overlay of overlays) {
      const progress = clamp01(overlay.progress);
      const alpha = (1 - progress) * overlay.alpha;
      if (alpha <= 0.01) continue;
      const isLaunch = overlay.mode === 'launch';

      this.ctx.globalAlpha = alpha;
      this.ctx.strokeStyle = overlay.color;
      this.ctx.lineWidth = isLaunch ? 1.9 : 2.6;
      this.ctx.shadowBlur = isLaunch ? 20 : 28;
      this.ctx.shadowColor = overlay.color;
      this.ctx.beginPath();
      this.ctx.arc(overlay.x, overlay.y, (isLaunch ? 9 : 15) + progress * (isLaunch ? 30 : 38), 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.globalAlpha = alpha * (isLaunch ? 0.46 : 0.72);
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.arc(overlay.x, overlay.y, (isLaunch ? 13 : 21) + progress * (isLaunch ? 22 : 28), 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.globalAlpha = overlay.alpha * (isLaunch ? 0.62 - progress * 0.22 : 0.34 + progress * 0.66);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.shadowBlur = isLaunch ? 18 : 24;
      this.ctx.shadowColor = overlay.color;
      this.ctx.beginPath();
      this.ctx.arc(overlay.x, overlay.y, isLaunch ? 2.6 : 3.3, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.globalAlpha = overlay.alpha * (isLaunch ? 0.22 + progress * 0.24 : 0.22 + progress * 0.42);
      this.ctx.fillStyle = overlay.color;
      this.ctx.beginPath();
      this.ctx.arc(overlay.x, overlay.y, isLaunch ? 4.4 : 5.2, 0, Math.PI * 2);
      this.ctx.fill();
      if (!isLaunch) this.drawArrivalSparkle(overlay.x, overlay.y, overlay.color, progress, overlay.alpha);
      this.ctx.shadowBlur = 0;
    }
    this.ctx.restore();
  }

  private drawObserverOverlays(overlays: ObserverOverlay[]) {
    if (overlays.length === 0) return;
    this.ctx.save();
    for (const overlay of overlays) {
      const progress = clamp01(overlay.progress);
      const pulse = Math.sin(progress * Math.PI);
      const alpha = overlay.alpha * (0.36 + pulse * 0.42);
      if (alpha <= 0.01) continue;

      this.ctx.globalAlpha = alpha;
      this.ctx.fillStyle = '#ffffff';
      this.ctx.shadowBlur = 28;
      this.ctx.shadowColor = overlay.color;
      this.ctx.beginPath();
      this.ctx.arc(overlay.x, overlay.y, 3.2 + pulse * 2.4, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.globalAlpha = alpha * 0.72;
      this.ctx.fillStyle = overlay.color;
      this.ctx.beginPath();
      this.ctx.arc(overlay.x, overlay.y, 6.8 + pulse * 4.2, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.globalAlpha = alpha * 0.68;
      this.ctx.strokeStyle = overlay.color;
      this.ctx.lineWidth = 1.45;
      this.ctx.shadowBlur = 18;
      this.ctx.beginPath();
      this.ctx.moveTo(overlay.x, overlay.y - 24 - progress * 28);
      this.ctx.lineTo(overlay.x, overlay.y - 7);
      this.ctx.stroke();

      this.ctx.globalAlpha = alpha * 0.48;
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.moveTo(overlay.x - 15, overlay.y);
      this.ctx.lineTo(overlay.x + 15, overlay.y);
      this.ctx.moveTo(overlay.x, overlay.y - 15);
      this.ctx.lineTo(overlay.x, overlay.y + 15);
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
    }
    this.ctx.restore();
  }

  private drawArrivalSparkle(x: number, y: number, color: string, progress: number, alpha: number) {
    const sparkAlpha = alpha * Math.sin(progress * Math.PI) * 0.92;
    if (sparkAlpha <= 0.01) return;
    const radius = 6 + progress * 17;
    this.ctx.save();
    this.ctx.globalAlpha = sparkAlpha;
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1.35;
    this.ctx.shadowBlur = 18;
    this.ctx.shadowColor = color;
    for (let index = 0; index < 6; index++) {
      const angle = (Math.PI / 3) * index + progress * 0.9;
      const inner = radius * 0.45;
      const outer = radius;
      this.ctx.beginPath();
      this.ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
      this.ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawCometSparks(x: number, y: number, x0: number, y0: number, x1: number, y1: number, color: string, shimmer: number, progress: number) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const tx = dx / length;
    const ty = dy / length;
    const alpha = 0.32 + shimmer * 0.18;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1;
    this.ctx.shadowBlur = 12;
    this.ctx.shadowColor = color;
    for (let index = 0; index < 3; index++) {
      const side = index % 2 === 0 ? 1 : -1;
      const offset = (4 + index * 2.2) * side;
      const back = 7 + index * 5 + progress * 3;
      this.ctx.beginPath();
      this.ctx.moveTo(x - tx * back + nx * offset, y - ty * back + ny * offset);
      this.ctx.lineTo(x - tx * (back + 5) + nx * (offset * 1.4), y - ty * (back + 5) + ny * (offset * 1.4));
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawRouteResidueSparkles(x0: number, y0: number, x1: number, y1: number, color: string, count: number, ageMs: number, intensity: number, alpha: number) {
    const sparkleCount = routeResidueSparkleCount(count, ageMs);
    const sparkleAlpha = routeResidueSparkleAlpha(ageMs, intensity, alpha);
    if (sparkleCount <= 0 || sparkleAlpha <= 0.01) return;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const drift = (ageMs % 1800) / 1800;
    this.ctx.save();
    this.ctx.lineWidth = 1.15;
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.shadowBlur = 12 + intensity * 16;
    this.ctx.shadowColor = color;
    for (let index = 0; index < sparkleCount; index++) {
      const phase = (index + 1) / (sparkleCount + 1);
      const along = (phase + drift * 0.18) % 1;
      const side = index % 2 === 0 ? 1 : -1;
      const wobble = Math.sin(ageMs / 240 + index * 1.7) * (3.5 + intensity * 5) * side;
      const x = x0 + dx * along + nx * wobble;
      const y = y0 + dy * along + ny * wobble;
      const radius = 2.3 + intensity * 2.1 + (index % 2) * 0.7;
      const localAlpha = sparkleAlpha * (0.72 + 0.28 * Math.sin(ageMs / 180 + index));
      this.ctx.globalAlpha = Math.max(0, localAlpha);
      this.ctx.beginPath();
      this.ctx.moveTo(x - radius, y);
      this.ctx.lineTo(x + radius, y);
      this.ctx.moveTo(x, y - radius);
      this.ctx.lineTo(x, y + radius);
      this.ctx.stroke();
      this.ctx.globalAlpha = localAlpha * 0.58;
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 1.2 + intensity * 0.8, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  private traceAggregatesForFrame(): TraceAggregate[] {
    if (this.traceAggregatesDirty) {
      this.traceAggregates = rankTraceAggregates(aggregateTraceHits(this.traceHits)).slice(0, MAX_TRACE_AURA_ROUTES);
      this.traceAggregatesDirty = false;
    }
    return this.traceAggregates;
  }

  private observerAggregatesForFrame(): ObserverBurstAggregate[] {
    if (this.observerAggregatesDirty) {
      this.observerBurstAggregates = rankObserverBurstAggregates(aggregateObserverBurstHits(this.observerBurstHits)).slice(0, MAX_OBSERVER_AURA_LOCATIONS);
      this.observerAggregatesDirty = false;
    }
    return this.observerBurstAggregates;
  }

  private maskRenderedMapLayers(now: number) {
    const layerIDs = this.maskLayerIDs.filter((layerID) => this.map.getLayer(layerID));
    if (layerIDs.length === 0) return;

    if (now >= this.nextMaskRefreshAt) {
      this.maskFeatures = this.map.queryRenderedFeatures(undefined, { layers: layerIDs }) as RenderedPointFeature[];
      this.nextMaskRefreshAt = now + MASK_CACHE_INTERVAL_MS;
    }
    const features = this.maskFeatures;
    if (features.length === 0) return;

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = '#000000';
    this.ctx.beginPath();
    let maskCount = 0;
    const zoom = this.map.getZoom();
    for (const feature of features) {
      if (feature.geometry?.type !== 'Point' || !feature.geometry.coordinates) continue;
      const point = this.map.project(feature.geometry.coordinates);
      const radius = mapFeatureMaskRadius(feature.properties, zoom);
      this.ctx.moveTo(point.x + radius, point.y);
      this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      maskCount += 1;
    }
    if (maskCount > 0) this.ctx.fill();
    this.ctx.restore();
  }
}

export function packetTravelDuration(segmentCount: number, speed = 1): number {
  const clampedSpeed = clampRange(speed, 0.5, 3);
  const base = segmentCount <= 1
    ? PACKET_SINGLE_HOP_DURATION_MS
    : Math.min(PACKET_MAX_TRAVEL_DURATION_MS, PACKET_SINGLE_HOP_DURATION_MS + (segmentCount - 1) * 550);
  return Math.round(base / clampedSpeed);
}

export function sequentialSegmentProgress(progress: number, segmentCount: number): { segmentIndex: number; localProgress: number } {
  if (segmentCount <= 1) {
    return { segmentIndex: 0, localProgress: clamp01(progress) };
  }
  const clamped = clamp01(progress);
  if (clamped >= 1) {
    return { segmentIndex: segmentCount - 1, localProgress: 1 };
  }
  const scaled = clamped * segmentCount;
  return {
    segmentIndex: Math.min(segmentCount - 1, Math.floor(scaled)),
    localProgress: clamp01(scaled % 1)
  };
}

export function clusterMaskRadius(pointCount: unknown): number {
  const count = typeof pointCount === 'number' ? pointCount : Number(pointCount);
  if (Number.isFinite(count) && count >= 75) return 36;
  if (Number.isFinite(count) && count >= 25) return 30;
  return 25;
}

export function nodeMaskRadius(selected: unknown, zoom = 3): number {
  const clampedZoom = Math.max(3, Math.min(12, zoom));
  const iconScale = clampedZoom <= 8
    ? interpolate(clampedZoom, 3, 8, 0.42, 0.78)
    : interpolate(clampedZoom, 8, 12, 0.78, 1);
  const iconRadius = (24 * iconScale) / 2;
  return iconRadius + (selected === true || selected === 'true' ? 4 : 2);
}

export function mapFeatureMaskRadius(properties: Record<string, unknown> | undefined, zoom = 3): number {
  if (properties && 'point_count' in properties) return clusterMaskRadius(properties.point_count);
  return nodeMaskRadius(properties?.selected, zoom);
}

export function routeResidueAlpha(count: number, fade = 1): number {
  if (count <= 0) return 0;
  const intensity = Math.min(1, Math.log1p(Math.max(0, count)) / Math.log1p(18));
  return Math.min(ROUTE_RESIDUE_ALPHA_CAP, (0.022 + intensity * 0.118) * clamp01(fade));
}

export function routeResidueSparkleCount(count: number, ageMs: number): number {
  if (count <= 0 || ageMs < 0 || ageMs > ROUTE_SPARKLE_WINDOW_MS) return 0;
  return Math.max(1, Math.min(MAX_ROUTE_SPARKLES_PER_TRACE, Math.ceil(Math.log1p(count))));
}

export function routeResidueSparkleAlpha(ageMs: number, intensity: number, alpha: number): number {
  if (ageMs < 0 || ageMs > ROUTE_SPARKLE_WINDOW_MS || alpha <= 0) return 0;
  const fade = 1 - ageMs / ROUTE_SPARKLE_WINDOW_MS;
  return Math.round(Math.min(0.72, alpha * (0.58 + clamp01(intensity) * 0.46) * fade) * 1000) / 1000;
}

export function observerAuraAlpha(count: number, fade = 1): number {
  if (count <= 0) return 0;
  const intensity = Math.min(1, Math.log1p(Math.max(0, count)) / Math.log1p(24));
  return Math.min(OBSERVER_AURA_ALPHA_CAP, (0.026 + intensity * 0.108) * clamp01(fade));
}

function routeColorFromID(id: string): string {
  const bucket = parseInt(id.slice(-1), 16) % 5;
  return ['#2563eb', '#06b6d4', '#22c55e', '#f97316', '#ef4444'][bucket];
}

function pruneTraceHits(hits: TraceHit[], now: number): TraceHit[] {
  const cutoff = now - ROUTE_TRACE_WINDOW_MS;
  return hits.filter((hit) => hit.addedAt >= cutoff);
}

function pruneObserverBurstHits(hits: ObserverBurstHit[], now: number): ObserverBurstHit[] {
  const cutoff = now - OBSERVER_AURA_WINDOW_MS;
  return hits.filter((hit) => hit.addedAt >= cutoff);
}

function aggregateTraceHits(hits: TraceHit[]): TraceAggregate[] {
  const byRoute = new Map<string, TraceAggregate>();
  for (const hit of hits) {
    const existing = byRoute.get(hit.routeId);
    if (existing) {
      existing.count += 1;
      existing.latestAt = Math.max(existing.latestAt, hit.addedAt);
    } else {
      byRoute.set(hit.routeId, {
        routeId: hit.routeId,
        color: hit.color,
        from: hit.from,
        to: hit.to,
        count: 1,
        latestAt: hit.addedAt
      });
    }
  }
  return Array.from(byRoute.values());
}

function aggregateObserverBurstHits(hits: ObserverBurstHit[]): ObserverBurstAggregate[] {
  const byLocation = new Map<string, ObserverBurstAggregate>();
  for (const hit of hits) {
    const existing = byLocation.get(hit.key);
    if (existing) {
      existing.count += 1;
      existing.latestAt = Math.max(existing.latestAt, hit.addedAt);
    } else {
      byLocation.set(hit.key, {
        key: hit.key,
        color: hit.color,
        location: hit.location,
        count: 1,
        latestAt: hit.addedAt
      });
    }
  }
  return Array.from(byLocation.values());
}

function rankTraceAggregates(aggregates: TraceAggregate[]): TraceAggregate[] {
  return aggregates.sort((a, b) => aggregateScore(b.count, b.latestAt) - aggregateScore(a.count, a.latestAt));
}

function rankObserverBurstAggregates(aggregates: ObserverBurstAggregate[]): ObserverBurstAggregate[] {
  return aggregates.sort((a, b) => aggregateScore(b.count, b.latestAt) - aggregateScore(a.count, a.latestAt));
}

function aggregateScore(count: number, latestAt: number): number {
  return latestAt + Math.log1p(Math.max(0, count)) * 60_000;
}

export function observerBurstKey(burst: Pick<PublicObserverBurst, 'location'>): string {
  const location = burst.location;
  return `${location.label}|${location.iata ?? ''}|${location.lat.toFixed(4)}|${location.lng.toFixed(4)}`;
}

export function observerBurstAllowed(activeTotal: number, activeForLocation: number, lastLocationAt: number | undefined, now: number): boolean {
  if (activeTotal >= MAX_ACTIVE_OBSERVER_BURSTS) return false;
  if (activeForLocation >= MAX_OBSERVER_BURSTS_PER_LOCATION) return false;
  if (lastLocationAt !== undefined && now - lastLocationAt < OBSERVER_BURST_LOCATION_INTERVAL_MS) return false;
  return true;
}

function pointAlongSegment(x0: number, y0: number, x1: number, y1: number, progress: number) {
  const t = clamp01(progress);
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
}

function isMappableObserverLocation(location: { lat: number; lng: number }): boolean {
  return Number.isFinite(location.lat) && Number.isFinite(location.lng) && location.lat !== 0 && location.lng !== 0;
}

function interpolate(value: number, inputMin: number, inputMax: number, outputMin: number, outputMax: number): number {
  if (inputMax === inputMin) return outputMax;
  const progress = (value - inputMin) / (inputMax - inputMin);
  return outputMin + progress * (outputMax - outputMin);
}

function colorWithAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp01(alpha)})`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return PACKET_SINGLE_HOP_DURATION_MS;
  return Math.max(500, Math.min(12_000, Math.round(value)));
}
