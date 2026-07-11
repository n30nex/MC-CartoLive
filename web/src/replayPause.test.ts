import { describe, expect, it } from 'vitest';
import { beginReplayPauseSession, markReplayPauseUserOverride, pausedAfterReplayExit } from './replayPause';

describe('Replay Studio pause ownership', () => {
  it('resumes a feed that Replay Studio paused', () => {
    const session = beginReplayPauseSession(false);
    expect(pausedAfterReplayExit(session, true)).toBe(false);
  });

  it('preserves a feed that was already paused before Replay Studio opened', () => {
    const session = beginReplayPauseSession(true);
    expect(pausedAfterReplayExit(session, true)).toBe(true);
  });

  it('leaves the latest user pause choice alone on every Replay Studio exit', () => {
    const session = markReplayPauseUserOverride(beginReplayPauseSession(false));
    expect(pausedAfterReplayExit(session, false)).toBe(false);
    expect(pausedAfterReplayExit(session, true)).toBe(true);
  });
});
