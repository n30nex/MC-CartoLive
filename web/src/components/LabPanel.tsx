import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Activity,
  Disc3,
  FlaskConical,
  Maximize2,
  Minimize2,
  RadioTower,
  Sparkles,
  Volume2,
  VolumeX,
  Waves,
  X,
  Zap
} from 'lucide-react';
import {
  LAB_EXPERIMENTS,
  buildSequencerPattern,
  eventIntensity,
  eventPitchHz,
  eventStereoPan,
  experimentByID,
  labEventsFromState,
  labMetrics,
  regionCells,
  routeOrganismRoutes,
  type LabEvent,
  type LabExperimentID,
  type LabMetrics,
  type LabPayloadMix,
  type LabPoint,
  type LabRegionCell,
  type LabRouteOrganismRoute,
  type LabSequencerPattern,
  type LabSequencerStep
} from '../lab';
import type { AppState } from '../state';
import type { PublicNode, PublicRoute } from '../types';
import { toggleWorkspacePresentation, workspacePresentationTitle, type WorkspacePresentation } from './workspacePanel';

interface LabPanelProps {
  state: Pick<AppState, 'activity' | 'pulses' | 'nodes' | 'routes' | 'stats' | 'serverTime'>;
  socketStatus: string;
  presentation?: WorkspacePresentation;
  onPresentationChange?: (presentation: WorkspacePresentation) => void;
  onClose: () => void;
}

type LabAudioStatus = 'idle' | 'ready' | 'blocked' | 'unsupported';

const LAB_VISUAL_WINDOW_MS = 90_000;
const SEQUENCER_STEP_COUNT = 16;

export default function LabPanel({
  state,
  socketStatus,
  presentation = 'side',
  onPresentationChange,
  onClose
}: LabPanelProps) {
  const [activeExperiment, setActiveExperiment] = useState<LabExperimentID>('synth');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [volume, setVolume] = useState(0.32);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [sequencerStep, setSequencerStep] = useState(0);
  const [now, setNow] = useState(() => state.serverTime || Date.now());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const events = useMemo(() => labEventsFromState(state), [state.activity, state.pulses]);
  const metrics = useMemo(() => labMetrics(events, state.nodes, state.routes, now), [events, now, state.nodes, state.routes]);
  const sequence = useMemo(() => buildSequencerPattern(events, now, SEQUENCER_STEP_COUNT), [events, now]);
  const organismRoutes = useMemo(() => routeOrganismRoutes(state.routes, events, now), [events, now, state.routes]);
  const radarCells = useMemo(() => regionCells(events, now), [events, now]);
  const experiment = experimentByID(activeExperiment);

  const audio = useLabAudio({
    activeExperiment,
    enabled: audioEnabled,
    events,
    sequence,
    sequencerStep,
    volume
  });

  useEffect(() => {
    if (activeExperiment !== 'sequencer') return undefined;
    const intervalMs = reducedMotion ? 540 : Math.max(160, 420 - Math.round(metrics.liveEnergy * 130));
    const interval = window.setInterval(() => setSequencerStep((step) => (step + 1) % SEQUENCER_STEP_COUNT), intervalMs);
    return () => window.clearInterval(interval);
  }, [activeExperiment, metrics.liveEnergy, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let frame = 0;
    let raf = 0;
    const render = (clock: number) => {
      drawLabCanvas(canvas, {
        activeExperiment,
        clock,
        events,
        metrics,
        nodes: state.nodes,
        organismRoutes,
        radarCells,
        reducedMotion,
        routes: state.routes,
        sequence,
        sequencerStep
      });
      frame += 1;
      if (reducedMotion && frame % 4 !== 0) {
        raf = window.requestAnimationFrame(render);
        return;
      }
      raf = window.requestAnimationFrame(render);
    };
    raf = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(raf);
  }, [activeExperiment, events, metrics, organismRoutes, radarCells, reducedMotion, sequence, sequencerStep, state.nodes, state.routes]);

  const enableAudio = useCallback(() => {
    audio.enable().then((ok) => setAudioEnabled(ok));
  }, [audio]);

  const disableAudio = useCallback(() => {
    audio.disable();
    setAudioEnabled(false);
  }, [audio]);

  const activeStep = sequence.steps[sequencerStep] ?? sequence.steps[0];

  return (
    <section className={`lab-panel workspace-panel workspace-${presentation}`} aria-label="Labs">
      <header className="lab-panel-header">
        <div>
          <span className="panel-eyebrow">2.9.3 Labs</span>
          <h2>Live RF Labs</h2>
        </div>
        <div className="lab-panel-actions">
          {onPresentationChange && (
            <button
              type="button"
              className="icon-button"
              title={workspacePresentationTitle(presentation)}
              aria-label={workspacePresentationTitle(presentation)}
              onClick={() => onPresentationChange(toggleWorkspacePresentation(presentation))}
            >
              {presentation === 'fullscreen' ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          )}
          <button
            type="button"
            className={`icon-button ${audioEnabled ? 'active' : ''}`}
            title={audioEnabled ? 'Mute labs audio' : 'Enable labs audio'}
            aria-label={audioEnabled ? 'Mute labs audio' : 'Enable labs audio'}
            onClick={audioEnabled ? disableAudio : enableAudio}
          >
            {audioEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <button type="button" className="icon-button" title="Close labs" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="lab-toolbar" aria-label="Lab experiments">
        {LAB_EXPERIMENTS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === activeExperiment ? 'active' : ''}
            aria-pressed={item.id === activeExperiment}
            title={item.label}
            onClick={() => setActiveExperiment(item.id)}
          >
            {labIcon(item.id)}
            <span>{item.shortLabel}</span>
          </button>
        ))}
      </div>

      <div className="lab-stage-shell">
        <div className="lab-stage-title">
          <div>
            <span className="panel-eyebrow">{experiment.mode}</span>
            <strong>{experiment.label}</strong>
          </div>
          <LiveBadge status={socketStatus} energy={metrics.liveEnergy} audioStatus={audio.status} audioEnabled={audioEnabled} />
        </div>
        <canvas ref={canvasRef} className="lab-canvas" />
      </div>

      <div className="lab-bottom-grid">
        <section className="lab-control-surface" aria-label="Audio controls">
          <div className="lab-control-row">
            <label htmlFor="lab-volume">Volume</label>
            <input
              id="lab-volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
            <span>{Math.round(volume * 100)}%</span>
          </div>
          <label className="lab-toggle-row">
            <input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} />
            <span>Reduced motion</span>
          </label>
          <div className="lab-step-strip" aria-label="Sequencer steps">
            {sequence.steps.map((step) => (
              <span
                key={step.index}
                className={step.index === sequencerStep ? 'active' : ''}
                style={{ '--step-opacity': (0.36 + step.energy * 0.62).toFixed(3) } as CSSProperties}
                title={`Step ${step.index + 1}: ${step.count}`}
              />
            ))}
          </div>
        </section>

        <MetricsPanel metrics={metrics} activeStep={activeStep} />
        <PayloadPanel mix={metrics.payloadMix} />
      </div>
    </section>
  );
}

function MetricsPanel({ metrics, activeStep }: { metrics: LabMetrics; activeStep: LabSequencerStep }) {
  return (
    <section className="lab-metrics" aria-label="Lab metrics">
      <Metric icon={<Activity size={15} />} label="Rate" value={`${metrics.packetRatePerMinute}/min`} />
      <Metric icon={<RadioTower size={15} />} label="Routes" value={`${metrics.routedPerMinute}/min`} />
      <Metric icon={<Waves size={15} />} label="Observers" value={`${metrics.observerPerMinute}/min`} />
      <Metric icon={<Zap size={15} />} label="Energy" value={`${Math.round(metrics.liveEnergy * 100)}%`} />
      <Metric icon={<Sparkles size={15} />} label="Step" value={`${activeStep.count} hits`} />
    </section>
  );
}

function PayloadPanel({ mix }: { mix: LabPayloadMix[] }) {
  return (
    <section className="lab-payload-mix" aria-label="Payload mix">
      {mix.length === 0 && <span className="lab-empty">No live payloads</span>}
      {mix.map((item) => (
        <span key={item.payloadTypeName} style={{ '--payload-color': item.color } as CSSProperties}>
          <i />
          <strong>{item.label}</strong>
          <em>{item.count}</em>
        </span>
      ))}
    </section>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="lab-metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LiveBadge({
  status,
  energy,
  audioStatus,
  audioEnabled
}: {
  status: string;
  energy: number;
  audioStatus: LabAudioStatus;
  audioEnabled: boolean;
}) {
  const label = audioEnabled ? audioStatus : 'muted';
  return (
    <div className="lab-live-badge" style={{ '--lab-opacity': (0.44 + energy * 0.5).toFixed(3), '--lab-glow': `${Math.round(8 + energy * 18)}px` } as CSSProperties}>
      <span>{status}</span>
      <i />
      <span>{label}</span>
    </div>
  );
}

function labIcon(id: LabExperimentID) {
  switch (id) {
    case 'synth':
      return <Waves size={15} />;
    case 'waterfall':
      return <Activity size={15} />;
    case 'sequencer':
      return <Disc3 size={15} />;
    case 'organism':
      return <RadioTower size={15} />;
    case 'constellation':
      return <Sparkles size={15} />;
    case 'aurora':
      return <Waves size={15} />;
    case 'dj':
      return <Disc3 size={15} />;
    case 'radar':
      return <RadioTower size={15} />;
    case 'fireflies':
      return <Sparkles size={15} />;
    default:
      return <FlaskConical size={15} />;
  }
}

function useLabAudio({
  activeExperiment,
  enabled,
  events,
  sequence,
  sequencerStep,
  volume
}: {
  activeExperiment: LabExperimentID;
  enabled: boolean;
  events: LabEvent[];
  sequence: LabSequencerPattern;
  sequencerStep: number;
  volume: number;
}) {
  const contextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const [status, setStatus] = useState<LabAudioStatus>('idle');

  const enable = useCallback(async () => {
    if (typeof window === 'undefined') return false;
    const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      setStatus('unsupported');
      return false;
    }
    try {
      const context = contextRef.current ?? new AudioContextCtor();
      contextRef.current = context;
      if (!masterGainRef.current) {
        const master = context.createGain();
        const compressor = context.createDynamicsCompressor();
        master.gain.value = volumeToGain(volume);
        master.connect(compressor);
        compressor.connect(context.destination);
        masterGainRef.current = master;
      }
      await context.resume();
      setStatus('ready');
      return true;
    } catch {
      setStatus('blocked');
      return false;
    }
  }, [volume]);

  const disable = useCallback(() => {
    masterGainRef.current?.gain.setTargetAtTime(0, contextRef.current?.currentTime ?? 0, 0.015);
    setStatus('idle');
  }, []);

  useEffect(() => {
    const context = contextRef.current;
    const master = masterGainRef.current;
    if (!context || !master) return;
    master.gain.setTargetAtTime(enabled ? volumeToGain(volume) : 0, context.currentTime, 0.018);
  }, [enabled, volume]);

  useEffect(() => {
    if (!enabled || activeExperiment === 'sequencer') return;
    const context = contextRef.current;
    const master = masterGainRef.current;
    if (!context || !master || context.state !== 'running') return;
    const cutoff = Date.now() - 12_000;
    const fresh = events
      .filter((event) => event.displayAt >= cutoff && !seenRef.current.has(event.id))
      .sort((a, b) => a.displayAt - b.displayAt)
      .slice(-6);
    fresh.forEach((event, index) => {
      seenRef.current.add(event.id);
      playEventTone(context, master, event, index * 0.045, activeExperiment);
    });
    if (seenRef.current.size > 700) {
      seenRef.current = new Set([...seenRef.current].slice(-320));
    }
  }, [activeExperiment, enabled, events]);

  useEffect(() => {
    if (!enabled || activeExperiment !== 'sequencer') return;
    const context = contextRef.current;
    const master = masterGainRef.current;
    if (!context || !master || context.state !== 'running') return;
    const step = sequence.steps[sequencerStep];
    if (!step || step.count === 0) return;
    playStepTone(context, master, step);
  }, [activeExperiment, enabled, sequence, sequencerStep]);

  useEffect(() => () => {
    contextRef.current?.close().catch(() => undefined);
  }, []);

  return { enable, disable, status };
}

function playEventTone(context: AudioContext, master: GainNode, event: LabEvent, offsetSeconds: number, activeExperiment: LabExperimentID) {
  const start = context.currentTime + offsetSeconds;
  const duration = activeExperiment === 'aurora' ? 0.82 : activeExperiment === 'dj' ? 0.24 : 0.16 + Math.min(0.28, event.hopCount * 0.025);
  const gain = context.createGain();
  const pan = context.createStereoPanner();
  const oscillator = context.createOscillator();
  oscillator.type = waveformForEvent(event, activeExperiment);
  oscillator.frequency.setValueAtTime(eventPitchHz(event), start);
  oscillator.detune.setValueAtTime(event.kind === 'observer' ? -8 : event.kind === 'unmapped' ? -21 : 0, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.038 + eventIntensity(event) * 0.035, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  pan.pan.setValueAtTime(eventStereoPan(event), start);
  oscillator.connect(gain);
  gain.connect(pan);
  pan.connect(master);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
  oscillator.addEventListener('ended', () => {
    oscillator.disconnect();
    gain.disconnect();
    pan.disconnect();
  }, { once: true });
}

function playStepTone(context: AudioContext, master: GainNode, step: LabSequencerStep) {
  const start = context.currentTime;
  const count = Math.max(1, Math.min(5, step.payloads.length || step.count));
  for (let index = 0; index < count; index++) {
    const payload = step.payloads[index % Math.max(1, step.payloads.length)];
    const fakeEvent: LabEvent = {
      id: `step-${step.index}-${index}`,
      source: 'activity',
      kind: step.routed > 0 ? 'routed' : step.observer > 0 ? 'observer' : 'unmapped',
      at: step.start,
      displayAt: step.start,
      payloadTypeName: payload?.payloadTypeName ?? 'OTHER',
      payloadLabel: payload?.label ?? 'OTH',
      color: payload?.color ?? '#7dd3fc',
      region: '',
      iata: '',
      hopCount: Math.max(1, step.routed + index),
      segmentCount: step.routed,
      distanceKm: step.energy * 900,
      routeIds: [],
      endpointLabels: [],
      points: []
    };
    playEventTone(context, master, fakeEvent, index * 0.055, 'sequencer');
  }
}

function waveformForEvent(event: LabEvent, activeExperiment: LabExperimentID): OscillatorType {
  if (activeExperiment === 'aurora') return 'sine';
  if (activeExperiment === 'dj') return event.kind === 'routed' ? 'sawtooth' : 'triangle';
  if (event.messageText) return 'triangle';
  if (event.kind === 'observer') return 'square';
  return 'sine';
}

function volumeToGain(volume: number): number {
  const safe = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
  return safe * safe * 0.82;
}

function drawLabCanvas(canvas: HTMLCanvasElement, input: {
  activeExperiment: LabExperimentID;
  clock: number;
  events: LabEvent[];
  metrics: LabMetrics;
  nodes: PublicNode[];
  organismRoutes: LabRouteOrganismRoute[];
  radarCells: LabRegionCell[];
  reducedMotion: boolean;
  routes: PublicRoute[];
  sequence: LabSequencerPattern;
  sequencerStep: number;
}) {
  const ctx = prepareCanvas(canvas);
  const width = canvas.width;
  const height = canvas.height;
  const t = input.reducedMotion ? 0 : input.clock / 1000;
  paintBackdrop(ctx, width, height, input.metrics.liveEnergy, t);

  switch (input.activeExperiment) {
    case 'synth':
      drawSynth(ctx, width, height, input.events, input.metrics, t);
      break;
    case 'waterfall':
      drawWaterfall(ctx, width, height, input.events, t);
      break;
    case 'sequencer':
      drawSequencer(ctx, width, height, input.sequence, input.sequencerStep, t);
      break;
    case 'organism':
      drawOrganism(ctx, width, height, input.organismRoutes, t);
      break;
    case 'constellation':
      drawConstellation(ctx, width, height, input.nodes, input.routes, input.events, t);
      break;
    case 'aurora':
      drawAurora(ctx, width, height, input.events, input.metrics, t);
      break;
    case 'dj':
      drawDj(ctx, width, height, input.events, input.metrics, t);
      break;
    case 'radar':
      drawRadar(ctx, width, height, input.radarCells, t);
      break;
    case 'fireflies':
      drawFireflies(ctx, width, height, input.events, t);
      break;
    default:
      drawSynth(ctx, width, height, input.events, input.metrics, t);
      break;
  }
}

function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.floor((rect.width || 800) * dpr));
  const height = Math.max(1, Math.floor((rect.height || 460) * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('lab canvas unavailable');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return ctx;
}

function paintBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, energy: number, t: number) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#06111c');
  gradient.addColorStop(0.48, '#0b1620');
  gradient.addColorStop(1, '#111827');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.globalAlpha = 0.18 + energy * 0.16;
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  const gap = Math.max(34, Math.min(68, width / 16));
  for (let x = (t * 8) % gap; x < width; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - height * 0.18, height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSynth(ctx: CanvasRenderingContext2D, width: number, height: number, events: LabEvent[], metrics: LabMetrics, t: number) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * (0.16 + metrics.liveEnergy * 0.08);
  drawPulseRings(ctx, cx, cy, radius, metrics.liveEnergy, '#38bdf8', t);
  events.slice(0, 80).forEach((event, index) => {
    const angle = index * 0.78 + t * 0.32;
    const distance = radius + 26 + (index % 12) * 13 + eventIntensity(event) * 58;
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * 0.72;
    ctx.fillStyle = event.color;
    ctx.globalAlpha = 0.24 + eventIntensity(event) * 0.52;
    ctx.beginPath();
    ctx.arc(x, y, 2.5 + event.hopCount * 0.28, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  drawCenterText(ctx, cx, cy, 'RF', `${metrics.packetRatePerMinute}/min`);
}

function drawWaterfall(ctx: CanvasRenderingContext2D, width: number, height: number, events: LabEvent[], t: number) {
  const lanes = [...new Set(events.map((event) => event.payloadLabel))].slice(0, 9);
  const laneCount = Math.max(1, lanes.length);
  const top = height * 0.12;
  const laneHeight = (height * 0.76) / laneCount;
  const now = Date.now();
  ctx.font = `${Math.max(11, width / 92)}px system-ui`;
  lanes.forEach((lane, index) => {
    const y = top + index * laneHeight + laneHeight / 2;
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.globalAlpha = 0.58;
    ctx.fillStyle = '#dbeafe';
    ctx.fillText(lane, 18, y - 6);
  });
  events.slice(0, 180).forEach((event) => {
    const lane = Math.max(0, lanes.indexOf(event.payloadLabel));
    const age = Math.max(0, now - event.displayAt);
    const x = width - (age / LAB_VISUAL_WINDOW_MS) * width;
    if (x < -40 || x > width + 40) return;
    const y = top + lane * laneHeight + laneHeight * (0.35 + (stableHash(event.id) % 30) / 100);
    const length = 18 + Math.min(150, event.distanceKm / 5 + event.hopCount * 9);
    ctx.strokeStyle = event.color;
    ctx.lineWidth = 2 + eventIntensity(event) * 5;
    ctx.globalAlpha = 0.18 + eventIntensity(event) * 0.58;
    ctx.beginPath();
    ctx.moveTo(x - length, y);
    ctx.lineTo(x, y + Math.sin(t + lane) * 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 3 + eventIntensity(event) * 7, 0, Math.PI * 2);
    ctx.fillStyle = event.color;
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawSequencer(ctx: CanvasRenderingContext2D, width: number, height: number, pattern: LabSequencerPattern, activeStep: number, t: number) {
  const pad = Math.max(18, width * 0.035);
  const gap = 8;
  const cellW = (width - pad * 2 - gap * (pattern.steps.length - 1)) / pattern.steps.length;
  const maxCount = Math.max(1, ...pattern.steps.map((step) => step.count));
  pattern.steps.forEach((step) => {
    const x = pad + step.index * (cellW + gap);
    const cellH = height * (0.32 + step.count / maxCount * 0.42);
    const y = height - pad - cellH;
    const active = step.index === activeStep;
    const color = step.payloads[0]?.color ?? '#38bdf8';
    ctx.globalAlpha = active ? 0.94 : 0.32 + step.energy * 0.4;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(2, cellW), cellH);
    ctx.globalAlpha = active ? 0.28 : 0.08;
    ctx.fillRect(x - 2, pad, cellW + 4, height - pad * 2);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#e5edf7';
    ctx.font = `${Math.max(10, width / 110)}px system-ui`;
    ctx.fillText(String(step.index + 1).padStart(2, '0'), x + 2, height - 8);
    if (active) drawPulseRings(ctx, x + cellW / 2, y, 18 + step.energy * 40, step.energy, color, t);
  });
  ctx.globalAlpha = 1;
}

function drawOrganism(ctx: CanvasRenderingContext2D, width: number, height: number, routes: LabRouteOrganismRoute[], t: number) {
  const points = routes.flatMap((route) => [route.from, route.to]);
  const project = projector(points, width, height);
  routes.forEach((route, index) => {
    const from = project(route.from);
    const to = project(route.to);
    const activity = route.activity;
    const lift = Math.sin(t + index * 0.73) * (18 + activity * 42);
    const cx = (from.x + to.x) / 2;
    const cy = (from.y + to.y) / 2 - lift;
    ctx.strokeStyle = route.color;
    ctx.globalAlpha = 0.16 + activity * 0.68;
    ctx.lineWidth = 1.5 + Math.min(10, Math.log10(route.packetCount + 1) * 3 + activity * 4);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(cx, cy, to.x, to.y);
    ctx.stroke();
  });
  drawRouteNodes(ctx, routes, project, t);
  ctx.globalAlpha = 1;
}

function drawConstellation(ctx: CanvasRenderingContext2D, width: number, height: number, nodes: PublicNode[], routes: PublicRoute[], events: LabEvent[], t: number) {
  const points: LabPoint[] = nodes.map((node) => ({ lat: node.latitude, lng: node.longitude, label: node.label }));
  const project = projector(points, width, height);
  routes.slice(0, 120).forEach((route) => {
    const from = project({ lat: route.from.lat, lng: route.from.lng, label: route.from.label });
    const to = project({ lat: route.to.lat, lng: route.to.lng, label: route.to.label });
    ctx.globalAlpha = 0.08 + Math.min(0.22, route.frequencyBucket * 0.04);
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  });
  nodes.slice(0, 220).forEach((node, index) => {
    const p = project({ lat: node.latitude, lng: node.longitude, label: node.label });
    const fresh = Math.max(0, 1 - (Date.now() - node.lastSeen) / (30 * 60_000));
    const r = 1.8 + Math.min(6, Math.log10(node.activityCount + 1) * 1.8) + fresh * 2;
    ctx.globalAlpha = 0.36 + fresh * 0.46;
    ctx.fillStyle = node.role === 'repeater' ? '#facc15' : node.isObserver ? '#fb7185' : '#67e8f9';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + Math.sin(t * 1.5 + index) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  });
  events.filter((event) => event.kind === 'routed').slice(0, 32).forEach((event, index) => {
    const point = event.points[index % Math.max(1, event.points.length)];
    if (!point) return;
    const p = project(point);
    drawPulseRings(ctx, p.x, p.y, 16 + eventIntensity(event) * 44, eventIntensity(event), event.color, t + index);
  });
  ctx.globalAlpha = 1;
}

function drawAurora(ctx: CanvasRenderingContext2D, width: number, height: number, events: LabEvent[], metrics: LabMetrics, t: number) {
  const longEvents = events.filter((event) => event.kind === 'routed' && (event.distanceKm >= 180 || event.hopCount >= 4)).slice(0, 24);
  const bandCount = Math.max(3, Math.min(8, longEvents.length || Math.ceil(metrics.liveEnergy * 8)));
  for (let band = 0; band < bandCount; band++) {
    const event = longEvents[band % Math.max(1, longEvents.length)];
    const color = event?.color ?? (band % 2 ? '#a3e635' : '#38bdf8');
    ctx.strokeStyle = color;
    ctx.lineWidth = 10 + band * 2;
    ctx.globalAlpha = 0.12 + (event ? eventIntensity(event) * 0.24 : metrics.liveEnergy * 0.22);
    ctx.beginPath();
    for (let x = -20; x <= width + 20; x += 18) {
      const y = height * (0.22 + band * 0.08) + Math.sin(x / 82 + t * 0.7 + band) * (22 + band * 6);
      if (x <= -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  drawCenterText(ctx, width / 2, height * 0.66, 'DX', `${Math.round(metrics.longestDistanceKm)} km`);
}

function drawDj(ctx: CanvasRenderingContext2D, width: number, height: number, events: LabEvent[], metrics: LabMetrics, t: number) {
  const mix = metrics.payloadMix.length ? metrics.payloadMix : [{ payloadTypeName: 'OTHER', label: 'OTH', color: '#7dd3fc', count: 1 }];
  const maxCount = Math.max(1, ...mix.map((item) => item.count));
  const barW = width / (mix.length * 1.7);
  mix.forEach((payload, index) => {
    const x = width * 0.12 + index * barW * 1.55;
    const h = height * 0.18 + (payload.count / maxCount) * height * 0.46 + Math.sin(t * 4 + index) * 12;
    const y = height * 0.74 - h;
    ctx.fillStyle = payload.color;
    ctx.globalAlpha = 0.78;
    ctx.fillRect(x, y, barW, h);
    ctx.globalAlpha = 0.32;
    ctx.fillRect(x, y - 18, barW, 10);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#e2e8f0';
    ctx.font = `${Math.max(11, width / 96)}px system-ui`;
    ctx.fillText(payload.label, x, height * 0.8);
  });
  events.slice(0, 36).forEach((event, index) => {
    const angle = (index / 36) * Math.PI * 2 + t * 0.26;
    const r = Math.min(width, height) * (0.14 + eventIntensity(event) * 0.18);
    const cx = width * 0.78;
    const cy = height * 0.34;
    ctx.globalAlpha = 0.22 + eventIntensity(event) * 0.34;
    ctx.strokeStyle = event.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle, angle + 0.28 + eventIntensity(event));
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function drawRadar(ctx: CanvasRenderingContext2D, width: number, height: number, cells: LabRegionCell[], t: number) {
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) * 0.42;
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.24;
  for (let r = maxRadius / 4; r <= maxRadius; r += maxRadius / 4) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.48;
  ctx.strokeStyle = '#a7f3d0';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(t) * maxRadius, cy + Math.sin(t) * maxRadius);
  ctx.stroke();
  cells.forEach((cell, index) => {
    const angle = index / Math.max(1, cells.length) * Math.PI * 2 + (stableHash(cell.region) % 60) / 100;
    const radius = maxRadius * (0.28 + (index % 5) * 0.14);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    ctx.globalAlpha = 0.26 + cell.energy * 0.56;
    ctx.fillStyle = cell.color;
    ctx.beginPath();
    ctx.arc(x, y, 10 + cell.energy * 36 + Math.log2(cell.count + 1) * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = '#f8fafc';
    ctx.font = `${Math.max(11, width / 92)}px system-ui`;
    ctx.fillText(cell.region.toUpperCase(), x + 12, y + 4);
  });
  ctx.globalAlpha = 1;
}

function drawFireflies(ctx: CanvasRenderingContext2D, width: number, height: number, events: LabEvent[], t: number) {
  const messages = events.filter((event) => event.messageText).slice(0, 80);
  const points = messages.flatMap((event) => event.points);
  const project = projector(points, width, height);
  messages.forEach((event, index) => {
    const base = event.points[0] ? project(event.points[0]) : seededPoint(event.id, width, height);
    const float = 18 + (stableHash(event.id) % 46);
    const x = base.x + Math.sin(t * 0.7 + index) * float;
    const y = base.y + Math.cos(t * 0.5 + index * 1.7) * float * 0.6;
    ctx.globalAlpha = 0.22 + eventIntensity(event) * 0.6;
    ctx.fillStyle = event.color;
    ctx.beginPath();
    ctx.arc(x, y, 5 + eventIntensity(event) * 9, 0, Math.PI * 2);
    ctx.fill();
    if (index < 10) {
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = '#e5edf7';
      ctx.font = `${Math.max(10, width / 110)}px system-ui`;
      ctx.fillText(compactText(event.messageSender || event.endpointLabels[0] || event.region || 'msg', 14), x + 12, y + 4);
    }
  });
  if (messages.length === 0) drawCenterText(ctx, width / 2, height / 2, 'MSG', 'quiet');
  ctx.globalAlpha = 1;
}

function drawRouteNodes(ctx: CanvasRenderingContext2D, routes: LabRouteOrganismRoute[], project: (point: LabPoint) => { x: number; y: number }, t: number) {
  const byLabel = new Map<string, { point: LabPoint; energy: number; color: string }>();
  for (const route of routes) {
    for (const point of [route.from, route.to]) {
      const existing = byLabel.get(point.label) ?? { point, energy: 0, color: route.color };
      existing.energy = Math.max(existing.energy, route.activity);
      existing.color = route.activity >= existing.energy ? route.color : existing.color;
      byLabel.set(point.label, existing);
    }
  }
  [...byLabel.values()].slice(0, 120).forEach((node, index) => {
    const p = project(node.point);
    ctx.globalAlpha = 0.34 + node.energy * 0.54;
    ctx.fillStyle = node.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 + node.energy * 10 + Math.sin(t + index) * 1.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPulseRings(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, energy: number, color: string, t: number) {
  for (let index = 0; index < 3; index++) {
    ctx.globalAlpha = (0.25 - index * 0.055) * (0.45 + energy);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 + energy * 2;
    ctx.beginPath();
    ctx.arc(x, y, radius + ((t * 18 + index * 19) % 56), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawCenterText(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, value: string) {
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 32px system-ui';
  ctx.fillText(label, x, y - 6);
  ctx.font = '600 15px system-ui';
  ctx.fillStyle = '#bae6fd';
  ctx.fillText(value, x, y + 20);
  ctx.textAlign = 'start';
}

function projector(points: LabPoint[], width: number, height: number): (point: LabPoint) => { x: number; y: number } {
  const valid = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (valid.length === 0) return (point) => seededPoint(`${point.label}:${point.lat}:${point.lng}`, width, height);
  const minLat = Math.min(...valid.map((point) => point.lat));
  const maxLat = Math.max(...valid.map((point) => point.lat));
  const minLng = Math.min(...valid.map((point) => point.lng));
  const maxLng = Math.max(...valid.map((point) => point.lng));
  const latRange = Math.max(0.2, maxLat - minLat);
  const lngRange = Math.max(0.2, maxLng - minLng);
  const pad = Math.min(width, height) * 0.1;
  return (point) => {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return seededPoint(point.label, width, height);
    return {
      x: pad + ((point.lng - minLng) / lngRange) * Math.max(1, width - pad * 2),
      y: height - pad - ((point.lat - minLat) / latRange) * Math.max(1, height - pad * 2)
    };
  };
}

function seededPoint(seed: string, width: number, height: number): { x: number; y: number } {
  const hash = stableHash(seed);
  return {
    x: width * (0.12 + ((hash % 1000) / 1000) * 0.76),
    y: height * (0.16 + (((hash >>> 8) % 1000) / 1000) * 0.68)
  };
}

function compactText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxLength - 3))}...`;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
