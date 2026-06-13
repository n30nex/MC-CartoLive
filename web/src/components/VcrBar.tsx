import { useEffect, useState, type CSSProperties, type PointerEvent } from 'react';
import { Gauge, LoaderCircle, Pause, Play, RadioTower, Rewind, RotateCcw, Sparkles } from 'lucide-react';
import type { PublicHistorySummaryBucket } from '../types';
import {
  missedReplayState,
  relativeTimelineLabel,
  timelineHoverTimestamp,
  timelineProgressPercent,
  VCR_SCOPE_OPTIONS,
  vcrReadoutLabels,
  type VcrMode,
  type VcrSpeed,
  type VcrStatus
} from '../vcr';

interface Props {
  mode: VcrMode;
  speed: VcrSpeed;
  scopeMs: number;
  missedCount: number;
  timelineNow: number;
  clock: number | null;
  scrubAt: number | null;
  status: VcrStatus;
  summary: PublicHistorySummaryBucket[];
  onLive: () => void;
  onPause: () => void;
  onReplayMissed: () => void;
  onRewind: () => void;
  onSpeed: () => void;
  onScope: (scopeMs: number) => void;
  onScrub: (timestamp: number) => void;
  onPlayFromScrub: () => void;
  onLaserShow: () => void;
  onClose: () => void;
  laserShowActive?: boolean;
}

export default function VcrBar({
  mode,
  speed,
  scopeMs,
  missedCount,
  timelineNow,
  clock,
  scrubAt,
  status,
  summary,
  onLive,
  onPause,
  onReplayMissed,
  onRewind,
  onSpeed,
  onScope,
  onScrub,
  onPlayFromScrub,
  onLaserShow,
  onClose,
  laserShowActive = false
}: Props) {
  const [hoverTimestamp, setHoverTimestamp] = useState<number | null>(null);
  const start = Math.max(0, timelineNow - scopeMs);
  const value = clampTimestamp(scrubAt ?? clock ?? timelineNow, start, timelineNow);
  const progress = timelineProgressPercent(start, timelineNow, value);
  const activeHoverTimestamp = hoverTimestamp;
  const readoutTimestamp = activeHoverTimestamp ?? value;
  const maxBucket = Math.max(1, ...summary.map((bucket) => bucket.count));
  const readout = vcrReadoutLabels(mode, speed, status, activeHoverTimestamp !== null);
  const missed = missedReplayState(missedCount, status);
  const primaryTitle = mode === 'live' ? 'Pause live playback' : mode === 'replay' ? 'Pause replay' : 'Replay from selected time';
  const primaryAction = mode === 'live' || mode === 'replay' ? onPause : onPlayFromScrub;
  const primaryIcon = mode === 'paused' ? <Play size={16} /> : <Pause size={16} />;
  const primaryLabel = mode === 'live' ? 'Pause live' : mode === 'replay' ? 'Pause replay' : 'Play replay';
  const liveLabel = 'Live';
  const readoutBusy = status === 'loading' || laserShowActive;

  useEffect(() => {
    if (mode === 'live') setHoverTimestamp(null);
  }, [mode]);

  const updateHoverTimestamp = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverTimestamp(timelineHoverTimestamp(start, timelineNow, event.clientX, rect.left, rect.width));
  };

  return (
    <section className={`vcr-bar ${mode}`} aria-label="Live replay controls">
      <div className="vcr-controls">
        <button className={`vcr-button live ${mode === 'live' ? 'active' : ''}`} type="button" aria-label="Return to live playback" title="Return to live playback" onClick={onLive}>
          <RadioTower size={16} />
          <span>{liveLabel}</span>
        </button>
        <button className="vcr-button" type="button" aria-label={primaryTitle} title={primaryTitle} onClick={primaryAction}>
          {primaryIcon}
          <span>{primaryLabel}</span>
        </button>
        <button
          className={`vcr-button missed ${missed.available ? 'available' : 'unavailable'}`}
          type="button"
          title={missed.title}
          aria-label={missed.ariaLabel}
          disabled={missed.disabled}
          onClick={onReplayMissed}
        >
          <RotateCcw size={16} />
          <span>{missed.label}</span>
        </button>
        <button className="vcr-button icon-only" type="button" aria-label="Rewind 15 minutes" title="Rewind 15 minutes" onClick={onRewind}>
          <Rewind size={17} />
        </button>
        <button className="vcr-button" type="button" aria-label="Change replay speed" title="Change replay speed" onClick={onSpeed}>
          <Gauge size={16} />
          <span>{speed}x</span>
        </button>
        <button
          className={`vcr-button laser ${laserShowActive ? 'active' : ''}`}
          type="button"
          aria-label="Replay today's packet comets as a smart Laser Show"
          title="Laser Show replays today's routed packet comets in smooth capped batches"
          disabled={status === 'loading' && !laserShowActive}
          onClick={onLaserShow}
        >
          <Sparkles size={15} />
          <span>Laser</span>
        </button>
        <button className="vcr-button icon-only vcr-close" type="button" aria-label="Hide replay controls and return live" title="Hide replay controls and return live" onClick={onClose}>
          <Play size={16} />
        </button>
      </div>

      <div className="vcr-readout" aria-live="polite">
        <strong>{readout.statusLabel}</strong>
        <span className={`vcr-live-clock ${activeHoverTimestamp !== null ? 'hover' : mode}`} title={readout.clockTitle}>
          {readoutBusy ? (
            <LoaderCircle className="vcr-live-clock-icon spinning" size={13} aria-hidden="true" />
          ) : (
            <RadioTower className="vcr-live-clock-icon" size={13} aria-hidden="true" />
          )}
          <span className="vcr-live-clock-label">{readout.clockLabel}</span>
          <time className="vcr-live-clock-time" dateTime={new Date(readoutTimestamp).toISOString()}>
            {formatClock(readoutTimestamp)}
          </time>
        </span>
      </div>

      <div className="vcr-timeline-wrap">
        <div className="vcr-scope" role="group" aria-label="History scope">
          {VCR_SCOPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={scopeMs === option.value ? 'active' : ''}
              type="button"
              aria-pressed={scopeMs === option.value}
              onClick={() => onScope(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div
          className="vcr-timeline-shell"
          style={{ '--vcr-progress': `${progress}%` } as CSSProperties}
          onPointerMove={updateHoverTimestamp}
          onPointerLeave={() => setHoverTimestamp(null)}
        >
          <div className="vcr-timeline-track" aria-hidden="true" />
          <div className="vcr-sparkline" aria-hidden="true">
            {summary.map((bucket) => (
              <span key={bucket.start} style={{ height: `${Math.max(8, Math.round((bucket.count / maxBucket) * 100))}%` }} />
            ))}
          </div>
          {activeHoverTimestamp !== null && (
            <div
              className="vcr-hover-time"
              style={{ left: `${timelineProgressPercent(start, timelineNow, activeHoverTimestamp)}%` }}
              role="status"
            >
              <strong>{formatFullDateTime(activeHoverTimestamp)}</strong>
              <span>{relativeTimelineLabel(activeHoverTimestamp, timelineNow)}</span>
            </div>
          )}
          <input
            className="vcr-timeline"
            type="range"
            min={start}
            max={timelineNow}
            step={1000}
            value={value}
            aria-label="Replay timeline"
            aria-valuetext={`Selected ${formatClock(value)}`}
            title={activeHoverTimestamp === null ? 'Scrub replay timeline' : `Hover ${formatClock(activeHoverTimestamp)}`}
            onChange={(event) => onScrub(Number(event.currentTarget.value))}
          />
        </div>
      </div>
    </section>
  );
}

export function MiniLiveClock({ timestamp, onOpen }: { timestamp: number; onOpen: () => void }) {
  return (
    <button className="vcr-mini-clock" type="button" title="Open replay controls" aria-label={`Live clock ${formatClock(timestamp)}. Open replay controls`} onClick={onOpen}>
      <RadioTower className="vcr-live-clock-icon" size={14} aria-hidden="true" />
      <span>LIVE</span>
      <time dateTime={new Date(timestamp).toISOString()}>{formatClock(timestamp)}</time>
    </button>
  );
}

export function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp));
}

function formatFullDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp));
}

function clampTimestamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
