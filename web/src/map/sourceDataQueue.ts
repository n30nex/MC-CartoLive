import type maplibregl from 'maplibre-gl';
import { recordSkippedSourceUpdate, recordSourceUpdate } from '../perfDiagnostics';

export type FeatureCollection = {
  type: 'FeatureCollection';
  features: Array<Record<string, unknown>>;
};

interface SourceUpdateQueue {
  frame: number;
  pending: Map<string, FeatureCollection>;
  signatures: Map<string, string>;
}

const sourceUpdateQueues = new WeakMap<maplibregl.Map, SourceUpdateQueue>();

export function setSourceData(map: maplibregl.Map, sourceID: string, data: FeatureCollection) {
  let queue = sourceUpdateQueues.get(map);
  if (!queue) {
    queue = { frame: 0, pending: new Map(), signatures: new Map() };
    sourceUpdateQueues.set(map, queue);
  }
  const signature = featureCollectionSignature(data);
  if (queue.signatures.get(sourceID) === signature) {
    recordSkippedSourceUpdate();
    return;
  }
  queue.signatures.set(sourceID, signature);
  queue.pending.set(sourceID, data);
  if (queue.frame !== 0) return;
  queue.frame = window.requestAnimationFrame(() => {
    queue.frame = 0;
    const pending = [...queue.pending.entries()];
    queue.pending.clear();
    for (const [queuedSourceID, queuedData] of pending) {
      if (!applySourceData(map, queuedSourceID, queuedData)) {
        queue.signatures.delete(queuedSourceID);
      }
    }
  });
}

function featureCollectionSignature(data: FeatureCollection): string {
  const serialized = JSON.stringify(data);
  let hash = 5381;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = ((hash << 5) + hash) ^ serialized.charCodeAt(index);
  }
  return `${data.features.length}:${hash >>> 0}`;
}

function applySourceData(map: maplibregl.Map, sourceID: string, data: FeatureCollection): boolean {
  const source = map.getSource(sourceID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return false;
  source.setData(data as any);
  recordSourceUpdate(sourceID);
  return true;
}
