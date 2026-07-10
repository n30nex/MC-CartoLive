import type { PublicBootstrapResponse, PublicLiveState } from './types';

export function bootstrapToLiveState(bootstrap: PublicBootstrapResponse): PublicLiveState {
  return {
    serverTime: bootstrap.serverTime,
    map: bootstrap.map,
    stats: { ...bootstrap.stats, latestSeq: bootstrap.latestSeq },
    nodes: [],
    routes: [],
    recentPulses: [],
    recentActivity: bootstrap.recentActivity
  };
}

export function publicStateSnapshotIsCurrent(currentSeq: number, snapshot: PublicLiveState): boolean {
  return (snapshot.stats?.latestSeq ?? 0) >= Math.max(0, currentSeq);
}

interface BootstrapFirstOptions<TBootstrap, TState> {
  fetchBootstrap: () => Promise<TBootstrap>;
  fetchState: () => Promise<TState>;
  applyBootstrap: (value: TBootstrap) => void;
  applyState: (value: TState) => void;
  deferState: (task: () => Promise<void>) => void;
  onDeferredStateError?: (error: unknown) => void;
}

export async function startBootstrapFirstHydration<TBootstrap, TState>(options: BootstrapFirstOptions<TBootstrap, TState>): Promise<'bootstrap' | 'state-fallback'> {
  try {
    const bootstrap = await options.fetchBootstrap();
    options.applyBootstrap(bootstrap);
    options.deferState(async () => {
      try {
        options.applyState(await options.fetchState());
      } catch (error) {
        options.onDeferredStateError?.(error);
      }
    });
    return 'bootstrap';
  } catch {
    options.applyState(await options.fetchState());
    return 'state-fallback';
  }
}
