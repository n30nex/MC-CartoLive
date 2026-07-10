import { describe, expect, it, vi } from 'vitest';
import { recoverPublicEventPages } from './eventRecovery';
import type { PublicEvent, PublicEventsResponse } from './types';

describe('recoverPublicEventPages', () => {
  it('paginates retained events until the advertised latest sequence', async () => {
    const pages = new Map<number, PublicEventsResponse>([
      [10, response(10, 14, [event(11), event(12)], '12')],
      [12, response(10, 14, [event(13), event(14)], '14')]
    ]);
    const applied: number[] = [];
    const fetchPage = vi.fn(async (cursor: number) => pages.get(cursor) ?? response(10, 14, []));

    const result = await recoverPublicEventPages({
      afterSeq: 10,
      targetSeq: 14,
      fetchPage,
      applyPage: (events) => applied.push(...events.map((item) => item.seq))
    });

    expect(result).toEqual({ status: 'caught-up', cursor: 14, latestSeq: 14, pages: 2 });
    expect(applied).toEqual([11, 12, 13, 14]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('returns reset only for an unrecoverable retained cursor', async () => {
    const result = await recoverPublicEventPages({
      afterSeq: 5,
      fetchPage: async () => ({ ...response(20, 30, []), resetRequired: true, nextCursor: '30' }),
      applyPage: () => undefined
    });
    expect(result.status).toBe('reset-required');
    expect(result.latestSeq).toBe(30);
  });

  it('does not turn a transient fetch failure into a reset decision', async () => {
    await expect(recoverPublicEventPages({
      afterSeq: 5,
      fetchPage: async () => { throw new Error('temporary outage'); },
      applyPage: () => undefined
    })).rejects.toThrow('temporary outage');
  });

  it('treats a fresh empty dataset as caught up without a snapshot loop', async () => {
    const result = await recoverPublicEventPages({
      afterSeq: 0,
      fetchPage: async () => ({ ...response(0, 0, []), resetRequired: true }),
      applyPage: () => undefined
    });
    expect(result.status).toBe('empty');
  });
});

function response(oldestSeq: number, latestSeq: number, events: PublicEvent[], nextCursor?: string): PublicEventsResponse {
  return { serverTime: 1, oldestSeq, latestSeq, resetRequired: false, events, nextCursor };
}

function event(seq: number): PublicEvent {
  return { seq, type: 'unknown', at: seq, data: {} };
}
