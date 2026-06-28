import type { NetGraphTransformRequest } from './netgraphTransforms';
import { transformNetGraph } from './netgraphTransforms';

type NetGraphWorkerScope = {
  addEventListener: typeof self.addEventListener;
  postMessage: (message: unknown) => void;
};

const workerScope = self as unknown as NetGraphWorkerScope;

workerScope.addEventListener('message', (event: MessageEvent<NetGraphTransformRequest>) => {
  try {
    workerScope.postMessage(transformNetGraph(event.data));
  } catch (error) {
    workerScope.postMessage({
      id: event.data?.id,
      error: error instanceof Error ? error.message : 'netgraph transform failed'
    });
  }
});
