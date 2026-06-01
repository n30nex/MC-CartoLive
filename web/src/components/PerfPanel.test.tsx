import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PerfPanel, { formatAge, freshnessTone, toneForState } from './PerfPanel';

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

  it('renders the public-safe live status shell', () => {
    const html = renderToStaticMarkup(<PerfPanel onClose={() => undefined} />);
    expect(html).toContain('Live Status');
    expect(html).toContain('Deployment Health');
    expect(html).toContain('Frontend / API');
    expect(html).toContain('MQTT Freshness');
    expect(html).toContain('Public Cache / State');
    expect(html).toContain('Routed Live Traffic');
    expect(html).not.toContain('Perf Lab');
    expect(html).not.toContain('local-only');
    expect(html).toContain('raw packet details');
  });
});
