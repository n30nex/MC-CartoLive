import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PerfPanel, { formatAge, freshnessTone, systemSummaryFromHealth, toneForState } from './PerfPanel';

describe('PerfPanel helpers', () => {
  it('classifies live confidence states for compact status chips', () => {
    expect(toneForState('fresh')).toBe('good');
    expect(toneForState('moving')).toBe('good');
    expect(toneForState('quiet')).toBe('quiet');
    expect(toneForState('stale')).toBe('warn');
    expect(toneForState('degraded')).toBe('bad');
  });

  it('formats ages and freshness for scan-friendly metrics', () => {
    expect(formatAge(450)).toBe('450 ms');
    expect(formatAge(4_900)).toBe('5 s');
    expect(formatAge(125_000)).toBe('2 min');
    expect(formatAge(7_200_000)).toBe('2 h');
    expect(freshnessTone(30_000, 60_000)).toBe('good');
    expect(freshnessTone(120_000, 60_000)).toBe('warn');
    expect(freshnessTone(360_000, 60_000)).toBe('bad');
  });

  it('summarizes the live system from public-safe health signals', () => {
    expect(systemSummaryFromHealth({ mqttConnected: true, mqttLastMessageAgeMs: 10_000, routeMotionState: 'moving' }, { ready: true }, 3, 3)).toEqual({ value: 'live', tone: 'good' });
    expect(systemSummaryFromHealth({ mqttConnected: false, routeMotionState: 'stale' }, { ready: true }, 2, 3)).toEqual({ value: 'degraded', tone: 'warn' });
    expect(systemSummaryFromHealth(null, null, 0, 3)).toEqual({ value: 'not live', tone: 'bad' });
  });

  it('renders the public-safe live status shell', () => {
    const html = renderToStaticMarkup(<PerfPanel onClose={() => undefined} />);
    expect(html).toContain('Live Status');
    expect(html).toContain('Is the system live?');
    expect(html).toContain('Backend');
    expect(html).toContain('Frontend');
    expect(html).toContain('MQTT');
    expect(html).toContain('Live routes');
    expect(html).toContain('Checking live status');
    expect(html).toContain('loading-spinner');
    expect(html).not.toContain('History fetch');
    expect(html).not.toContain('Packet endpoint');
    expect(html).not.toContain('Chat endpoint');
    expect(html).not.toContain('Perf Lab');
    expect(html).not.toContain('local-only');
    expect(html).not.toContain('Git SHA');
    expect(html).not.toContain('packet hash');
    expect(html).toContain('Public-safe live checks only.');
  });
});
