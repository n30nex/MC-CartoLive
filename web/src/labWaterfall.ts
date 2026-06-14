import {
  eventIntensity,
  eventPitchHz,
  eventStereoPan,
  stableHash,
  type LabEvent,
  type LabMetrics,
  type LabWaterfallLane
} from './lab';

export interface WaterfallSettings {
  volume: number;
  rhythm: number;
  motion: number;
  density: number;
  windowSeconds: number;
  payloadFocus: string;
  reducedMotion: boolean;
}

export interface WaterfallRenderBudget {
  dpr: number;
  fps: number;
  frameMs: number;
  maxDrops: number;
  maxAmbientStreaks: number;
  maxImpactRings: number;
  mobile: boolean;
}

export interface WaterfallPreparedDrop {
  key: string;
  event: LabEvent;
  laneIndex: number;
  seed: number;
  intensity: number;
  color: string;
}

export type WaterfallSynthVoiceKind = 'bass' | 'pluck' | 'hat';

export interface WaterfallSynthVoice {
  key: string;
  kind: WaterfallSynthVoiceKind;
  frequency: number;
  pan: number;
  gain: number;
  duration: number;
  offsetSeconds: number;
}

export interface WaterfallSynthPlan {
  tempo: number;
  secondsPerStep: number;
  voices: WaterfallSynthVoice[];
}

export const WATERFALL_SETTINGS_KEY = 'mc-cartolive-waterfall-settings-v2';
export const DEFAULT_WATERFALL_SETTINGS: WaterfallSettings = {
  volume: 0.22,
  rhythm: 0.62,
  motion: 0.58,
  density: 0.68,
  windowSeconds: 90,
  payloadFocus: 'all',
  reducedMotion: false
};

export const WATERFALL_SYNTH_LIMITS = {
  minTempo: 82,
  maxTempo: 124,
  maxVoicesPerStep: 4,
  maxVoicesPerSecond: 16
} as const;

const PENTATONIC_MINOR_OFFSETS = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];

export function waterfallRenderBudget({
  width,
  height,
  devicePixelRatio,
  reducedMotion
}: {
  width: number;
  height: number;
  devicePixelRatio: number;
  reducedMotion: boolean;
}): WaterfallRenderBudget {
  const mobile = width < 720 || height < 520;
  const dpr = reducedMotion || mobile ? 1 : clampNumber(devicePixelRatio, 1, 1.25, 1);
  const fps = reducedMotion ? 12 : 30;
  return {
    dpr,
    fps,
    frameMs: 1000 / fps,
    maxDrops: mobile ? 72 : 120,
    maxAmbientStreaks: mobile ? 18 : 36,
    maxImpactRings: mobile ? 4 : 8,
    mobile
  };
}

export function shouldRenderWaterfallFrame(clock: number, lastPaintClock: number, budget: WaterfallRenderBudget): boolean {
  return lastPaintClock <= 0 || clock - lastPaintClock >= budget.frameMs - 1;
}

export function waterfallAmbientCount(lanes: LabWaterfallLane[], density: number, budget: WaterfallRenderBudget): number {
  const requested = Math.round((14 + lanes.length * 4) * clampNumber(density, 0.25, 1.2, DEFAULT_WATERFALL_SETTINGS.density));
  return Math.max(4, Math.min(budget.maxAmbientStreaks, requested));
}

export function prepareWaterfallDrops({
  events,
  lanes,
  density,
  budget
}: {
  events: LabEvent[];
  lanes: LabWaterfallLane[];
  density: number;
  budget: WaterfallRenderBudget;
}): WaterfallPreparedDrop[] {
  const laneMap = new Map(lanes.map((lane, index) => [lane.payloadTypeName, index]));
  const laneCount = Math.max(1, lanes.length || 1);
  const dropLimit = Math.max(12, Math.min(budget.maxDrops, Math.round(budget.maxDrops * clampNumber(density, 0.25, 1, DEFAULT_WATERFALL_SETTINGS.density))));
  return [...events]
    .sort((a, b) => a.displayAt - b.displayAt || a.id.localeCompare(b.id))
    .slice(-dropLimit)
    .map((event) => {
      const key = `${event.source}:${event.id}`;
      return {
        key,
        event,
        laneIndex: laneMap.get(event.payloadTypeName) ?? Math.abs(stableHash(event.payloadTypeName)) % laneCount,
        seed: stableHash(key),
        intensity: eventIntensity(event),
        color: event.color || '#22d3ee'
      };
    });
}

export function waterfallTempo(metrics: Pick<LabMetrics, 'liveEnergy'>, rhythm = DEFAULT_WATERFALL_SETTINGS.rhythm): number {
  const energy = clampNumber(metrics.liveEnergy, 0, 1, 0);
  const feel = clampNumber(rhythm, 0, 1, DEFAULT_WATERFALL_SETTINGS.rhythm);
  return Math.round(WATERFALL_SYNTH_LIMITS.minTempo + (energy * 0.72 + feel * 0.28) * (WATERFALL_SYNTH_LIMITS.maxTempo - WATERFALL_SYNTH_LIMITS.minTempo));
}

export function planWaterfallSynthVoices({
  events,
  metrics,
  rhythm,
  availableVoicesThisSecond = WATERFALL_SYNTH_LIMITS.maxVoicesPerSecond
}: {
  events: LabEvent[];
  metrics: Pick<LabMetrics, 'liveEnergy'>;
  rhythm: number;
  availableVoicesThisSecond?: number;
}): WaterfallSynthPlan {
  const tempo = waterfallTempo(metrics, rhythm);
  const secondsPerStep = 60 / tempo / 2;
  const limit = Math.max(0, Math.min(WATERFALL_SYNTH_LIMITS.maxVoicesPerStep, WATERFALL_SYNTH_LIMITS.maxVoicesPerSecond, availableVoicesThisSecond));
  const voices = [...events]
    .sort((a, b) => a.displayAt - b.displayAt || a.id.localeCompare(b.id))
    .slice(-limit)
    .map((event, index) => synthVoiceForEvent(event, index, secondsPerStep));
  return { tempo, secondsPerStep, voices };
}

function synthVoiceForEvent(event: LabEvent, index: number, secondsPerStep: number): WaterfallSynthVoice {
  const intensity = eventIntensity(event);
  const basePitch = eventPitchHz(event);
  const scaleIndex = stableHash(`${event.payloadTypeName}:${event.kind}`) % PENTATONIC_MINOR_OFFSETS.length;
  const octave = event.kind === 'routed' ? -12 : event.messageText ? 12 : 0;
  const frequency = midiToHz(50 + PENTATONIC_MINOR_OFFSETS[scaleIndex] + octave + Math.min(12, Math.max(0, event.hopCount)));
  const baseKind: WaterfallSynthVoiceKind = event.kind === 'observer' ? 'hat' : event.kind === 'routed' ? 'bass' : 'pluck';
  const kind: WaterfallSynthVoiceKind = event.messageText ? 'pluck' : baseKind;
  return {
    key: `${event.source}:${event.id}`,
    kind,
    frequency: kind === 'hat' ? Math.min(3200, Math.max(900, basePitch * 2.2)) : frequency,
    pan: eventStereoPan(event),
    gain: 0.025 + intensity * 0.055,
    duration: kind === 'bass' ? 0.42 + intensity * 0.22 : kind === 'hat' ? 0.055 + intensity * 0.035 : 0.18 + intensity * 0.16,
    offsetSeconds: index * secondsPerStep
  };
}

function midiToHz(midi: number): number {
  return Math.round(440 * 2 ** ((midi - 69) / 12));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
}
