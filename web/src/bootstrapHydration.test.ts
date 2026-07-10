import { describe, expect, it, vi } from 'vitest';
import { bootstrapToLiveState, publicStateSnapshotIsCurrent, startBootstrapFirstHydration } from './bootstrapHydration';
import type { PublicBootstrapResponse, PublicLiveState } from './types';

const state = { serverTime: 2, stats: { packets: 2 }, nodes: [{ id: 'node' }], routes: [], recentActivity: [] } as unknown as PublicLiveState;
const bootstrap = {
  serverTime: 1,
  latestSeq: 9,
  stats: { packets: 1, activeNodes: 3, activeRoutes: 2, mqttConnected: true, mqttMessages: 4, wsClients: 1, serverTime: 1 },
  health: { datasetState: 'warming' },
  clusters: [],
  recentActivity: []
} as PublicBootstrapResponse;

describe('bootstrap-first hydration', () => {
  it('applies compact bootstrap before scheduling compatibility state', async () => {
    const order: string[] = [];
    const deferred: (() => Promise<void>)[] = [];
    const result = await startBootstrapFirstHydration({
      fetchBootstrap: async () => { order.push('fetch-bootstrap'); return bootstrap; },
      fetchState: async () => { order.push('fetch-state'); return state; },
      applyBootstrap: () => order.push('apply-bootstrap'),
      applyState: () => order.push('apply-state'),
      deferState: (task) => { order.push('defer-state'); deferred.push(task); }
    });
    expect(result).toBe('bootstrap');
    expect(order).toEqual(['fetch-bootstrap', 'apply-bootstrap', 'defer-state']);
    await deferred[0]();
    expect(order).toEqual(['fetch-bootstrap', 'apply-bootstrap', 'defer-state', 'fetch-state', 'apply-state']);
  });

  it('falls back directly to full state when bootstrap is unavailable', async () => {
    const applyBootstrap = vi.fn();
    const applyState = vi.fn();
    const deferState = vi.fn();
    await expect(startBootstrapFirstHydration({
      fetchBootstrap: async () => { throw new Error('404'); },
      fetchState: async () => state,
      applyBootstrap,
      applyState,
      deferState
    })).resolves.toBe('state-fallback');
    expect(applyBootstrap).not.toHaveBeenCalled();
    expect(deferState).not.toHaveBeenCalled();
    expect(applyState).toHaveBeenCalledWith(state);
  });

  it('turns bootstrap into an immediate stats/activity-only live state', () => {
    expect(bootstrapToLiveState(bootstrap)).toMatchObject({ serverTime: 1, stats: { packets: 1, latestSeq: 9 }, nodes: [], routes: [], recentActivity: [] });
  });

  it('rejects deferred snapshots older than bootstrap or websocket state', () => {
    expect(publicStateSnapshotIsCurrent(13, { ...state, stats: { ...state.stats, latestSeq: 12 } })).toBe(false);
    expect(publicStateSnapshotIsCurrent(12, { ...state, stats: { ...state.stats, latestSeq: 12 } })).toBe(true);
    expect(publicStateSnapshotIsCurrent(12, { ...state, stats: { ...state.stats, latestSeq: 14 } })).toBe(true);
  });
});
