import { Download, Gauge, Map, Mountain, Pause, Play, RadioTower, Share2, Sparkles, Waves, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccessibleDialog } from '../lib/useAccessibleDialog';
import ElevationProfile from './ElevationProfile';
import { replaySegmentAt, replayTimeline } from '../replayStudio';
import type { MapModeID } from '../mapSettings';
import type { PublicPacketPath, PublicRouteSegment } from '../types';
import './rf-replay-studio.css';

interface Props {
  packet: PublicPacketPath | null;
  deepLinkStatus?: 'pending' | 'resolved' | 'fallback' | 'unavailable' | null;
  mode: MapModeID;
  exportBusy?: boolean;
  webmSupported?: boolean;
  webmBusy?: boolean;
  onModeChange: (mode: MapModeID) => void;
  onReplay: (packet: PublicPacketPath, speed: number, staticStory: boolean) => void;
  onPause: () => void;
  onSeek: (segment: PublicRouteSegment) => void;
  onShare: (packet: PublicPacketPath) => void;
  onExportGif?: () => void;
  onExportWebM?: (speed: number) => void;
  onOpenWaterfall: () => void;
  onClose: () => void;
}

const REPLAY_DURATION_MS = 8_000;

export default function RFReplayStudio({ packet, deepLinkStatus = null, mode, exportBusy = false, webmSupported = false, webmBusy = false, onModeChange, onReplay, onPause, onSeek, onShare, onExportGif, onExportWebM, onOpenWaterfall, onClose }: Props) {
  const dialogRef = useAccessibleDialog<HTMLDivElement>(true, onClose);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [routeContextOpen, setRouteContextOpen] = useState(false);
  const playbackPreference = useStaticReplayPreference();
  const staticStory = playbackPreference !== null;
  const startedAtRef = useRef(0);
  const startedProgressRef = useRef(0);
  const timeline = useMemo(() => packet ? replayTimeline(packet) : [], [packet]);
  const active = packet ? replaySegmentAt(packet, progress) : null;

  useEffect(() => {
    if (!playing || !packet || staticStory) return;
    let frame = 0;
    const duration = REPLAY_DURATION_MS / speed;
    const tick = (now: number) => {
      const next = Math.min(1, startedProgressRef.current + (now - startedAtRef.current) / duration);
      setProgress(next);
      if (next >= 1) {
        setPlaying(false);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [packet, playing, speed, staticStory]);

  const start = () => {
    if (!packet) return;
    const nextProgress = progress >= 0.995 ? 0 : progress;
    setProgress(nextProgress);
    if (staticStory) {
      const segment = replaySegmentAt(packet, nextProgress)?.segment ?? packet.segments[0];
      if (segment) onSeek(segment);
      onReplay(packet, speed, true);
      return;
    }
    startedAtRef.current = performance.now();
    startedProgressRef.current = nextProgress;
    setPlaying(true);
    onReplay(packet, speed, false);
  };

  const pause = () => {
    setPlaying(false);
    onPause();
  };

  const seek = (next: number) => {
    setPlaying(false);
    setProgress(next);
    const segment = packet ? replaySegmentAt(packet, next)?.segment : undefined;
    if (segment) onSeek(segment);
  };

  return (
    <div className="rf-studio-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="rf-replay-studio" role="dialog" aria-modal="true" aria-labelledby="rf-studio-title" tabIndex={-1}>
        <header className="rf-studio-header">
          <div><span>Visual lab</span><h2 id="rf-studio-title"><Sparkles size={19} /> RF Replay Studio</h2></div>
          <button type="button" aria-label="Close RF Replay Studio" onClick={onClose}><X size={17} /></button>
        </header>

        {!packet || packet.segments.length === 0 ? (
          <div className="rf-studio-empty">
            <RadioTower size={30} />
            <h3>{deepLinkStatus === 'pending' ? 'Resolving replay…' : deepLinkStatus === 'unavailable' ? 'Replay unavailable' : 'Choose a public pathway'}</h3>
            <p>{deepLinkStatus === 'unavailable' ? 'This public event and its route are no longer retained. Select a current route or packet to start a new story.' : 'Select a route or routed packet, then reopen Replay Studio. Expired packet links fall back to the retained route when available.'}</p>
          </div>
        ) : (
          <>
            <section className="rf-studio-stage" aria-label="Route story preview">
              <RouteStoryGraphic segments={packet.segments} progress={progress} />
              <div className="rf-studio-stage-copy">
                <span>{packet.payloadTypeName.replaceAll('_', ' ')}</span>
                <h3>{packet.endpointLabels[0] ?? packet.segments[0].from.label} <em>to</em> {packet.endpointLabels.at(-1) ?? packet.segments.at(-1)?.to.label}</h3>
                <p>{packet.segmentCount} {packet.segmentCount === 1 ? 'segment' : 'segments'} · {packet.distanceKm.toFixed(1)} km · privacy-safe public route</p>
              </div>
            </section>

            <section className="rf-studio-modes" aria-label="Replay camera mode">
              <button type="button" className={mode === 'explore' || mode === 'watch' ? 'active' : ''} aria-pressed={mode === 'explore' || mode === 'watch'} onClick={() => onModeChange('explore')}><Map size={15} /><span>2D</span></button>
              <button type="button" className={mode === 'terrain' ? 'active' : ''} aria-pressed={mode === 'terrain'} onClick={() => onModeChange('terrain')}><Mountain size={15} /><span>Terrain</span></button>
              <button type="button" className={mode === 'studio' ? 'active' : ''} aria-pressed={mode === 'studio'} onClick={() => onModeChange('studio')}><Sparkles size={15} /><span>3D flight</span></button>
            </section>

            <section className="rf-studio-context" aria-label="Public route context">
              <span><small>Signal</small><strong>{packet.payloadTypeName.replaceAll('_', ' ')}</strong></span>
              <span><small>Distance</small><strong>{packet.distanceKm.toFixed(1)} km</strong></span>
              <span><small>Path</small><strong>{packet.segmentCount} {packet.segmentCount === 1 ? 'segment' : 'segments'}</strong></span>
              <button type="button" aria-expanded={routeContextOpen} onClick={() => setRouteContextOpen((value) => !value)}><Mountain size={14} /><span>{routeContextOpen ? 'Hide LOS' : 'LOS / elevation'}</span></button>
            </section>
            {routeContextOpen && <div className="rf-studio-elevation"><ElevationProfile from={packet.segments[0].from} to={packet.segments.at(-1)?.to ?? packet.segments[0].to} /></div>}

            <section className="rf-studio-timeline" aria-label="Replay timeline">
              <div className="rf-studio-segments" aria-hidden="true">
                {timeline.map((entry, index) => <i key={`${entry.segment.routeId}-${index}`} className={progress >= entry.start ? 'active' : ''} style={{ flex: Math.max(.08, entry.end - entry.start) }} />)}
              </div>
              <input aria-label="Route replay position" type="range" min={0} max={1} step={0.001} value={progress} onChange={(event) => seek(Number(event.target.value))} />
              <div className="rf-studio-segment-copy">
                <span>Segment {Math.max(1, timeline.indexOf(active ?? timeline[0]) + 1)} / {timeline.length}</span>
                <strong>{active?.segment.from.label} → {active?.segment.to.label}</strong>
                <em>{active?.segment.distanceKm.toFixed(1)} km</em>
              </div>
            </section>

            <section className="rf-studio-controls">
              <button data-autofocus type="button" className="rf-studio-play" onClick={playing ? pause : start}>{playing ? <Pause size={17} /> : <Play size={17} />}<span>{staticStory ? 'Show story' : playing ? 'Pause' : 'Play route'}</span></button>
              <div className="rf-studio-speed" role="group" aria-label="Replay speed">
                <Gauge size={14} />
                {[0.5, 1, 2].map((option) => <button key={option} type="button" className={speed === option ? 'active' : ''} aria-pressed={speed === option} onClick={() => { setSpeed(option); setPlaying(false); }}>{option}×</button>)}
              </div>
            </section>

            <footer className="rf-studio-footer">
              <button type="button" onClick={() => onShare(packet)}><Share2 size={15} /><span>Copy story link</span></button>
              <button type="button" onClick={onOpenWaterfall}><Waves size={15} /><span>Waterfall</span></button>
              {onExportGif && <button type="button" disabled={exportBusy} onClick={onExportGif}><Download size={15} /><span>{exportBusy ? 'Rendering…' : 'Export GIF'}</span></button>}
              <button type="button" disabled={!webmSupported || webmBusy || !onExportWebM} title={webmSupported ? 'Record up to 720p locally' : 'WebM recording is unsupported here; GIF remains available.'} onClick={() => onExportWebM?.(speed)}><Download size={15} /><span>{webmBusy ? 'Recording…' : webmSupported ? 'Export WebM' : 'WebM unsupported'}</span></button>
              <p>{playbackPreference === 'reduced-motion'
                ? 'Reduced motion is active: Replay Studio uses a static route story.'
                : playbackPreference === 'low-power'
                  ? 'Low-power or data-saver mode is active: Replay Studio uses a static route story.'
                  : 'Animation and exports stay in this browser; nothing is uploaded.'}</p>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function RouteStoryGraphic({ segments, progress }: { segments: PublicRouteSegment[]; progress: number }) {
  const points = useMemo(() => routeStoryPoints(segments), [segments]);
  return (
    <svg viewBox="0 0 640 240" role="img" aria-label="Stylized preview of the selected public RF route">
      <defs><linearGradient id="rf-studio-gradient" x1="0" x2="1"><stop stopColor="#38bdf8" /><stop offset=".52" stopColor="#a78bfa" /><stop offset="1" stopColor="#fb7185" /></linearGradient></defs>
      <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="rgba(148,163,184,.28)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="url(#rf-studio-gradient)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray={`${progress} 1`} />
      {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index === 0 || index === points.length - 1 ? 7 : 4} fill={index / Math.max(1, points.length - 1) <= progress ? '#f8fafc' : '#475569'} />)}
    </svg>
  );
}

function routeStoryPoints(segments: PublicRouteSegment[]): { x: number; y: number }[] {
  const raw = [segments[0]?.from, ...segments.map((segment) => segment.to)].filter(Boolean) as PublicRouteSegment['from'][];
  if (raw.length === 0) return [];
  const lngs = raw.map((point) => point.lng);
  const lats = raw.map((point) => point.lat);
  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  return raw.map((point, index) => ({
    x: 54 + ((point.lng - minLng) / Math.max(.001, maxLng - minLng)) * 532,
    y: 188 - ((point.lat - minLat) / Math.max(.001, maxLat - minLat)) * 130 + Math.sin(index * 1.7) * 10
  }));
}

type StaticReplayPreference = 'reduced-motion' | 'low-power' | null;

function useStaticReplayPreference(): StaticReplayPreference {
  const preference = () => staticReplayPreference({
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    reducedData: window.matchMedia?.('(prefers-reduced-data: reduce)').matches ?? false,
    saveData: Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)
  });
  const [value, setValue] = useState<StaticReplayPreference>(preference);
  useEffect(() => {
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const data = window.matchMedia?.('(prefers-reduced-data: reduce)');
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    const update = () => setValue(preference());
    motion?.addEventListener?.('change', update);
    data?.addEventListener?.('change', update);
    connection?.addEventListener?.('change', update);
    return () => {
      motion?.removeEventListener?.('change', update);
      data?.removeEventListener?.('change', update);
      connection?.removeEventListener?.('change', update);
    };
  }, []);
  return value;
}

export function staticReplayPreference(input: { reducedMotion: boolean; reducedData: boolean; saveData: boolean }): StaticReplayPreference {
  if (input.reducedMotion) return 'reduced-motion';
  if (input.reducedData || input.saveData) return 'low-power';
  return null;
}
