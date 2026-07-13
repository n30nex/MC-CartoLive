import type { PublicLiveEnvelope } from './types';

export const LIVE_ENVELOPE_MAX_BATCH_SIZE = 256;
export const LIVE_ENVELOPE_MAX_PENDING = 4_096;

export interface DueLiveEnvelopes {
  due: PublicLiveEnvelope[];
  pending: PublicLiveEnvelope[];
}

export function liveEnvelopeDisplayAt(message: PublicLiveEnvelope): number {
  // `displayAt` is advisory metadata. Semantic state and the durable cursor
  // must never wait for cinematic server timing.
  return message.receivedAt ?? message.serverTime ?? message.displayAt ?? 0;
}

export function sortLiveEnvelopes(messages: PublicLiveEnvelope[]): PublicLiveEnvelope[] {
  return messages.slice().sort(compareLiveEnvelopes);
}

export function capLiveEnvelopeQueue(messages: PublicLiveEnvelope[], limit = LIVE_ENVELOPE_MAX_PENDING): PublicLiveEnvelope[] {
  if (messages.length <= limit) return messages;
  return sortLiveEnvelopes(messages).slice(-Math.max(0, limit));
}

export function takeDueLiveEnvelopes(
  messages: PublicLiveEnvelope[],
  _now: number,
  _batchWindowMs = 0,
  maxBatchSize = LIVE_ENVELOPE_MAX_BATCH_SIZE
): DueLiveEnvelopes {
  const ordered = sortLiveEnvelopes(messages);
  const take = Math.max(1, Math.floor(maxBatchSize));
  return { due: ordered.slice(0, take), pending: ordered.slice(take) };
}

export function nextLiveEnvelopeDelayMs(messages: PublicLiveEnvelope[], _now: number): number | null {
  if (messages.length === 0) return null;
  return 0;
}

function compareLiveEnvelopes(a: PublicLiveEnvelope, b: PublicLiveEnvelope): number {
  const aSeq = durableSequence(a.seq);
  const bSeq = durableSequence(b.seq);
  if (aSeq > 0 && bSeq > 0) return aSeq - bSeq;
  return liveEnvelopeDisplayAt(a) - liveEnvelopeDisplayAt(b) || aSeq - bSeq;
}

function durableSequence(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}
