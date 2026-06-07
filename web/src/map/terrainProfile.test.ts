import { describe, expect, it } from 'vitest';
import { routeLOSColor, type LOSResult } from './terrainProfile';

function los(clear: boolean, confidence: number): LOSResult {
  return { clear, confidence, minClearanceMeters: 0, maxObstructionMeters: 0, fresnelRadiusMeters: 0, frequencyGHz: 0.915 };
}

describe('routeLOSColor', () => {
  it('returns green for clear high-confidence', () => { const r = routeLOSColor(los(true, 0.9)); expect(r.color).toBe('#22c55e'); expect(r.opacity).toBeGreaterThan(0.6); });
  it('returns yellow for clear medium', () => { expect(routeLOSColor(los(true, 0.65)).color).toBe('#84cc16'); });
  it('returns orange for blocked moderate', () => { expect(routeLOSColor(los(false, 0.55)).color).toBe('#f97316'); });
  it('returns red for blocked low', () => { const r = routeLOSColor(los(false, 0.3)); expect(r.color).toBe('#ef4444'); expect(r.opacity).toBeLessThan(0.4); });
});
