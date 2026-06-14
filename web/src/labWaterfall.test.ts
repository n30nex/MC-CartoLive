import { describe, expect, it } from 'vitest';
import {
  WATERFALL_SYNTH_LIMITS,
  planWaterfallSynthVoices,
  prepareWaterfallDrops,
  shouldRenderWaterfallFrame,
  waterfallAmbientCount,
  waterfallRenderBudget,
  waterfallTempo
} from './labWaterfall';
import type { LabEvent, LabMetrics, LabWaterfallLane } from './lab';

describe('labWaterfall safety helpers', () => {
  it('caps desktop, mobile, and reduced-motion render profiles', () => {
    const desktop = waterfallRenderBudget({ width: 1440, height: 760, devicePixelRatio: 3, reducedMotion: false });
    expect(desktop.dpr).toBe(1.25);
    expect(desktop.fps).toBe(30);
    expect(desktop.maxDrops).toBe(120);
    expect(desktop.maxAmbientStreaks).toBe(36);

    const mobile = waterfallRenderBudget({ width: 390, height: 740, devicePixelRatio: 3, reducedMotion: false });
    expect(mobile.dpr).toBe(1);
    expect(mobile.maxDrops).toBe(72);
    expect(mobile.maxAmbientStreaks).toBe(18);

    const reduced = waterfallRenderBudget({ width: 1440, height: 760, devicePixelRatio: 2, reducedMotion: true });
    expect(reduced.dpr).toBe(1);
    expect(reduced.fps).toBe(12);
    expect(reduced.frameMs).toBeCloseTo(83.33, 1);
  });

  it('skips frames before expensive Waterfall work', () => {
    const budget = waterfallRenderBudget({ width: 1440, height: 760, devicePixelRatio: 1, reducedMotion: false });
    expect(shouldRenderWaterfallFrame(10, 0, budget)).toBe(true);
    expect(shouldRenderWaterfallFrame(20, 10, budget)).toBe(false);
    expect(shouldRenderWaterfallFrame(44, 10, budget)).toBe(true);
  });

  it('caps prepared packet drops and ambient streaks', () => {
    const budget = waterfallRenderBudget({ width: 1440, height: 760, devicePixelRatio: 1, reducedMotion: false });
    const drops = prepareWaterfallDrops({
      events: Array.from({ length: 260 }, (_, index) => event(`event-${index}`, index)),
      lanes: lanes(),
      density: 1.6,
      budget
    });

    expect(drops).toHaveLength(budget.maxDrops);
    expect(drops[0].event.id).toBe('event-140');
    expect(waterfallAmbientCount(lanes(), 1.6, budget)).toBeLessThanOrEqual(budget.maxAmbientStreaks);
  });

  it('caps rhythmic synth voices while keeping mapped voice types', () => {
    const metrics = metricsWithEnergy(0.85);
    const plan = planWaterfallSynthVoices({
      events: [
        event('observer', 1, 'observer'),
        event('route', 2, 'routed'),
        event('message', 3, 'unmapped', true),
        event('extra-a', 4)
      ],
      metrics,
      rhythm: 1,
      availableVoicesThisSecond: 16
    });

    expect(plan.tempo).toBeGreaterThanOrEqual(WATERFALL_SYNTH_LIMITS.minTempo);
    expect(plan.tempo).toBeLessThanOrEqual(WATERFALL_SYNTH_LIMITS.maxTempo);
    expect(plan.voices).toHaveLength(WATERFALL_SYNTH_LIMITS.maxVoicesPerStep);
    expect(plan.voices.map((voice) => voice.kind)).toEqual(expect.arrayContaining(['bass', 'hat', 'pluck']));
  });

  it('honors the per-second synth voice budget', () => {
    const plan = planWaterfallSynthVoices({
      events: Array.from({ length: 12 }, (_, index) => event(`event-${index}`, index)),
      metrics: metricsWithEnergy(0.5),
      rhythm: 0.5,
      availableVoicesThisSecond: 2
    });

    expect(plan.voices).toHaveLength(2);
    expect(waterfallTempo(metricsWithEnergy(0), 0)).toBe(WATERFALL_SYNTH_LIMITS.minTempo);
    expect(waterfallTempo(metricsWithEnergy(1), 1)).toBe(WATERFALL_SYNTH_LIMITS.maxTempo);
  });
});

function lanes(): LabWaterfallLane[] {
  return [
    { payloadTypeName: 'PLAIN_TEXT', label: 'TXT', color: '#38bdf8', count: 12, routed: 6, observer: 0, messages: 2, energy: 0.8 },
    { payloadTypeName: 'ADVERT', label: 'ADV', color: '#2dd4bf', count: 8, routed: 0, observer: 8, messages: 0, energy: 0.5 }
  ];
}

function event(id: string, index: number, kind: LabEvent['kind'] = 'unmapped', message = false): LabEvent {
  return {
    id,
    source: 'activity',
    kind,
    at: 1_700_000_000_000 + index,
    displayAt: 1_700_000_000_000 + index,
    payloadTypeName: kind === 'observer' ? 'ADVERT' : 'PLAIN_TEXT',
    payloadLabel: kind === 'observer' ? 'Advert' : 'Plain text',
    color: kind === 'observer' ? '#2dd4bf' : '#38bdf8',
    region: 'CA',
    iata: 'YYZ',
    hopCount: kind === 'routed' ? 3 : 0,
    segmentCount: kind === 'routed' ? 2 : 0,
    distanceKm: kind === 'routed' ? 44 : 0,
    routeIds: kind === 'routed' ? ['route-a'] : [],
    endpointLabels: kind === 'routed' ? ['Alpha', 'Bravo'] : [],
    points: [],
    messageText: message ? 'hello public' : undefined
  };
}

function metricsWithEnergy(liveEnergy: number): LabMetrics {
  return {
    eventCount: 0,
    packetRatePerMinute: 0,
    routedPerMinute: 0,
    observerPerMinute: 0,
    unmappedPerMinute: 0,
    liveEnergy,
    averageHopCount: 0,
    longestDistanceKm: 0,
    activeRegionCount: 0,
    activeRegions: [],
    payloadMix: [],
    messageCount: 0
  };
}
