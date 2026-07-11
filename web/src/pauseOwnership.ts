export interface OwnedPauseSession {
  restorePaused: boolean;
  userOverrodePause: boolean;
}

export function beginOwnedPause(paused: boolean): OwnedPauseSession {
  return { restorePaused: paused, userOverrodePause: false };
}

export function markOwnedPauseUserOverride(session: OwnedPauseSession | null): OwnedPauseSession | null {
  return session ? { ...session, userOverrodePause: true } : null;
}

export function pausedAfterOwnedPause(session: OwnedPauseSession | null, currentPaused: boolean): boolean {
  if (!session || session.userOverrodePause) return currentPaused;
  return session.restorePaused;
}
