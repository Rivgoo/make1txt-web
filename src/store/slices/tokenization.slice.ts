import type { StateCreator } from 'zustand';
import type { FileStore, TokenizationSlice } from '../store.types';
import type { TokenizerInput, TokenizerOutput } from '@/core/types/worker.types';
import { estimateTokenCount } from '@/core/utils/stats.utils';
import { MAX_AUTO_TOKENS } from '../constants';

export const createTokenizationSlice: StateCreator<FileStore, [], [], TokenizationSlice> = (set, get) => ({
  realTokenMap: {},
  optimizedBytesMap: {},
  isTokenizing: false,
  tokenizationProgress: 0,
  needsManualTokenization: false,
  tokenizerWorker: null,

  invalidateTokens: () => {
    set({ realTokenMap: {}, optimizedBytesMap: {}, needsManualTokenization: false });
  },

  pruneAndInvalidateTokens: (deletedNodeIds, dirtyNodeIds) => {
    if (deletedNodeIds.size === 0 && dirtyNodeIds.size === 0) return;
    set((state) => {
      const nextTokenMap = { ...state.realTokenMap };
      const nextOptBytesMap = { ...state.optimizedBytesMap };

      for (const id of deletedNodeIds) {
        delete nextTokenMap[id];
        delete nextOptBytesMap[id];
      }

      for (const id of dirtyNodeIds) {
        delete nextTokenMap[id];
        delete nextOptBytesMap[id];
      }

      return {
        realTokenMap: nextTokenMap,
        optimizedBytesMap: nextOptBytesMap,
      };
    });
  },

  evaluateTokenization: () => {
    const { nodes, isTokenizing, localFilters, optimizedBytesMap } = get();
    if (isTokenizing) return;

    let estimatedTokens = 0;
    for (const node of nodes) {
      if (!node.isDirectory && node.isSelected && !node.isIgnored) {
        const bytes = (localFilters?.isOptimizationEnabled && optimizedBytesMap[node.id]) 
          ? optimizedBytesMap[node.id] 
          : node.sizeBytes;
        estimatedTokens += estimateTokenCount(bytes);
      }
    }

    if (estimatedTokens >= MAX_AUTO_TOKENS) {
      set({ needsManualTokenization: true });
      get().runTokenization(false); // Force run for bytes only
    } else if (estimatedTokens > 0) {
      set({ needsManualTokenization: false });
      get().runTokenization(false);
    }
  },

  cancelTokenization: () => {
    const worker = get().tokenizerWorker;
    if (worker) {
      worker.terminate();
      set({ tokenizerWorker: null, isTokenizing: false, tokenizationProgress: 0 });
    }
  },

  runTokenization: (force: boolean) => {
    const { nodes, isTokenizing, realTokenMap, optimizedBytesMap, localFilters, needsManualTokenization } = get();
    if (isTokenizing) return;

    const skipTiktoken = !force && needsManualTokenization;

    const filesToTokenize = nodes
      .filter(n => !n.isDirectory && n.isSelected && !n.isIgnored && 
        (realTokenMap[n.id] === undefined || optimizedBytesMap[n.id] === undefined))
      .map(n => ({ 
        id: n.id, 
        handle: n.handle as FileSystemFileHandle | null,
        content: n.content,
        sizeBytes: n.sizeBytes
      }));

    if (filesToTokenize.length === 0) return;

    get().cancelTokenization();

    const worker = new Worker(new URL('@/core/workers/tokenizer.worker.ts', import.meta.url), { type: 'module' });
    
    set({ 
      isTokenizing: true, 
      tokenizationProgress: 0, 
      tokenizerWorker: worker,
      needsManualTokenization: skipTiktoken 
    });

    worker.onmessage = (e: MessageEvent<TokenizerOutput>) => {
      const data = e.data;
      if (data.type === 'progress') {
        set({ tokenizationProgress: data.progress });
      } else if (data.type === 'result') {
        const newTokens: Record<string, number> = {};
        const newBytes: Record<string, number> = {};
        
        for (const [id, res] of Object.entries(data.results)) {
          if (!res.skippedTiktoken) {
            newTokens[id] = res.tokens;
          }
          newBytes[id] = res.optimizedBytes;
        }

        set(state => ({
          realTokenMap: { ...state.realTokenMap, ...newTokens },
          optimizedBytesMap: { ...state.optimizedBytesMap, ...newBytes },
          isTokenizing: false,
          tokenizationProgress: 100,
          tokenizerWorker: null
        }));
        worker.terminate();
      } else if (data.type === 'error') {
        console.error('[Tokenizer Worker Error]', data.error);
        set({ isTokenizing: false, tokenizerWorker: null });
        worker.terminate();
      }
    };

    worker.postMessage({ 
      files: filesToTokenize,
      isOptimizationEnabled: localFilters?.isOptimizationEnabled ?? false,
      optimizationRules: localFilters?.optimizationRules ?? [],
      skipTiktoken
    } as TokenizerInput);
  }
});
