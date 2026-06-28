import type { NetGraphPrepareInput, PreparedNetGraph } from '../netgraphPrepared';
import type { NetGraphTransformRequest, NetGraphTransformResponse } from './netgraphTransforms';

export interface NetGraphWorkerResponse {
  graph: PreparedNetGraph;
  workerUsed: boolean;
}

export type NetGraphTransformHandler = (request: NetGraphTransformRequest) => NetGraphTransformResponse;

export interface NetGraphWorkerClient {
  prepare: (payload: NetGraphPrepareInput) => Promise<NetGraphWorkerResponse>;
  dispose: () => void;
}

export function createMainThreadNetGraphClient(handler: NetGraphTransformHandler): NetGraphWorkerClient {
  let nextID = 0;
  let disposed = false;
  let latestID = '';
  return {
    prepare: async (payload) => {
      if (disposed) throw new Error('netgraph worker client disposed');
      const id = `netgraph-${++nextID}`;
      latestID = id;
      const response = handler({ id, type: 'prepare', payload });
      if (response.id !== latestID) throw new Error('stale netgraph worker response');
      return { graph: response.graph, workerUsed: false };
    },
    dispose: () => {
      disposed = true;
    }
  };
}

export function createBrowserNetGraphClient(
  handler: NetGraphTransformHandler,
  createWorker: () => Worker = () => new Worker(new URL('./netgraph.worker.ts', import.meta.url), { type: 'module' })
): NetGraphWorkerClient {
  if (typeof Worker === 'undefined') {
    return createMainThreadNetGraphClient(handler);
  }

  let worker: Worker | null = null;
  try {
    worker = createWorker();
  } catch {
    return createMainThreadNetGraphClient(handler);
  }

  let nextID = 0;
  let disposed = false;
  let latestID = '';
  const pending = new Map<string, {
    resolve: (response: NetGraphWorkerResponse) => void;
    reject: (error: Error) => void;
  }>();

  const rejectAll = (error: Error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  worker.addEventListener('message', (event: MessageEvent<NetGraphTransformResponse | { id?: string; error?: string }>) => {
    const data = event.data;
    const id = typeof data?.id === 'string' ? data.id : '';
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if ('error' in data && data.error) {
      request.reject(new Error(data.error));
      return;
    }
    if (id !== latestID) {
      request.reject(new Error('stale netgraph worker response'));
      return;
    }
    request.resolve({ graph: (data as NetGraphTransformResponse).graph, workerUsed: true });
  });
  worker.addEventListener('error', (event) => {
    rejectAll(new Error(event.message || 'netgraph worker error'));
  });
  worker.addEventListener('messageerror', () => {
    rejectAll(new Error('netgraph worker message error'));
  });

  return {
    prepare: (payload) => {
      if (disposed || worker === null) return Promise.reject(new Error('netgraph worker client disposed'));
      const id = `netgraph-${++nextID}`;
      latestID = id;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker?.postMessage({ id, type: 'prepare', payload });
      });
    },
    dispose: () => {
      disposed = true;
      rejectAll(new Error('netgraph worker client disposed'));
      worker?.terminate();
      worker = null;
    }
  };
}
