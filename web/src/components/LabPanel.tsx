import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Activity,
  Gauge,
  Maximize2,
  Minimize2,
  Music2,
  RadioTower,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  Waves,
  X
} from 'lucide-react';
import {
  DEFAULT_LAB_EXPERIMENT_ID,
  WATERFALL_BACKGROUND_SRC,
  WATERFALL_MIST_SRC,
  filterLabEventsByPayload,
  labEventsFromState,
  labMetrics,
  stableHash,
  waterfallLanes,
  type LabEvent,
  type LabExperimentID,
  type LabMetrics,
  type LabWaterfallLane
} from '../lab';
import {
  DEFAULT_WATERFALL_SETTINGS,
  WATERFALL_SETTINGS_KEY,
  WATERFALL_SYNTH_LIMITS,
  planWaterfallSynthVoices,
  prepareWaterfallDrops,
  shouldRenderWaterfallFrame,
  waterfallAmbientCount,
  waterfallRenderBudget,
  waterfallTempo,
  type WaterfallPreparedDrop,
  type WaterfallRenderBudget,
  type WaterfallSettings,
  type WaterfallSynthVoice
} from '../labWaterfall';
import type { AppState } from '../state';
import { toggleWorkspacePresentation, workspacePresentationTitle, type WorkspacePresentation } from './workspacePanel';

interface LabPanelProps {
  state: Pick<AppState, 'activity' | 'pulses' | 'nodes' | 'routes' | 'stats' | 'serverTime'>;
  socketStatus: string;
  experimentID?: LabExperimentID;
  presentation?: WorkspacePresentation;
  onExperimentChange?: (experimentID: LabExperimentID) => void;
  onPresentationChange?: (presentation: WorkspacePresentation) => void;
  onClose: () => void;
}

type LabAudioStatus = 'idle' | 'ready' | 'blocked' | 'unsupported';

interface WaterfallAssets {
  background?: HTMLImageElement;
  mist?: HTMLImageElement;
}

interface WaterfallBackdropCache {
  base?: HTMLCanvasElement;
  baseKey?: string;
  mist?: HTMLCanvasElement;
  mistKey?: string;
}

const WATERFALL_ACCENT = '#22d3ee';

export default function LabPanel({
  state,
  socketStatus,
  presentation = 'side',
  onExperimentChange,
  onPresentationChange,
  onClose
}: LabPanelProps) {
  const [settings, setSettings] = useState(readWaterfallSettings);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [now, setNow] = useState(() => state.serverTime || Date.now());
  const [assets, setAssets] = useState<WaterfallAssets>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backdropCacheRef = useRef<WaterfallBackdropCache>({});
  const stageStyle = { '--lab-accent': WATERFALL_ACCENT } as CSSProperties;
  const windowMs = settings.windowSeconds * 1_000;

  useEffect(() => {
    onExperimentChange?.(DEFAULT_LAB_EXPERIMENT_ID);
  }, [onExperimentChange]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    writeWaterfallSettings(settings);
  }, [settings]);

  useEffect(() => {
    let active = true;
    const background = new Image();
    const mist = new Image();
    background.decoding = 'async';
    mist.decoding = 'async';
    background.onload = () => active && setAssets((current) => ({ ...current, background }));
    mist.onload = () => active && setAssets((current) => ({ ...current, mist }));
    background.src = WATERFALL_BACKGROUND_SRC;
    mist.src = WATERFALL_MIST_SRC;
    return () => {
      active = false;
    };
  }, []);

  const allEvents = useMemo(() => labEventsFromState(state), [state.activity, state.pulses]);
  const focusedEvents = useMemo(() => filterLabEventsByPayload(allEvents, settings.payloadFocus), [allEvents, settings.payloadFocus]);
  const visibleEvents = useMemo(() => {
    const start = now - windowMs;
    return focusedEvents.filter((event) => event.displayAt >= start && event.displayAt <= now + 5_000);
  }, [focusedEvents, now, windowMs]);
  const lanes = useMemo(() => waterfallLanes(allEvents, now, windowMs), [allEvents, now, windowMs]);
  const activeLanes = useMemo(() => waterfallLanes(visibleEvents.length ? visibleEvents : focusedEvents, now, windowMs), [focusedEvents, now, visibleEvents, windowMs]);
  const metrics = useMemo(() => labMetrics(visibleEvents.length ? visibleEvents : focusedEvents, now, windowMs), [focusedEvents, now, visibleEvents, windowMs]);
  const renderBudget = useMemo(() => currentWaterfallBudget(undefined, settings.reducedMotion), [settings.reducedMotion]);
  const preparedDrops = useMemo(
    () => prepareWaterfallDrops({ events: visibleEvents, lanes: activeLanes, density: settings.density, budget: renderBudget }),
    [activeLanes, renderBudget, settings.density, visibleEvents]
  );
  const ambientCount = useMemo(() => waterfallAmbientCount(activeLanes, settings.density, renderBudget), [activeLanes, renderBudget, settings.density]);
  const tempo = waterfallTempo(metrics, settings.rhythm);
  const latestEvent = visibleEvents[0] ?? focusedEvents[0] ?? allEvents[0];
  const audio = useWaterfallAudio({
    enabled: audioEnabled,
    events: visibleEvents,
    metrics,
    rhythm: settings.rhythm,
    volume: settings.volume
  });
  const audioStatusLabel = audioEnabled ? audio.status : audio.status === 'blocked' || audio.status === 'unsupported' ? audio.status : 'muted';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let raf = 0;
    let lastPaintClock = 0;
    let stopped = false;
    const render = (clock: number) => {
      raf = 0;
      if (stopped) return;
      const budget = currentWaterfallBudget(canvas, settings.reducedMotion);
      if (!shouldRenderWaterfallFrame(clock, lastPaintClock, budget)) {
        queueFrame();
        return;
      }
      lastPaintClock = clock;
      drawWaterfallCanvas(canvas, {
        assets,
        budget,
        cache: backdropCacheRef.current,
        clock,
        drops: preparedDrops,
        ambientCount,
        lanes: activeLanes,
        metrics,
        now: Date.now(),
        settings
      });
      queueFrame();
    };
    const queueFrame = () => {
      if (!stopped && !document.hidden && raf === 0) {
        raf = window.requestAnimationFrame(render);
      }
    };
    const handleVisibility = () => {
      if (document.hidden) {
        if (raf) window.cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      lastPaintClock = 0;
      queueFrame();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    queueFrame();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [activeLanes, ambientCount, assets, metrics, preparedDrops, settings]);

  const enableAudio = useCallback(() => {
    audio.enable().then((ok) => setAudioEnabled(ok));
  }, [audio]);

  const disableAudio = useCallback(() => {
    audio.disable();
    setAudioEnabled(false);
  }, [audio]);

  const updateSetting = useCallback(<K extends keyof WaterfallSettings>(key: K, value: WaterfallSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_WATERFALL_SETTINGS, reducedMotion: prefersReducedMotion() });
  }, []);

  return (
    <section className={`lab-panel lab-waterfall-panel workspace-panel workspace-${presentation}`} aria-label="Packet Waterfall Labs" style={stageStyle}>
      <header className="lab-panel-header waterfall-header">
        <div>
          <span className="panel-eyebrow">3.0.2 Labs</span>
          <h2>Packet Waterfall</h2>
          <p>Live public packets fall through a capped RF cascade and drive an opt-in rhythmic synth.</p>
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
            title={audioEnabled ? 'Mute waterfall audio' : 'Enable waterfall audio'}
            aria-label={audioEnabled ? 'Mute waterfall audio' : 'Enable waterfall audio'}
            onClick={audioEnabled ? disableAudio : enableAudio}
          >
            {audioEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <button type="button" className="icon-button" title="Close labs" aria-label="Close labs" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="waterfall-stage-shell">
        <canvas ref={canvasRef} className="lab-canvas waterfall-canvas" />
        <div className="waterfall-stage-vignette" aria-hidden="true" />
        <div className="waterfall-stage-hud">
          <div className="waterfall-live-badge" style={{ '--lab-opacity': (0.48 + metrics.liveEnergy * 0.46).toFixed(3) } as CSSProperties}>
            <span>{socketStatus}</span>
            <i />
            <span>{audioStatusLabel}</span>
          </div>
          <div className="waterfall-now">
            <span>Intensity</span>
            <strong>{Math.round(metrics.liveEnergy * 100)}%</strong>
          </div>
        </div>
      </div>

      <div className="waterfall-bottom-grid">
        <section className="waterfall-control-surface" aria-label="Waterfall controls">
          <ControlHeader icon={<SlidersHorizontal size={15} />} title="Flow" />
          <ControlSlider label="Volume" value={settings.volume} min={0} max={1} step={0.01} onChange={(value) => updateSetting('volume', value)} />
          <ControlSlider label="Rhythm" value={settings.rhythm} min={0} max={1} step={0.01} onChange={(value) => updateSetting('rhythm', value)} />
          <ControlSlider label="Motion" value={settings.motion} min={0.18} max={1.35} step={0.01} onChange={(value) => updateSetting('motion', value)} />
          <ControlSlider label="Density" value={settings.density} min={0.35} max={1.6} step={0.01} onChange={(value) => updateSetting('density', value)} />
          <div className="waterfall-control-row">
            <label htmlFor="waterfall-window">Window</label>
            <select id="waterfall-window" value={settings.windowSeconds} onChange={(event) => updateSetting('windowSeconds', Number(event.target.value))}>
              <option value={45}>45s</option>
              <option value={90}>90s</option>
              <option value={180}>3m</option>
            </select>
          </div>
          <div className="waterfall-control-row">
            <label htmlFor="waterfall-payload">Payload</label>
            <select id="waterfall-payload" value={settings.payloadFocus} onChange={(event) => updateSetting('payloadFocus', event.target.value)}>
              <option value="all">All</option>
              {lanes.map((lane) => <option key={lane.payloadTypeName} value={lane.payloadTypeName}>{lane.label}</option>)}
            </select>
          </div>
          <label className="waterfall-toggle-row">
            <input type="checkbox" checked={settings.reducedMotion} onChange={(event) => updateSetting('reducedMotion', event.target.checked)} />
            <span>Reduced motion</span>
          </label>
          <button type="button" className="waterfall-reset-button" onClick={resetSettings}>Reset Waterfall</button>
        </section>

        <section className="waterfall-metrics" aria-label="Waterfall metrics">
          <Metric icon={<Activity size={15} />} label="Packets" value={`${metrics.packetRatePerMinute}/min`} />
          <Metric icon={<RadioTower size={15} />} label="Routes" value={`${metrics.routedPerMinute}/min`} />
          <Metric icon={<Sparkles size={15} />} label="Observers" value={`${metrics.observerPerMinute}/min`} />
          <Metric icon={<Music2 size={15} />} label="Tempo" value={`${tempo} bpm`} />
          <Metric icon={<Gauge size={15} />} label="Longest" value={`${Math.round(metrics.longestDistanceKm)} km`} />
        </section>

        <section className="waterfall-lanes" aria-label="Waterfall payload lanes">
          <ControlHeader icon={<Waves size={15} />} title="Payload Streams" />
          {(activeLanes.length ? activeLanes : lanes).slice(0, 6).map((lane) => (
            <div key={lane.payloadTypeName} className="waterfall-lane-row" style={{ '--payload-color': lane.color, '--lane-energy': lane.energy.toFixed(3) } as CSSProperties}>
              <span><i />{lane.label}</span>
              <strong>{lane.count}</strong>
              <em>{lane.routed}r / {lane.observer}o</em>
            </div>
          ))}
          {lanes.length === 0 && <span className="waterfall-empty">No live payloads</span>}
        </section>

        <section className="waterfall-inspector" aria-label="Waterfall live event">
          <ControlHeader icon={<Sparkles size={15} />} title="Latest Drop" />
          {latestEvent ? (
            <>
              <strong>{latestEvent.payloadLabel}</strong>
              <span>{eventKindLabel(latestEvent)} / {latestEvent.region || latestEvent.iata || 'public'}</span>
              <p>{latestEvent.messageText ? compactText(latestEvent.messageText, 72) : endpointSummary(latestEvent)}</p>
            </>
          ) : (
            <>
              <strong>Quiet</strong>
              <span>waiting</span>
              <p>No public packet drops in this window.</p>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function ControlHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <header className="waterfall-section-header">
      {icon}
      <strong>{title}</strong>
    </header>
  );
}

function ControlSlider({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="waterfall-control-row">
      <label htmlFor={`waterfall-${label.toLowerCase()}`}>{label}</label>
      <input id={`waterfall-${label.toLowerCase()}`} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span>{Math.round(value * 100)}%</span>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="waterfall-metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function useWaterfallAudio({
  enabled,
  events,
  metrics,
  rhythm,
  volume
}: {
  enabled: boolean;
  events: LabEvent[];
  metrics: LabMetrics;
  rhythm: number;
  volume: number;
}) {
  const contextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const noiseBufferRef = useRef<AudioBuffer | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const scheduledVoiceTimesRef = useRef<number[]>([]);
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
        compressor.threshold.value = -18;
        compressor.knee.value = 12;
        compressor.ratio.value = 12;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.12;
        master.gain.value = volumeToGain(volume);
        master.connect(compressor);
        compressor.connect(context.destination);
        masterGainRef.current = master;
      }
      if (!noiseBufferRef.current) {
        noiseBufferRef.current = createSynthNoiseBuffer(context);
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
    masterGainRef.current?.gain.setTargetAtTime(0, contextRef.current?.currentTime ?? 0, 0.02);
    setStatus('idle');
  }, []);

  useEffect(() => {
    const context = contextRef.current;
    const master = masterGainRef.current;
    if (!context || !master) return;
    master.gain.setTargetAtTime(enabled ? volumeToGain(volume) : 0, context.currentTime, 0.025);
  }, [enabled, volume]);

  useEffect(() => {
    if (!enabled) return;
    const context = contextRef.current;
    const master = masterGainRef.current;
    if (!context || !master || context.state !== 'running') return;
    const now = Date.now();
    scheduledVoiceTimesRef.current = scheduledVoiceTimesRef.current.filter((timestamp) => now - timestamp < 1_000);
    const availableVoicesThisSecond = WATERFALL_SYNTH_LIMITS.maxVoicesPerSecond - scheduledVoiceTimesRef.current.length;
    if (availableVoicesThisSecond <= 0) return;
    const cutoff = now - 8_000;
    const fresh = events
      .filter((event) => event.displayAt >= cutoff && !seenRef.current.has(`${event.source}:${event.id}`))
      .sort((a, b) => a.displayAt - b.displayAt)
      .slice(-WATERFALL_SYNTH_LIMITS.maxVoicesPerSecond);
    const plan = planWaterfallSynthVoices({ events: fresh, metrics, rhythm, availableVoicesThisSecond });
    const stepStart = quantizedSynthStart(context.currentTime, plan.secondsPerStep);
    plan.voices.forEach((voice) => {
      seenRef.current.add(voice.key);
      scheduledVoiceTimesRef.current.push(now);
      playWaterfallSynthVoice(context, master, noiseBufferRef.current, voice, stepStart + voice.offsetSeconds);
    });
    if (seenRef.current.size > 900) {
      seenRef.current = new Set([...seenRef.current].slice(-420));
    }
  }, [enabled, events, metrics, rhythm]);

  useEffect(() => () => {
    contextRef.current?.close().catch(() => undefined);
  }, []);

  return { enable, disable, status };
}

function playWaterfallSynthVoice(context: AudioContext, master: GainNode, noise: AudioBuffer | null, voice: WaterfallSynthVoice, start: number) {
  if (voice.kind === 'hat') {
    playSynthHat(context, master, noise, voice, start);
    return;
  }
  if (voice.kind === 'bass') {
    playSynthBass(context, master, voice, start);
    return;
  }
  playSynthPluck(context, master, voice, start);
}

function playSynthBass(context: AudioContext, master: GainNode, voice: WaterfallSynthVoice, start: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const pan = context.createStereoPanner();
  const filter = context.createBiquadFilter();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(Math.max(44, voice.frequency / 2), start);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(160, start);
  filter.frequency.exponentialRampToValueAtTime(620, start + 0.06);
  filter.frequency.exponentialRampToValueAtTime(180, start + voice.duration);
  filter.Q.value = 0.86;
  pan.pan.setValueAtTime(voice.pan * 0.42, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(voice.gain * 0.82, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + voice.duration);
  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(pan);
  pan.connect(master);
  oscillator.start(start);
  oscillator.stop(start + voice.duration + 0.04);
  oscillator.onended = () => disconnectNodes(oscillator, filter, gain, pan);
}

function playSynthPluck(context: AudioContext, master: GainNode, voice: WaterfallSynthVoice, start: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const pan = context.createStereoPanner();
  const filter = context.createBiquadFilter();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(voice.frequency, start);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2400, start);
  filter.frequency.exponentialRampToValueAtTime(680, start + voice.duration);
  filter.Q.value = 0.82;
  pan.pan.setValueAtTime(voice.pan * 0.74, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(voice.gain * 0.9, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + voice.duration);
  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(pan);
  pan.connect(master);
  oscillator.start(start);
  oscillator.stop(start + voice.duration + 0.04);
  oscillator.onended = () => disconnectNodes(oscillator, filter, gain, pan);
}

function playSynthHat(context: AudioContext, master: GainNode, noise: AudioBuffer | null, voice: WaterfallSynthVoice, start: number) {
  if (!noise) return;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const pan = context.createStereoPanner();
  source.buffer = noise;
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(voice.frequency, start);
  filter.Q.value = 0.64;
  pan.pan.setValueAtTime(voice.pan * 0.64, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(voice.gain * 0.46, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + voice.duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(pan);
  pan.connect(master);
  source.start(start);
  source.stop(start + voice.duration + 0.02);
  source.onended = () => disconnectNodes(source, filter, gain, pan);
}

function createSynthNoiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * 0.25)), context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x2f6e2b1;
  for (let index = 0; index < data.length; index++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[index] = ((seed / 0xffffffff) * 2 - 1) * (1 - index / data.length);
  }
  return buffer;
}

function quantizedSynthStart(currentTime: number, secondsPerStep: number): number {
  const safeStep = Math.max(0.08, secondsPerStep);
  return Math.ceil((currentTime + 0.018) / safeStep) * safeStep;
}

function disconnectNodes(...nodes: AudioNode[]) {
  for (const node of nodes) {
    try {
      node.disconnect();
    } catch {
      // Already disconnected or released by the browser.
    }
  }
}

function drawWaterfallCanvas(canvas: HTMLCanvasElement, input: {
  assets: WaterfallAssets;
  budget: WaterfallRenderBudget;
  cache: WaterfallBackdropCache;
  clock: number;
  drops: WaterfallPreparedDrop[];
  ambientCount: number;
  lanes: LabWaterfallLane[];
  metrics: LabMetrics;
  now: number;
  settings: WaterfallSettings;
}) {
  const ctx = prepareCanvas(canvas, input.budget);
  const width = canvas.width;
  const height = canvas.height;
  const t = input.settings.reducedMotion ? 0 : input.clock / 1000;
  const motion = input.settings.reducedMotion ? 0.16 : input.settings.motion;
  const density = input.settings.density;
  const windowMs = input.settings.windowSeconds * 1_000;

  paintWaterfallBackdrop(ctx, width, height, input.assets, input.cache, input.metrics.liveEnergy, t);
  drawAmbientFalls(ctx, width, height, input.lanes, t, Math.min(input.ambientCount, input.budget.maxAmbientStreaks), density, motion);
  drawPayloadLanes(ctx, width, height, input.lanes);
  drawPacketDrops(ctx, width, height, input.drops, input.lanes, input.now, windowMs, density, motion, input.budget);
  drawWaterfallPool(ctx, width, height, input.metrics.liveEnergy, t);

  if (input.drops.length === 0) {
    drawCenterText(ctx, width / 2, height / 2, 'RF WATERFALL', 'quiet');
  }
}

function prepareCanvas(canvas: HTMLCanvasElement, budget: WaterfallRenderBudget): CanvasRenderingContext2D {
  const rect = canvas.getBoundingClientRect();
  const dpr = budget.dpr;
  const width = Math.max(1, Math.floor((rect.width || 900) * dpr));
  const height = Math.max(1, Math.floor((rect.height || 520) * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('waterfall canvas unavailable');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

function paintWaterfallBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  assets: WaterfallAssets,
  cache: WaterfallBackdropCache,
  energy: number,
  t: number
) {
  if (assets.background?.complete) {
    const base = cachedCoverLayer(cache, 'base', assets.background, width, height);
    ctx.drawImage(base, 0, 0);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#020711');
    gradient.addColorStop(0.48, '#062134');
    gradient.addColorStop(1, '#02040a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${0.22 - energy * 0.08})`;
  ctx.fillRect(0, 0, width, height);
  if (assets.mist?.complete) {
    const mist = cachedCoverLayer(cache, 'mist', assets.mist, width, height);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.14 + energy * 0.12;
    const drift = Math.sin(t * 0.08) * width * 0.012;
    ctx.drawImage(mist, drift, 0);
    if (drift > 0) ctx.drawImage(mist, drift - width, 0);
    else if (drift < 0) ctx.drawImage(mist, drift + width, 0);
  }
  ctx.restore();
}

function cachedCoverLayer(cache: WaterfallBackdropCache, layer: 'base' | 'mist', image: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const key = `${image.currentSrc || image.src}:${image.naturalWidth || image.width}x${image.naturalHeight || image.height}:${width}x${height}`;
  const existing = layer === 'base' ? cache.base : cache.mist;
  const existingKey = layer === 'base' ? cache.baseKey : cache.mistKey;
  if (existing && existingKey === key) return existing;
  const next = existing ?? document.createElement('canvas');
  next.width = width;
  next.height = height;
  const ctx = next.getContext('2d');
  if (!ctx) return next;
  ctx.clearRect(0, 0, width, height);
  drawCoverImage(ctx, image, width, height, 0, 0, layer === 'mist' ? 1.02 : 1);
  if (layer === 'base') {
    cache.base = next;
    cache.baseKey = key;
  } else {
    cache.mist = next;
    cache.mistKey = key;
  }
  return next;
}

function drawCoverImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, offsetX = 0, offsetY = 0, scale = 1) {
  const imageRatio = image.width / Math.max(1, image.height);
  const canvasRatio = width / Math.max(1, height);
  const drawHeight = imageRatio > canvasRatio ? height * scale : (width / imageRatio) * scale;
  const drawWidth = imageRatio > canvasRatio ? drawHeight * imageRatio : width * scale;
  const x = (width - drawWidth) / 2 + offsetX;
  const y = (height - drawHeight) / 2 + offsetY;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
}

function drawAmbientFalls(ctx: CanvasRenderingContext2D, width: number, height: number, lanes: LabWaterfallLane[], t: number, count: number, density: number, motion: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let index = 0; index < count; index++) {
    const lane = lanes[index % Math.max(1, lanes.length)];
    const seed = stableHash(`${lane?.payloadTypeName ?? 'ambient'}:${index}`);
    const x = ((seed % 1000) / 1000) * width;
    const speed = 0.08 + ((seed >>> 8) % 100) / 900;
    const y = ((t * speed * motion + (seed % 700) / 700) % 1) * (height + 120) - 80;
    const length = 70 + ((seed >>> 12) % 160) * density;
    const color = colorAlpha(lane?.color ?? '#22d3ee', 0.08 + (lane?.energy ?? 0.2) * 0.16);
    const gradient = ctx.createLinearGradient(x, y - length, x, y);
    gradient.addColorStop(0, colorAlpha(lane?.color ?? '#22d3ee', 0));
    gradient.addColorStop(1, color);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 0.8 + ((seed >>> 20) % 30) / 20;
    ctx.beginPath();
    ctx.moveTo(x + Math.sin(t * 0.4 + index) * 8, y - length);
    ctx.lineTo(x + Math.sin(t * 0.6 + index) * 14, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPayloadLanes(ctx: CanvasRenderingContext2D, width: number, height: number, lanes: LabWaterfallLane[]) {
  if (lanes.length === 0) return;
  const laneWidth = width / lanes.length;
  ctx.save();
  lanes.forEach((lane, index) => {
    const x = index * laneWidth;
    const gradient = ctx.createLinearGradient(x, 0, x + laneWidth, 0);
    gradient.addColorStop(0, colorAlpha(lane.color, 0));
    gradient.addColorStop(0.5, colorAlpha(lane.color, 0.055 + lane.energy * 0.09));
    gradient.addColorStop(1, colorAlpha(lane.color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, laneWidth, height);
    ctx.globalAlpha = 0.34;
    ctx.strokeStyle = colorAlpha(lane.color, 0.2);
    ctx.beginPath();
    ctx.moveTo(x + laneWidth, height * 0.08);
    ctx.lineTo(x + laneWidth, height * 0.92);
    ctx.stroke();
  });
  ctx.restore();
}

function drawPacketDrops(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  drops: WaterfallPreparedDrop[],
  lanes: LabWaterfallLane[],
  now: number,
  windowMs: number,
  density: number,
  motion: number,
  budget: WaterfallRenderBudget
) {
  const laneCount = Math.max(1, lanes.length || 1);
  const laneWidth = width / laneCount;
  const visibleDrops = drops.length > budget.maxDrops ? drops.slice(-budget.maxDrops) : drops;
  let impactRings = 0;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const drop of visibleDrops) {
    const event = drop.event;
    const age = Math.max(0, now - event.displayAt);
    const progress = clamp01((age / Math.max(1, windowMs)) * (0.62 + motion * 0.58));
    if (progress > 1.04) continue;
    const laneCenter = drop.laneIndex * laneWidth + laneWidth / 2;
    const jitter = (((drop.seed >>> 3) % 1000) / 1000 - 0.5) * laneWidth * 0.58;
    const sway = Math.sin(progress * Math.PI * 4 + drop.seed) * laneWidth * 0.06 * motion;
    const x = laneCenter + jitter + sway;
    const y = -54 + progress * (height + 124);
    const intensity = drop.intensity;
    const trail = (46 + intensity * 132) * density;
    const color = drop.color;
    const dropRadius = 2.4 + intensity * 6.8;

    const gradient = ctx.createLinearGradient(x, y - trail, x, y + dropRadius);
    gradient.addColorStop(0, colorAlpha(color, 0));
    gradient.addColorStop(0.52, colorAlpha(color, 0.24 + intensity * 0.28));
    gradient.addColorStop(1, colorAlpha('#ffffff', 0.66));

    ctx.shadowBlur = 0;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.4 + intensity * 4.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + Math.sin(y * 0.006) * 10, y - trail);
    ctx.bezierCurveTo(x - 18 * motion, y - trail * 0.6, x + 20 * motion, y - trail * 0.28, x, y);
    ctx.stroke();

    const glow = ctx.createRadialGradient(x, y, 0, x, y, dropRadius * 3.2);
    glow.addColorStop(0, colorAlpha('#ffffff', 0.72));
    glow.addColorStop(0.42, colorAlpha(color, 0.42));
    glow.addColorStop(1, colorAlpha(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, dropRadius * 3.2, 0, Math.PI * 2);
    ctx.fill();

    if (event.kind === 'routed') {
      drawRouteRibbon(ctx, x, y, trail, color, intensity, motion);
    }
    if (event.messageText) {
      drawMessageSpark(ctx, x, y, color, intensity);
    }
    if (y > height * 0.76 && impactRings < budget.maxImpactRings) {
      impactRings += 1;
      drawSplash(ctx, x, height * 0.84, color, intensity, progress);
    }
  }
  ctx.restore();
}

function drawRouteRibbon(ctx: CanvasRenderingContext2D, x: number, y: number, trail: number, color: string, intensity: number, motion: number) {
  ctx.save();
  ctx.strokeStyle = colorAlpha(color, 0.25 + intensity * 0.22);
  ctx.lineWidth = 1.1 + intensity * 2.2;
  ctx.beginPath();
  ctx.moveTo(x - 20 * motion, y - trail * 0.72);
  ctx.quadraticCurveTo(x + 38 * motion, y - trail * 0.44, x - 8 * motion, y - trail * 0.18);
  ctx.stroke();
  ctx.restore();
}

function drawMessageSpark(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, intensity: number) {
  ctx.save();
  ctx.strokeStyle = colorAlpha('#ffffff', 0.6);
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI * 2 * i) / 4 + intensity;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * 5, y + Math.sin(angle) * 5);
    ctx.lineTo(x + Math.cos(angle) * (14 + intensity * 14), y + Math.sin(angle) * (14 + intensity * 14));
    ctx.stroke();
  }
  ctx.fillStyle = colorAlpha(color, 0.55);
  ctx.beginPath();
  ctx.arc(x, y, 12 + intensity * 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSplash(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, intensity: number, progress: number) {
  const phase = (progress - 0.76) / 0.28;
  const radius = (16 + intensity * 46) * clamp01(phase);
  ctx.save();
  ctx.strokeStyle = colorAlpha(color, 0.25 + intensity * 0.3);
  ctx.lineWidth = 1.4 + intensity * 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y, radius * 1.8, radius * 0.34, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = colorAlpha(color, 0.08 + intensity * 0.08);
  ctx.beginPath();
  ctx.ellipse(x, y, radius * 1.2, radius * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWaterfallPool(ctx: CanvasRenderingContext2D, width: number, height: number, energy: number, t: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const y = height * 0.82;
  const gradient = ctx.createLinearGradient(0, y, 0, height);
  gradient.addColorStop(0, `rgba(34, 211, 238, ${0.08 + energy * 0.12})`);
  gradient.addColorStop(1, 'rgba(2, 6, 23, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, y, width, height - y);
  ctx.strokeStyle = `rgba(125, 249, 255, ${0.14 + energy * 0.18})`;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 8; i++) {
    const yy = y + i * height * 0.022 + Math.sin(t * 0.7 + i) * 4;
    ctx.beginPath();
    for (let x = -20; x <= width + 20; x += 28) {
      const wave = Math.sin(x / 80 + t * 0.8 + i) * (4 + energy * 7);
      if (x <= -20) ctx.moveTo(x, yy + wave);
      else ctx.lineTo(x, yy + wave);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawCenterText(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, value: string) {
  ctx.textAlign = 'center';
  ctx.fillStyle = '#eff6ff';
  ctx.font = '700 30px system-ui';
  ctx.fillText(label, x, y - 6);
  ctx.font = '600 15px system-ui';
  ctx.fillStyle = '#bae6fd';
  ctx.fillText(value, x, y + 22);
  ctx.textAlign = 'start';
}

function readWaterfallSettings(): WaterfallSettings {
  const defaults = {
    ...DEFAULT_WATERFALL_SETTINGS,
    reducedMotion: prefersReducedMotion()
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(WATERFALL_SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<WaterfallSettings>;
    return {
      volume: clampNumber(parsed.volume, 0, 1, defaults.volume),
      rhythm: clampNumber(parsed.rhythm, 0, 1, defaults.rhythm),
      motion: clampNumber(parsed.motion, 0.18, 1.35, defaults.motion),
      density: clampNumber(parsed.density, 0.35, 1.6, defaults.density),
      windowSeconds: [45, 90, 180].includes(Number(parsed.windowSeconds)) ? Number(parsed.windowSeconds) : defaults.windowSeconds,
      payloadFocus: typeof parsed.payloadFocus === 'string' ? parsed.payloadFocus : defaults.payloadFocus,
      reducedMotion: typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : defaults.reducedMotion
    };
  } catch {
    return defaults;
  }
}

function writeWaterfallSettings(settings: WaterfallSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WATERFALL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Local preferences are best-effort only.
  }
}

function volumeToGain(volume: number): number {
  const safe = clampNumber(volume, 0, 1, 0);
  return safe * safe * 0.62;
}

function currentWaterfallBudget(canvas: HTMLCanvasElement | undefined, reducedMotion: boolean): WaterfallRenderBudget {
  const rect = canvas?.getBoundingClientRect();
  return waterfallRenderBudget({
    width: rect?.width || (typeof window === 'undefined' ? 1024 : window.innerWidth),
    height: rect?.height || (typeof window === 'undefined' ? 640 : window.innerHeight),
    devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
    reducedMotion
  });
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function eventKindLabel(event: LabEvent): string {
  if (event.kind === 'routed') return 'route';
  if (event.kind === 'observer') return 'observer';
  return 'unmapped';
}

function endpointSummary(event: LabEvent): string {
  if (event.endpointLabels.length >= 2) return `${event.endpointLabels[0]} -> ${event.endpointLabels.at(-1)}`;
  if (event.endpointLabels[0]) return event.endpointLabels[0];
  return `${Math.max(0, event.hopCount)} hops / ${Math.round(event.distanceKm)} km`;
}

function compactText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxLength - 3))}...`;
}

function colorAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color) ?? hexToRgb(WATERFALL_ACCENT) ?? { r: 34, g: 211, b: 238 };
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clampNumber(alpha, 0, 1, 0)})`;
}

function hexToRgb(value: string): { r: number; g: number; b: number } | null {
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  };
}

function clamp01(value: number): number {
  return clampNumber(value, 0, 1, 0);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
}
