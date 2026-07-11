export interface ReplayPauseSession {
  restorePaused: boolean;
  userOverrodePause: boolean;
}

export function beginReplayPauseSession(paused: boolean): ReplayPauseSession {
  return { restorePaused: paused, userOverrodePause: false };
}

export function markReplayPauseUserOverride(session: ReplayPauseSession | null): ReplayPauseSession | null {
  return session ? { ...session, userOverrodePause: true } : null;
}

export function pausedAfterReplayExit(session: ReplayPauseSession | null, currentPaused: boolean): boolean {
  if (!session || session.userOverrodePause) return currentPaused;
  return session.restorePaused;
}
