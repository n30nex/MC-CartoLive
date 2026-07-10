import type { PublicEvent, PublicEventsResponse } from './types';

export type PublicEventRecoveryStatus = 'caught-up' | 'empty' | 'reset-required' | 'unrecoverable-gap' | 'cancelled';

export interface PublicEventRecoveryResult {
  status: PublicEventRecoveryStatus;
  cursor: number;
  latestSeq: number;
  pages: number;
}

export interface RecoverPublicEventPagesOptions {
  afterSeq: number;
  targetSeq?: number;
  limit?: number;
  fetchPage: (afterSeq: number, limit: number) => Promise<PublicEventsResponse>;
  applyPage: (events: PublicEvent[]) => void;
  isActive?: () => boolean;
}

// Recover the retained event stream without replacing the full public state.
// Every page must advance the numeric sequence cursor; reset/gap outcomes are
// returned to the caller because only those justify a snapshot rehydrate.
export async function recoverPublicEventPages({
  afterSeq,
  targetSeq,
  limit = 1000,
  fetchPage,
  applyPage,
  isActive = () => true
}: RecoverPublicEventPagesOptions): Promise<PublicEventRecoveryResult> {
  let cursor = Math.max(0, Math.floor(afterSeq));
  let latestSeq = Math.max(cursor, finiteSequence(targetSeq));
  let pages = 0;

  if (targetSeq !== undefined && latestSeq <= cursor) {
    return { status: cursor === 0 ? 'empty' : 'caught-up', cursor, latestSeq, pages };
  }

  while (isActive()) {
    const response = await fetchPage(cursor, limit);
    pages += 1;
    latestSeq = Math.max(latestSeq, finiteSequence(response.latestSeq));

    if (response.resetRequired) {
      return {
        status: latestSeq === 0 ? 'empty' : 'reset-required',
        cursor,
        latestSeq,
        pages
      };
    }

    const events = [...response.events]
      .filter((event) => finiteSequence(event.seq) > cursor)
      .sort((left, right) => left.seq - right.seq);
    if (events.length === 0) {
      return {
        status: cursor >= latestSeq ? (cursor === 0 ? 'empty' : 'caught-up') : 'unrecoverable-gap',
        cursor,
        latestSeq,
        pages
      };
    }

    applyPage(events);
    const eventCursor = finiteSequence(events[events.length - 1]?.seq);
    const responseCursor = finiteSequence(response.nextCursor);
    const nextCursor = Math.max(eventCursor, responseCursor);
    if (nextCursor <= cursor) {
      return { status: 'unrecoverable-gap', cursor, latestSeq, pages };
    }
    cursor = nextCursor;
    if (cursor >= latestSeq) {
      return { status: 'caught-up', cursor, latestSeq, pages };
    }
  }

  return { status: 'cancelled', cursor, latestSeq, pages };
}

function finiteSequence(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}
