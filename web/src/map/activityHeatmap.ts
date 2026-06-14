import type { PublicNode } from '../types';
import { isMappableNode } from './geo';
import { NODE_ACTIVITY_HOT_COUNT, NODE_ACTIVITY_WINDOW_MS, nodeActivityGlow, nodeActivityHeat } from './nodeLabels';
import type { FeatureCollection } from './sourceDataQueue';

export interface ActivityHeatEntry {
  hits: number[];
  lastAt: number;
}

export const ACTIVITY_HEATMAP_WINDOW_MS = 15 * 60_000;
export const ACTIVITY_HEATMAP_MAX_FEATURES = 420;

export function activityHeatmapToGeoJSON(
  nodes: PublicNode[],
  activities: Map<string, ActivityHeatEntry>,
  meshActivityAtByNodeID: Map<string, number>,
  epochNow = Date.now(),
  performanceNow = performance.now(),
  maxFeatures = ACTIVITY_HEATMAP_MAX_FEATURES
): FeatureCollection {
  const candidateNodes = activeHeatmapNodes(nodes, activities, meshActivityAtByNodeID, epochNow);
  const features = candidateNodes
    .filter(isMappableNode)
    .map((node) => activityHeatFeature(node, activities.get(node.id), meshActivityAtByNodeID.get(node.id), epochNow, performanceNow))
    .filter((feature): feature is NonNullable<typeof feature> => feature !== null)
    .sort((a, b) => Number(b.properties.intensity) - Number(a.properties.intensity))
    .slice(0, Math.max(0, maxFeatures));

  return { type: 'FeatureCollection', features };
}

export function activeHeatmapNodes(
  nodes: PublicNode[],
  activities: Map<string, ActivityHeatEntry>,
  meshActivityAtByNodeID: Map<string, number>,
  epochNow = Date.now()
): PublicNode[] {
  if (nodes.length === 0) return nodes;
  if (activities.size === 0 && meshActivityAtByNodeID.size === 0) {
    return nodes.filter((node) => epochNow - node.lastSeen <= ACTIVITY_HEATMAP_WINDOW_MS);
  }
  const activeIDs = new Set<string>();
  for (const [id, activity] of activities.entries()) {
    if (activity.hits.length > 0 || activity.lastAt > 0) activeIDs.add(id);
  }
  for (const [id, at] of meshActivityAtByNodeID.entries()) {
    if (Number.isFinite(at) && epochNow - at <= ACTIVITY_HEATMAP_WINDOW_MS) activeIDs.add(id);
  }
  return nodes.filter((node) => activeIDs.has(node.id) || epochNow - node.lastSeen <= ACTIVITY_HEATMAP_WINDOW_MS);
}

function activityHeatFeature(
  node: PublicNode,
  activity: ActivityHeatEntry | undefined,
  meshActivityAt: number | undefined,
  epochNow: number,
  performanceNow: number
) {
  const heat = activityHeatIntensity(node, activity, meshActivityAt, epochNow, performanceNow);
  if (heat.intensity <= 0.035) return null;
  return {
    type: 'Feature',
    id: node.id,
    properties: {
      id: node.id,
      label: node.label,
      intensity: heat.intensity,
      spark: heat.spark,
      color: activityHeatColor(node.role, node.isObserver === true)
    },
    geometry: {
      type: 'Point',
      coordinates: [node.longitude, node.latitude]
    }
  };
}

export function activityHeatIntensity(
  node: Pick<PublicNode, 'lastSeen' | 'activityCount'>,
  activity: ActivityHeatEntry | undefined,
  meshActivityAt: number | undefined,
  epochNow = Date.now(),
  performanceNow = performance.now()
): { intensity: number; spark: number } {
  const recentHits = (activity?.hits ?? []).filter((hitAt) => performanceNow - hitAt <= NODE_ACTIVITY_WINDOW_MS);
  const hitHeat = nodeActivityHeat(recentHits.length);
  const hitSpark = activity ? nodeActivityGlow(performanceNow - activity.lastAt) : 0;
  const activityAt = Number.isFinite(meshActivityAt) ? Number(meshActivityAt) : node.lastSeen;
  const ageMs = Number.isFinite(activityAt) && activityAt > 0 ? Math.max(0, epochNow - activityAt) : Number.POSITIVE_INFINITY;
  const recency = ageMs <= ACTIVITY_HEATMAP_WINDOW_MS ? Math.pow(1 - ageMs / ACTIVITY_HEATMAP_WINDOW_MS, 0.72) : 0;
  const lifetimeWeight = Math.min(1, Math.log1p(Math.max(0, node.activityCount)) / Math.log1p(1200));
  const recencyHeat = recency * (0.12 + lifetimeWeight * 0.42);
  const burstHeat = hitHeat * (0.35 + Math.min(1, recentHits.length / NODE_ACTIVITY_HOT_COUNT) * 0.35);
  const intensity = Math.max(recencyHeat, burstHeat);
  return {
    intensity: clamp01(intensity),
    spark: clamp01(Math.max(hitSpark, hitHeat * 0.45))
  };
}

function activityHeatColor(role: string, observer: boolean): string {
  if (observer) return '#f59e0b';
  if (role === 'companion') return '#60a5fa';
  if (role === 'room_server') return '#a78bfa';
  if (role === 'sensor') return '#a3e635';
  return '#34d399';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
