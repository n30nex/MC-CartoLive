import { describe, expect, it } from 'vitest';
import { classifyLiveEnvelopeSequence, helloRequiresCursorResetProbe, liveCursorResetTarget, retainLiveEnvelopesAfterCursor, shouldQueueDurableLiveSequence, takeIncreasingLiveEnvelopes } from './liveCursor';
import { applyPublicEnvelope, emptyState } from './state';
import type { PublicLiveEnvelope } from './types';

const event = (id: string, seq?: number): PublicLiveEnvelope => ({
  v: 1,
  type: 'event',
  event: 'activity',
  ...(seq === undefined ? {} : { seq }),
  serverTime: 1_000,
  displayAt: 1_000,
  data: {
    id,
    kind: 'packet',
    payloadTypeName: 'ADVERT',
    heardAt: 1_000,
    hopCount: 0,
    hasRoute: false,
    animationState: 'unmapped',
    resolutionBucket: 'missing_location'
  }
});

describe('live durable cursor', () => {
  it('accepts sparse, strictly increasing durable sequences created by dedupe holes', () => {
    const result = takeIncreasingLiveEnvelopes([event('a', 101), event('b', 103), event('c', 108)], 100);

    expect(result).toMatchObject({ cursor: 108, invalid: false, nonMonotonic: false });
    expect(result.accepted.map((message) => message.type === 'event' && message.data.id)).toEqual(['a', 'b', 'c']);
  });

  it('applies seq-less and zero fallback events without advancing the durable cursor', () => {
    const result = takeIncreasingLiveEnvelopes([
      event('durable-a', 101),
      event('fallback-omitted'),
      event('fallback-zero', 0),
      event('durable-b', 105)
    ], 100);

    expect(result.cursor).toBe(105);
    expect(result.accepted.map((message) => message.type === 'event' && message.data.id)).toEqual([
      'durable-a',
      'fallback-omitted',
      'fallback-zero',
      'durable-b'
    ]);

    const fallbackOnly = takeIncreasingLiveEnvelopes([event('fallback-omitted'), event('fallback-zero', 0)], 100);
    const applied = fallbackOnly.accepted.reduce(applyPublicEnvelope, { ...emptyState, latestSeq: 100 });
    expect(applied.activity.map((activity) => activity.id)).toEqual(['fallback-zero', 'fallback-omitted']);
    expect(applied.latestSeq).toBe(100);
    expect(fallbackOnly.cursor).toBe(100);
  });

  it('keeps future fallback events while pruning durable events already covered by recovery', () => {
    const messages = [event('old', 99), event('fallback'), event('new', 103)];

    expect(retainLiveEnvelopesAfterCursor(messages, 100).map((message) => message.type === 'event' && message.data.id)).toEqual([
      'fallback',
      'new'
    ]);
  });

  it('distinguishes fallback sequences from malformed and non-monotonic durable input', () => {
    expect(classifyLiveEnvelopeSequence(event('omitted')).kind).toBe('fallback');
    expect(classifyLiveEnvelopeSequence(event('zero', 0)).kind).toBe('fallback');
    expect(classifyLiveEnvelopeSequence(event('invalid', -1)).kind).toBe('invalid');

    const result = takeIncreasingLiveEnvelopes([event('new', 105), event('older', 104)], 100);
    expect(result).toMatchObject({ cursor: 105, invalid: false, nonMonotonic: true });
    expect(result.accepted.map((message) => message.type === 'event' && message.data.id)).toEqual(['new']);
  });

  it('ignores an older dedupe retry while a newer durable event is pending', () => {
    expect(shouldQueueDurableLiveSequence(105, 100, 100)).toBe(true);
    expect(shouldQueueDurableLiveSequence(103, 100, 105)).toBe(false);
    expect(shouldQueueDurableLiveSequence(105, 100, 105)).toBe(false);
  });

  it('rebases a reset epoch without chasing the obsolete pre-reset cursor', () => {
    expect(liveCursorResetTarget(10, 1_000, 10)).toBe(10);
    expect(liveCursorResetTarget(10, 1_000, 15)).toBe(15);
    expect(liveCursorResetTarget(10, 1_000, 1_000)).toBe(10);
    expect(liveCursorResetTarget(1_100, 1_000, 1_105)).toBe(1_105);
    expect(liveCursorResetTarget(0, 1_000, 0)).toBe(0);
    expect(helloRequiresCursorResetProbe(10, 1_000)).toBe(true);
    expect(helloRequiresCursorResetProbe(0, 1_000)).toBe(true);
    expect(helloRequiresCursorResetProbe(1_000, 1_000)).toBe(false);
    expect(helloRequiresCursorResetProbe(1_005, 1_000)).toBe(false);
  });
});
