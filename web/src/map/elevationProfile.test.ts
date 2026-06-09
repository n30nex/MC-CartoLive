import { describe, expect, it } from 'vitest';
import { elevationToMeters, summarizeElevation } from './elevationProfile';

describe('elevationToMeters', () => {
  it('decodes zero-elevation terrarium pixel', () => {
    expect(elevationToMeters(128, 0, 0)).toBeCloseTo(0, 0);
  });

  it('decodes a high-elevation terrarium pixel', () => {
    // R=128, G=0, B=0 → 128*256+0+0/256-32768 = 0
    // R=255, G=255, B=255 → 255*256+255+255/256-32768 ≈ 32822
    const meters = elevationToMeters(255, 255, 255);
    expect(meters).toBeGreaterThan(32000);
    expect(meters).toBeLessThan(33000);
  });

  it('decodes a negative-elevation value', () => {
    const meters = elevationToMeters(0, 0, 0);
    expect(meters).toBeCloseTo(-32768, 0);
  });
});

describe('summarizeElevation', () => {
  it('returns zeroes for empty array', () => {
    const s = summarizeElevation([]);
    expect(s.min).toBe(0);
    expect(s.max).toBe(0);
    expect(s.gain).toBe(0);
    expect(s.loss).toBe(0);
  });

  it('computes stats for a flat profile', () => {
    const s = summarizeElevation([100, 100, 100]);
    expect(s.min).toBe(100);
    expect(s.max).toBe(100);
    expect(s.avg).toBe(100);
    expect(s.gain).toBe(0);
    expect(s.loss).toBe(0);
    expect(s.start).toBe(100);
    expect(s.end).toBe(100);
  });

  it('computes gain and loss correctly', () => {
    const s = summarizeElevation([0, 50, 30, 80, 20]);
    expect(s.min).toBe(0);
    expect(s.max).toBe(80);
    expect(s.gain).toBeCloseTo(100, 0); // (50-0)+(80-30) = 100
    expect(s.loss).toBeCloseTo(80, 0); // (50-30)+(80-20) = 80
    expect(s.start).toBe(0);
    expect(s.end).toBe(20);
  });

  it('handles single-element array', () => {
    const s = summarizeElevation([42]);
    expect(s.min).toBe(42);
    expect(s.max).toBe(42);
    expect(s.avg).toBe(42);
    expect(s.gain).toBe(0);
    expect(s.loss).toBe(0);
  });
});
