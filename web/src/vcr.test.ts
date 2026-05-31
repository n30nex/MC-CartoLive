import { describe, expect, it } from 'vitest';
import type { PublicLiveEnvelope } from './types';
import {
  bufferVcrEnvelope,
  createVcrState,
  historyFetchWindowFromScrub,
  missedReplayState,
  nextVcrSpeed,
  pauseVcr,
  playbackDelayMs,
  replayMissedVcr,
  shouldApplyPlaybackGeneration,
  VCR_LAYOUT_TARGETS,
  liveVcr,
  timelineHoverTimestamp,
  timestampFromTimelineRatio,
  vcrChromeState,
  vcrReadoutLabels
} from './vcr';

const activityEnvelope = (id: string, at: number): PublicLiveEnvelope => ({
  v: 1,
  type: 'event',
  event: 'activity',
  serverTime: at,
  displayAt: at,
  data: {
    id,
    kind: 'packet',
    payloadTypeName: 'ADVERT',
    heardAt: at,
    hopCount: 0,
    hasRoute: false,
    animationState: 'observer',
    resolutionBucket: 'observer_only',
    observerLocation: { label: 'YYZ observer', lat: 43.65, lng: -79.38 }
  }
});

const routeEnvelope = (id: string, at: number): PublicLiveEnvelope => ({
  v: 1,
  type: 'event',
  event: 'routePulse',
  serverTime: at,
  displayAt: at,
  data: {
    id,
    payloadTypeName: 'ADVERT',
    heardAt: at,
    segments: [
      {
        routeId: 'r-1',
        from: { nodeId: 'a', label: 'A', lat: 43.65, lng: -79.38 },
        to: { nodeId: 'b', label: 'B', lat: 45.42, lng: -75.69 },
        distanceKm: 360
      }
    ]
  }
});

describe('VCR state helpers', () => {
  it('transitions live to paused to replay missed to live', () => {
    const live = createVcrState(10_000);
    const paused = bufferVcrEnvelope(pauseVcr(live, 10_000), routeEnvelope('a', 10_100));
    const replay = replayMissedVcr(paused);
    const resumed = liveVcr(replay);

    expect(paused.mode).toBe('paused');
    expect(paused.missedCount).toBe(1);
    expect(replay.mode).toBe('replay');
    expect(replay.missedCount).toBe(0);
    expect(replay.buffered).toEqual([]);
    expect(resumed.mode).toBe('live');
    expect(resumed.missedCount).toBe(0);
  });

  it('maps scrub timestamps to a bounded history fetch window', () => {
    expect(historyFetchWindowFromScrub(9_000, 12_000)).toEqual({ from: 9_000, to: 12_000 });
    expect(historyFetchWindowFromScrub(14_000, 12_000)).toEqual({ from: 12_000, to: 12_000 });
  });

  it('schedules playback at 0.5x, 1x, 2x, and 4x and rejects stale generations', () => {
    expect(playbackDelayMs(1_000, 2_000, 0.5)).toBe(1200);
    expect(playbackDelayMs(1_000, 2_000, 1)).toBe(1000);
    expect(playbackDelayMs(1_000, 2_000, 2)).toBe(500);
    expect(playbackDelayMs(1_000, 2_000, 4)).toBe(250);
    expect(playbackDelayMs(1_000, 1_000, 4)).toBe(24);
    expect(shouldApplyPlaybackGeneration(3, 3)).toBe(true);
    expect(shouldApplyPlaybackGeneration(4, 3)).toBe(false);
  });

  it('buffers only routed comet events while paused or replaying', () => {
    const live = createVcrState(10_000);
    expect(bufferVcrEnvelope(live, routeEnvelope('live', 10_100)).buffered).toHaveLength(0);

    const pausedWithoutObserver = bufferVcrEnvelope(pauseVcr(live), activityEnvelope('observer', 10_150));
    const paused = bufferVcrEnvelope(pausedWithoutObserver, routeEnvelope('paused', 10_200));
    const replaying = bufferVcrEnvelope(replayMissedVcr(paused), routeEnvelope('replay', 10_300));

    expect(paused.buffered.map((item) => (item.type === 'event' ? item.data.id : item.type))).toEqual(['paused']);
    expect(replaying.buffered.map((item) => (item.type === 'event' ? item.data.id : item.type))).toEqual(['replay']);
    expect(replaying.missedCount).toBe(1);
  });

  it('cycles playback speeds through the full configured set', () => {
    expect(nextVcrSpeed(0.5)).toBe(1);
    expect(nextVcrSpeed(1)).toBe(2);
    expect(nextVcrSpeed(2)).toBe(4);
    expect(nextVcrSpeed(4)).toBe(8);
    expect(nextVcrSpeed(8)).toBe(16);
    expect(nextVcrSpeed(16)).toBe(0.5);
  });

  it('maps timeline ratios and pointer hover positions to timestamps', () => {
    expect(timestampFromTimelineRatio(1_000, 5_000, -1)).toBe(1_000);
    expect(timestampFromTimelineRatio(1_000, 5_000, 0.5)).toBe(3_000);
    expect(timestampFromTimelineRatio(1_000, 5_000, 2)).toBe(5_000);

    expect(timelineHoverTimestamp(1_000, 5_000, 150, 100, 100)).toBe(3_000);
    expect(timelineHoverTimestamp(1_000, 5_000, 240, 100, 100)).toBe(5_000);
    expect(timelineHoverTimestamp(1_000, 5_000, 150, 100, 0)).toBeNull();
  });

  it('returns clear readout labels for live, replay, status, and hover states', () => {
    expect(vcrReadoutLabels('live', 1, 'idle', false)).toEqual({
      statusLabel: 'LIVE',
      clockLabel: 'Live',
      clockTitle: 'Live clock'
    });
    expect(vcrReadoutLabels('paused', 1, 'idle', false).statusLabel).toBe('REPLAY PAUSED');
    expect(vcrReadoutLabels('replay', 2, 'idle', false).statusLabel).toBe('REPLAY 2x');
    expect(vcrReadoutLabels('replay', 4, 'loading', false).statusLabel).toBe('REPLAY LOADING');
    expect(vcrReadoutLabels('live', 1, 'lagged', false).statusLabel).toBe('LIVE LAGGING');
    expect(vcrReadoutLabels('replay', 1, 'idle', true)).toMatchObject({
      clockLabel: 'Hover',
      clockTitle: 'Timeline hover time'
    });
  });

  it('describes missed replay availability, labels, and button titles', () => {
    expect(missedReplayState(0, 'idle')).toEqual({
      available: false,
      disabled: true,
      label: 'Missed 0',
      title: 'Pause live to buffer missed packet comets',
      ariaLabel: 'Pause live to buffer missed packet comets'
    });
    expect(missedReplayState(1, 'idle')).toEqual({
      available: true,
      disabled: false,
      label: 'Missed 1',
      title: 'Replay 1 missed packet comet',
      ariaLabel: 'Replay 1 missed packet comet'
    });
    expect(missedReplayState(12, 'loading')).toEqual({
      available: false,
      disabled: true,
      label: 'Missed 12',
      title: 'Replay is loading; missed packet comets are unavailable',
      ariaLabel: 'Replay missed packet comets unavailable while replay is loading'
    });
  });

  it('describes open and closed VCR chrome reservations', () => {
    expect(vcrChromeState(false, 'desktop')).toEqual({
      open: false,
      className: 'vcr-closed',
      reservedHeightPx: 52,
      liveClockVisible: true
    });
    expect(vcrChromeState(true, 'desktop')).toEqual({
      open: true,
      className: 'vcr-open',
      reservedHeightPx: 72,
      liveClockVisible: false
    });
    expect(vcrChromeState(false, 'mobile').reservedHeightPx).toBe(56);
    expect(vcrChromeState(true, 'mobile').reservedHeightPx).toBe(156);
  });

  it('keeps documented VCR layout targets compact', () => {
    expect(VCR_LAYOUT_TARGETS).toEqual({
      desktopOpenHeightPx: 72,
      desktopClosedHeightPx: 52,
      mobileOpenHeightPx: 156,
      mobileClosedHeightPx: 56
    });
  });
});
