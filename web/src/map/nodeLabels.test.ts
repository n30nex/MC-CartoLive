import { describe, expect, it } from 'vitest';
import {
  NODE_ACTIVITY_GLOW_MS,
  NODE_FRESH_MS,
  NODE_MEDIUM_MS,
  NODE_STALE_DARK_GREY_MS,
  NODE_STALE_GREY_MS,
  nodeActivityGlow,
  nodeActivityHeat,
  nodeFreshLevel,
  nodeLabelActivityProgress,
  compactNodeLabel,
  nodeEffectiveActivityAt,
  nodeLastHeardAgeLabel,
  nodeMapLabel,
  nodeStaleLevel
} from './nodeLabels';
import type { PublicNode } from '../types';

describe('map node labels', () => {
  it('keeps node labels compact enough for dense map placement', () => {
    expect(compactNodeLabel('Short name')).toBe('Short name');
    expect(compactNodeLabel('Very Long MeshCore Node Name')).toBe('Very Long MeshC...');
    expect(compactNodeLabel('ABCDE', 3)).toBe('ABC');
  });

  it('formats last-heard ages as short ticking labels', () => {
    const now = 1_700_000_000_000;
    expect(nodeLastHeardAgeLabel(now - 2_000, now)).toBe('last now');
    expect(nodeLastHeardAgeLabel(now - 42_000, now)).toBe('last 42s');
    expect(nodeLastHeardAgeLabel(now - 8 * 60_000, now)).toBe('last 8m');
    expect(nodeLastHeardAgeLabel(now - 3 * 60 * 60_000, now)).toBe('last 3h');
    expect(nodeLastHeardAgeLabel(now - 2 * 24 * 60 * 60_000, now)).toBe('last 2d');
    expect(nodeLastHeardAgeLabel(0, now)).toBe('last unknown');
  });

  it('builds a map label with only the node name', () => {
    const node = {
      id: 'n1',
      label: 'Downtown Repeater Alpha',
      role: 'repeater',
      latitude: 43.65,
      longitude: -79.38,
      firstSeen: 1,
      lastSeen: 1_700_000_000_000 - 19_000,
      iatasHeardIn: ['YYZ'],
      activityCount: 10
    } satisfies PublicNode;

    expect(nodeMapLabel(node, 1_700_000_000_000)).toBe('Downtown Repeat...');
    expect(nodeMapLabel(node, 1_700_000_000_000, 1_700_000_000_000 - 7_000)).toBe('Downtown Repeat...');
  });

  it('maps recent mesh activity to fading heat glow values', () => {
    expect(nodeActivityHeat(0)).toBe(0);
    expect(nodeActivityHeat(1)).toBeGreaterThan(0);
    expect(nodeActivityHeat(999)).toBe(1);
    expect(nodeActivityGlow(0)).toBe(1);
    expect(nodeActivityGlow(NODE_ACTIVITY_GLOW_MS / 2)).toBeGreaterThan(0.6);
    expect(nodeActivityGlow(NODE_ACTIVITY_GLOW_MS)).toBe(0);
    expect(nodeActivityGlow(NODE_ACTIVITY_GLOW_MS + 1)).toBe(0);
  });

  it('keeps active labels on a slow readable decay curve', () => {
    const windowMs = 90_000;

    expect(nodeLabelActivityProgress(0, windowMs)).toBe(1);
    expect(nodeLabelActivityProgress(windowMs / 2, windowMs)).toBeGreaterThan(0.6);
    expect(nodeLabelActivityProgress(windowMs, windowMs)).toBe(0);
    expect(nodeLabelActivityProgress(Number.POSITIVE_INFINITY, windowMs)).toBe(0);
  });

  it('classifies stale nodes from mesh activity with lastSeen fallback', () => {
    const now = 1_700_000_000_000;
    const node = {
      id: 'n1',
      label: 'Node',
      role: 'repeater',
      latitude: 43.65,
      longitude: -79.38,
      firstSeen: 1,
      lastSeen: now - NODE_STALE_GREY_MS - 1,
      iatasHeardIn: ['YYZ'],
      activityCount: 10
    } satisfies PublicNode;

    expect(nodeEffectiveActivityAt(node)).toBe(node.lastSeen);
    expect(nodeStaleLevel({ ...node, lastSeen: now - NODE_STALE_GREY_MS + 1 }, now)).toBe(0);
    expect(nodeStaleLevel(node, now)).toBe(1);
    expect(nodeStaleLevel({ ...node, lastSeen: now - NODE_STALE_DARK_GREY_MS }, now)).toBe(2);
    expect(nodeStaleLevel(node, now, now - 1000)).toBe(0);
  });

  it('classifies node freshness from mesh activity with lastSeen fallback', () => {
    const now = 1_700_000_000_000;
    const node = {
      id: 'n1',
      label: 'Node',
      role: 'repeater',
      latitude: 43.65,
      longitude: -79.38,
      firstSeen: 1,
      lastSeen: now - NODE_MEDIUM_MS - 1,
      iatasHeardIn: ['YYZ'],
      activityCount: 10
    } satisfies PublicNode;

    expect(nodeFreshLevel({ ...node, lastSeen: now - (NODE_FRESH_MS - 1000) }, now)).toBe(0);
    expect(nodeFreshLevel({ ...node, lastSeen: now - NODE_FRESH_MS }, now)).toBe(1);
    expect(nodeFreshLevel({ ...node, lastSeen: now - NODE_MEDIUM_MS }, now)).toBe(2);
    expect(nodeFreshLevel({ ...node, lastSeen: 0 }, now)).toBe(3);
    expect(nodeFreshLevel(node, now, now - 1000)).toBe(0);
  });
});
