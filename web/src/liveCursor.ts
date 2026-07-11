import type { PublicLiveEnvelope } from './types';

export type LiveEnvelopeSequence =
  | { kind: 'durable'; seq: number }
  | { kind: 'fallback'; seq: 0 }
  | { kind: 'invalid'; seq: 0 };

export interface IncreasingLiveEnvelopeBatch {
  accepted: PublicLiveEnvelope[];
  cursor: number;
  invalid: boolean;
  nonMonotonic: boolean;
}

/**
 * Persisted public-event sequence numbers are monotonic SQLite cursors, not a
 * gap-free count. A missing/zero sequence identifies a best-effort live event
 * that was not durably stored and must not advance the recovery cursor.
 */
export function classifyLiveEnvelopeSequence(message: PublicLiveEnvelope): LiveEnvelopeSequence {
  const value = message.seq;
  if (value === undefined || value === 0) return { kind: 'fallback', seq: 0 };
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return { kind: 'durable', seq: value };
  }
  return { kind: 'invalid', seq: 0 };
}

export function takeIncreasingLiveEnvelopes(
  messages: PublicLiveEnvelope[],
  afterSeq: number
): IncreasingLiveEnvelopeBatch {
  const accepted: PublicLiveEnvelope[] = [];
  let cursor = Math.max(0, afterSeq);
  let invalid = false;
  let nonMonotonic = false;

  for (const message of messages) {
    const sequence = classifyLiveEnvelopeSequence(message);
    if (sequence.kind === 'invalid') {
      invalid = true;
      continue;
    }
    if (sequence.kind === 'fallback') {
      accepted.push(message);
      continue;
    }
    if (sequence.seq === cursor) continue;
    if (sequence.seq < cursor) {
      nonMonotonic = true;
      continue;
    }
    accepted.push(message);
    cursor = sequence.seq;
  }

  return { accepted, cursor, invalid, nonMonotonic };
}

export function retainLiveEnvelopesAfterCursor(messages: PublicLiveEnvelope[], cursor: number): PublicLiveEnvelope[] {
  return messages.filter((message) => {
    const sequence = classifyLiveEnvelopeSequence(message);
    return sequence.kind === 'fallback' || (sequence.kind === 'durable' && sequence.seq > cursor);
  });
}

export function shouldQueueDurableLiveSequence(seq: number, lastAppliedSeq: number, lastQueuedSeq: number): boolean {
  return Number.isSafeInteger(seq) && seq > Math.max(0, lastAppliedSeq, lastQueuedSeq);
}

/**
 * Rebase recovery onto the server's current cursor epoch. A recent inbound
 * cursor below the old applied cursor belongs to the new epoch and is retained;
 * an inbound cursor at/above the old cursor is stale when the server regressed.
 */
export function liveCursorResetTarget(serverLatestSeq: number, priorAppliedSeq: number, latestInboundSeq: number): number {
  const serverLatest = validSequence(serverLatestSeq);
  const priorApplied = validSequence(priorAppliedSeq);
  const latestInbound = validSequence(latestInboundSeq);
  if (serverLatest < priorApplied && latestInbound >= priorApplied) return serverLatest;
  return Math.max(serverLatest, latestInbound);
}

export function helloRequiresCursorResetProbe(helloSeq: number, lastAppliedSeq: number): boolean {
  const applied = validSequence(lastAppliedSeq);
  return applied > 0 && validSequence(helloSeq) < applied;
}

function validSequence(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
