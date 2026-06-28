import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserNetGraphClient, createMainThreadNetGraphClient } from './netgraphWorkerClient';
import type { PreparedNetGraph } from '../netgraphPrepared';

describe('netgraph worker client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses main-thread fallback when Worker creation fails', async () => {
    vi.stubGlobal('Worker', class {} as unknown as typeof Worker);
    const client = createBrowserNetGraphClient((request) => ({ id: request.id, graph: dummyGraph('fallback') }), () => {
      throw new Error('worker unavailable');
    });

    await expect(client.prepare(dummyPayload())).resolves.toMatchObject({
      workerUsed: false,
      graph: { topologySignature: 'fallback' }
    });
  });

  it('ignores stale browser worker responses', async () => {
    const worker = new MockWorker();
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
    const client = createBrowserNetGraphClient((request) => ({ id: request.id, graph: dummyGraph('unused') }), () => worker as unknown as Worker);

    const first = client.prepare({ ...dummyPayload(), width: 1 });
    const second = client.prepare({ ...dummyPayload(), width: 2 });
    worker.flushReverse();

    await expect(second).resolves.toMatchObject({ workerUsed: true, graph: { topologySignature: 'response-2' } });
    await expect(first).rejects.toThrow(/stale netgraph worker response/);
  });

  it('rejects disposed main-thread clients', async () => {
    const client = createMainThreadNetGraphClient((request) => ({ id: request.id, graph: dummyGraph('main') }));
    client.dispose();
    await expect(client.prepare(dummyPayload())).rejects.toThrow(/disposed/);
  });
});

class MockWorker {
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  private messages: Array<{ id: string; width: number }> = [];

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message: { id: string; payload: { width: number } }) {
    this.messages.push({ id: message.id, width: message.payload.width });
  }

  terminate() {
    this.messages = [];
  }

  flushReverse() {
    for (const message of this.messages.slice().reverse()) {
      for (const listener of this.listeners.get('message') ?? []) {
        listener({ data: { id: message.id, graph: dummyGraph(`response-${message.width}`) } } as MessageEvent);
      }
    }
  }
}

function dummyPayload() {
  return {
    nodes: [],
    routes: [],
    width: 100,
    height: 100,
    maxNodes: 2600,
    maxEdges: 4200
  };
}

function dummyGraph(topologySignature: string): PreparedNetGraph {
  return {
    nodes: [],
    edges: [],
    nodeIndexByID: {},
    edgeIndexByID: {},
    nodeSpatialIndex: { cellSize: 128, buckets: {} },
    edgeSpatialIndex: { cellSize: 128, buckets: {} },
    topologySignature,
    totalNodes: 0,
    totalEdges: 0,
    visibleNodes: 0,
    visibleEdges: 0,
    prepMs: 0,
    layoutMs: 0,
    layoutTicks: 0,
    layoutReused: false
  };
}
