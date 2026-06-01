export interface FollowTrafficState {
  lastAt: number;
  lastID: string;
}

export interface FollowTrafficDecisionInput {
  id: string;
  now: number;
  immediate: boolean;
  mapMoving: boolean;
}

export interface FollowTrafficDecision {
  shouldMove: boolean;
  durationMs: number;
  reason: 'immediate' | 'accepted' | 'duplicate' | 'throttled' | 'camera_busy';
}

export const FOLLOW_TRAFFIC_MIN_INTERVAL_MS = 16_000;
export const FOLLOW_TRAFFIC_DURATION_MS = 9_500;
export const FOLLOW_TRAFFIC_IMMEDIATE_DURATION_MS = 4_200;
export const FOLLOW_TRAFFIC_MOVING_GRACE_MS = 2_000;
export const FOLLOW_TRAFFIC_ROUTE_MAX_ZOOM = 7.1;
export const FOLLOW_TRAFFIC_POINT_ZOOM = 6.3;

export function followTrafficDecision(state: FollowTrafficState, input: FollowTrafficDecisionInput): FollowTrafficDecision {
  if (!input.immediate && state.lastID === input.id) {
    return { shouldMove: false, durationMs: FOLLOW_TRAFFIC_DURATION_MS, reason: 'duplicate' };
  }
  const age = input.now - state.lastAt;
  if (!input.immediate && input.mapMoving && age < FOLLOW_TRAFFIC_DURATION_MS + FOLLOW_TRAFFIC_MOVING_GRACE_MS) {
    return { shouldMove: false, durationMs: FOLLOW_TRAFFIC_DURATION_MS, reason: 'camera_busy' };
  }
  if (!input.immediate && age < FOLLOW_TRAFFIC_MIN_INTERVAL_MS) {
    return { shouldMove: false, durationMs: FOLLOW_TRAFFIC_DURATION_MS, reason: 'throttled' };
  }
  return {
    shouldMove: true,
    durationMs: input.immediate ? FOLLOW_TRAFFIC_IMMEDIATE_DURATION_MS : FOLLOW_TRAFFIC_DURATION_MS,
    reason: input.immediate ? 'immediate' : 'accepted'
  };
}
