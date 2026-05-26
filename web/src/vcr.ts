import { liveEnvelopeDisplayAt, sortLiveEnvelopes } from './livePacing';
import type { PublicHistoryEvent, PublicLiveEnvelope } from './types';

export type VcrMode = 'live' | 'paused' | 'replay';
export type VcrSpeed = 0.5 | 1 | 2 | 4 | 8 | 16;
export type VcrStatus = 'idle' | 'loading' | 'empty' | 'error' | 'lagged';

export const VCR_SPEEDS: readonly VcrSpeed[] = [0.5, 1, 2, 4, 8, 16] as const;
export const VCR_LAYOUT_TARGETS = {
  desktopOpenHeightPx: 72,
  desktopClosedHeightPx: 52,
  mobileOpenHeightPx: 156,
  mobileClosedHeightPx: 56
} as const;
export const VCR_SCOPE_OPTIONS = [
  { label: '1h', value: 60 * 60_000 },
  { label: '6h', value: 6 * 60 * 60_000 },
  { label: '24h', value: 24 * 60 * 60_000 }
] as const;

export interface VcrState {
  mode: VcrMode;
  speed: VcrSpeed;
  scopeMs: number;
  missedCount: number;
  buffered: PublicLiveEnvelope[];
  scrubAt: number | null;
  clock: number | null;
  generation: number;
}

export interface VcrReadoutLabels {
  statusLabel: string;
  clockLabel: string;
  clockTitle: string;
}

export interface VcrMissedReplayState {
  available: boolean;
  disabled: boolean;
  label: string;
  title: string;
  ariaLabel: string;
}

export interface VcrChromeState {
  open: boolean;
  className: string;
  reservedHeightPx: number;
  liveClockVisible: boolean;
}

export function createVcrState(now: number, scopeMs = VCR_SCOPE_OPTIONS[0].value): VcrState {
  return {
    mode: 'live',
    speed: 1,
    scopeMs,
    missedCount: 0,
    buffered: [],
    scrubAt: null,
    clock: now,
    generation: 0
  };
}

export function pauseVcr(state: VcrState, now = state.clock ?? Date.now()): VcrState {
  return { ...state, mode: 'paused', scrubAt: state.scrubAt ?? now, clock: state.clock ?? now, generation: state.generation + 1 };
}

export function liveVcr(state: VcrState): VcrState {
  return { ...state, mode: 'live', missedCount: 0, buffered: [], scrubAt: null, clock: null, generation: state.generation + 1 };
}

export function replayMissedVcr(state: VcrState): VcrState {
  return { ...state, mode: 'replay', missedCount: 0, buffered: [], generation: state.generation + 1 };
}

export function bufferVcrEnvelope(state: VcrState, message: PublicLiveEnvelope): VcrState {
  if (state.mode === 'live' || message.type !== 'event' || message.event !== 'routePulse') return state;
  const buffered = sortLiveEnvelopes([...state.buffered, message]).slice(-4000);
  const clock = state.clock ?? liveEnvelopeDisplayAt(message);
  return { ...state, buffered, missedCount: buffered.length, clock };
}

export function nextVcrSpeed(speed: VcrSpeed): VcrSpeed {
  const index = VCR_SPEEDS.indexOf(speed);
  return VCR_SPEEDS[(index + 1) % VCR_SPEEDS.length];
}

export function historyFetchWindowFromScrub(timestamp: number, now: number): { from: number; to: number } {
  const to = Math.max(0, now);
  const from = Math.max(0, Math.min(timestamp, to));
  return { from, to };
}

export function timestampFromTimelineRatio(start: number, end: number, ratio: number): number {
  const clamped = Math.max(0, Math.min(1, ratio));
  return Math.round(start + (end - start) * clamped);
}

export function timestampFromTimelineClientX(start: number, end: number, clientX: number, left: number, width: number): number {
  const ratio = width <= 0 ? 0 : (clientX - left) / width;
  return timestampFromTimelineRatio(start, end, ratio);
}

export function timelineProgressPercent(start: number, end: number, value: number): number {
  if (end <= start) return 100;
  return Math.max(0, Math.min(100, ((value - start) / (end - start)) * 100));
}

export function vcrReadoutLabel(mode: VcrMode, speed: VcrSpeed, status: VcrStatus): string {
  if (status === 'loading') return mode === 'replay' ? 'REPLAY LOADING' : 'LOADING';
  if (status === 'empty') return mode === 'replay' ? 'REPLAY EMPTY' : 'NO EVENTS';
  if (status === 'error') return mode === 'replay' ? 'REPLAY RETRY' : 'RETRY';
  if (status === 'lagged') return mode === 'replay' ? 'REPLAY LAGGED' : 'LAGGED';
  if (mode === 'live') return 'LIVE';
  if (mode === 'paused') return 'PAUSED';
  return `REPLAY ${speed}x`;
}

export function vcrMissedControl(missedCount: number, status: VcrStatus): { disabled: boolean; label: string; title: string } {
  const disabled = missedCount === 0 || status === 'loading';
  if (missedCount > 0) {
    return {
      disabled,
      label: `Missed ${missedCount}`,
      title: `Replay ${missedCount} missed packet ${missedCount === 1 ? 'comet' : 'comets'}`
    };
  }
  return {
    disabled,
    label: 'Missed 0',
    title: 'Pause live to buffer missed packet comets'
  };
}

export function relativeTimelineLabel(timestamp: number, now: number): string {
  const delta = Math.max(0, now - timestamp);
  const seconds = Math.round(delta / 1000);
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function timelineHoverTimestamp(start: number, end: number, pointerX: number, trackLeft: number, trackWidth: number): number | null {
  if (trackWidth <= 0) return null;
  return timestampFromTimelineRatio(start, end, (pointerX - trackLeft) / trackWidth);
}

export function vcrReadoutLabels(mode: VcrMode, speed: VcrSpeed, status: VcrStatus, hoveringTimeline: boolean): VcrReadoutLabels {
  const statusLabel = (() => {
    if (status === 'loading') return 'REPLAY LOADING';
    if (status === 'empty') return 'NO REPLAY EVENTS';
    if (status === 'error') return 'REPLAY ERROR';
    if (status === 'lagged') return mode === 'live' ? 'LIVE LAGGING' : 'REPLAY LAGGING';
    if (mode === 'live') return 'LIVE';
    if (mode === 'paused') return 'REPLAY PAUSED';
    return `REPLAY ${speed}x`;
  })();

  if (hoveringTimeline) {
    return {
      statusLabel,
      clockLabel: 'Hover',
      clockTitle: 'Timeline hover time'
    };
  }

  if (mode === 'live') {
    return {
      statusLabel,
      clockLabel: 'Live',
      clockTitle: 'Live clock'
    };
  }

  return {
    statusLabel,
    clockLabel: 'Replay',
    clockTitle: 'Replay clock'
  };
}

export function missedReplayState(missedCount: number, status: VcrStatus): VcrMissedReplayState {
  const count = Math.max(0, Math.floor(missedCount));
  const hasMissed = count > 0;
  const loading = status === 'loading';
  const available = hasMissed && !loading;

  if (loading) {
    return {
      available: false,
      disabled: true,
      label: `Missed ${count}`,
      title: 'Replay is loading; missed packet comets are unavailable',
      ariaLabel: 'Replay missed packet comets unavailable while replay is loading'
    };
  }

  if (!hasMissed) {
    return {
      available: false,
      disabled: true,
      label: 'Missed 0',
      title: 'Pause live to buffer missed packet comets',
      ariaLabel: 'Pause live to buffer missed packet comets'
    };
  }

  return {
    available,
    disabled: false,
    label: `Missed ${count}`,
    title: `Replay ${count} missed packet ${count === 1 ? 'comet' : 'comets'}`,
    ariaLabel: `Replay ${count} missed packet ${count === 1 ? 'comet' : 'comets'}`
  };
}

export function vcrChromeState(open: boolean, viewport: 'desktop' | 'mobile' = 'desktop'): VcrChromeState {
  const targets = VCR_LAYOUT_TARGETS;
  return {
    open,
    className: open ? 'vcr-open' : 'vcr-closed',
    reservedHeightPx: viewport === 'mobile'
      ? (open ? targets.mobileOpenHeightPx : targets.mobileClosedHeightPx)
      : (open ? targets.desktopOpenHeightPx : targets.desktopClosedHeightPx),
    liveClockVisible: !open
  };
}

export function playbackDelayMs(currentAt: number, nextAt: number, speed: VcrSpeed): number {
  const delta = Math.max(0, nextAt - currentAt);
  if (delta === 0) return 24;
  return Math.max(24, Math.min(1200, Math.round(delta / speed)));
}

export function shouldApplyPlaybackGeneration(currentGeneration: number, scheduledGeneration: number): boolean {
  return currentGeneration === scheduledGeneration;
}

export function historyEventToEnvelope(event: PublicHistoryEvent, displayAt: number, seq: number): PublicLiveEnvelope {
  if (event.type === 'activity') {
    return {
      v: 1,
      type: 'event',
      event: 'activity',
      seq,
      serverTime: event.at,
      receivedAt: event.at,
      displayAt,
      data: event.data
    };
  }
  return {
    v: 1,
    type: 'event',
    event: 'routePulse',
    seq,
    serverTime: event.at,
    receivedAt: event.at,
    displayAt,
    data: event.data
  };
}

export function historyEventsToLiveEnvelopes(events: PublicHistoryEvent[], displayStart: number): PublicLiveEnvelope[] {
  return events.map((event, index) => historyEventToEnvelope(event, displayStart + index * 30, index + 1));
}
