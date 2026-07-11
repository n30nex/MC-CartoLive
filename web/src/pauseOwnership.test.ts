import { describe, expect, it } from 'vitest';
import { beginOwnedPause, markOwnedPauseUserOverride, pausedAfterOwnedPause } from './pauseOwnership';

describe('temporary pause ownership', () => {
  it('resumes a feed that a temporary operation paused', () => {
    const session = beginOwnedPause(false);
    expect(pausedAfterOwnedPause(session, true)).toBe(false);
  });

  it('preserves a feed that was already paused', () => {
    const session = beginOwnedPause(true);
    expect(pausedAfterOwnedPause(session, true)).toBe(true);
  });

  it('leaves the latest user pause choice alone', () => {
    const session = markOwnedPauseUserOverride(beginOwnedPause(false));
    expect(pausedAfterOwnedPause(session, false)).toBe(false);
    expect(pausedAfterOwnedPause(session, true)).toBe(true);
  });
});
