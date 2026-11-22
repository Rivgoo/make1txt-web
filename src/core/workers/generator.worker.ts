import type { WorkerInput, WorkerOutput } from '../types/worker.types';
import { runBundleGeneration } from '../services/BundleGeneratorEngine';

self.onmessage = async (e: MessageEvent<WorkerInput>) => {
  try {
    const { blob, metaMap } = await runBundleGeneration({
      ...e.data,
      onProgress: (progress) => {
        self.postMessage({ type: 'progress', progress } as WorkerOutput);
      },
    });
    self.postMessage({ type: 'done', blob, metaMap } as WorkerOutput);
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : 'Failed to assemble final file.',
    } as WorkerOutput);
  }
};
