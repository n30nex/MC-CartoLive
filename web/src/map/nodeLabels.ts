import type { PublicNode } from '../types';

export const NODE_LABEL_UPDATE_MS = 2_000;
export const NODE_LABEL_MAX_CHARS = 18;
export const NODE_ACTIVITY_WINDOW_MS = 60_000;
export const NODE_ACTIVITY_GLOW_MS = 6_500;
export const NODE_ACTIVITY_UPDATE_MS = 250;
export const NODE_ACTIVITY_HOT_COUNT = 30;
export const NODE_STALE_GREY_MS = 30 * 60_000;
export const NODE_STALE_DARK_GREY_MS = 60 * 60_000;
export const NODE_FRESH_MS = 5 * 60_000;
export const NODE_MEDIUM_MS = 30 * 60_000;

export function nodeMapLabel(node: PublicNode, now: number, meshActivityAt?: number): string {
  return compactNodeLabel(node.label);
}

export function compactNodeLabel(label: string, maxChars = NODE_LABEL_MAX_CHARS): string {
  const trimmed = label.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 3) return trimmed.slice(0, maxChars);
  return `${trimmed.slice(0, maxChars - 3)}...`;
}

export function nodeLastHeardAgeLabel(lastSeen: number, now: number): string {
  if (!Number.isFinite(lastSeen) || lastSeen <= 0) return 'last unknown';
  const ageMs = Math.max(0, now - lastSeen);
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 5) return 'last now';
  if (seconds < 60) return `last ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `last ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `last ${hours}h`;
  const days = Math.floor(hours / 24);
  return `last ${days}d`;
}

export function nodeActivityHeat(hitCount: number): number {
  if (hitCount <= 0) return 0;
  return Math.min(1, Math.log1p(hitCount) / Math.log1p(NODE_ACTIVITY_HOT_COUNT));
}

export function nodeActivityGlow(ageMs: number): number {
  if (ageMs < 0) return 1;
  const progress = Math.max(0, Math.min(1, ageMs / NODE_ACTIVITY_GLOW_MS));
  return Math.pow(1 - progress, 0.72);
}

export function nodeLabelActivityProgress(ageMs: number, visibleWindowMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0 || visibleWindowMs <= 0) return 0;
  const remaining = Math.max(0, Math.min(1, 1 - ageMs / visibleWindowMs));
  return Math.pow(remaining, 0.68);
}

export function nodeEffectiveActivityAt(node: PublicNode, meshActivityAt?: number): number {
  return Number.isFinite(meshActivityAt) && meshActivityAt !== undefined ? meshActivityAt : node.lastSeen;
}

export function nodeStaleLevel(node: PublicNode, now: number, meshActivityAt?: number): 0 | 1 | 2 {
  const activityAt = nodeEffectiveActivityAt(node, meshActivityAt);
  if (!Number.isFinite(activityAt) || activityAt <= 0) return 2;
  const ageMs = Math.max(0, now - activityAt);
  if (ageMs >= NODE_STALE_DARK_GREY_MS) return 2;
  if (ageMs >= NODE_STALE_GREY_MS) return 1;
  return 0;
}

export function nodeFreshLevel(node: PublicNode, now: number, meshActivityAt?: number): 0 | 1 | 2 | 3 {
  const activityAt = nodeEffectiveActivityAt(node, meshActivityAt);
  if (!Number.isFinite(activityAt) || activityAt <= 0) return 3;
  const ageMs = Math.max(0, now - activityAt);
  if (ageMs < NODE_FRESH_MS) return 0;
  if (ageMs < NODE_MEDIUM_MS) return 1;
  return 2;
}
