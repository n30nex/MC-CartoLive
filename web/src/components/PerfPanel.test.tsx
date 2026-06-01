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
    expect(systemSummaryFromHealth({ mqttConnected: true, mqttLastMessageAgeMs: 10_000, publicLiveFresh: true }, { ready: true }, 6, 6)).toEqual({ value: 'live', tone: 'good' });
    expect(systemSummaryFromHealth({ mqttConnected: false, publicLiveFresh: false }, { ready: true }, 5, 6)).toEqual({ value: 'degraded', tone: 'warn' });
    expect(systemSummaryFromHealth(null, null, 0, 6)).toEqual({ value: 'offline', tone: 'bad' });
  });

  it('renders the public-safe live status shell', () => {
    const html = renderToStaticMarkup(<PerfPanel onClose={() => undefined} />);
    expect(html).toContain('Live Status');
    expect(html).toContain('Is the system live?');
    expect(html).toContain('Browser / Public API');
    expect(html).toContain('MQTT Ingest');
    expect(html).toContain('Routes / Map Motion');
    expect(html).toContain('Clients / Public Data');
    expect(html).toContain('Packet endpoint');
    expect(html).toContain('Chat endpoint');
    expect(html).not.toContain('Perf Lab');
    expect(html).not.toContain('local-only');
    expect(html).not.toContain('Git SHA');
    expect(html).not.toContain('packet hash');
    expect(html).toContain('Public-safe aggregate checks only.');
  });
});
