import type { StateCreator } from 'zustand';
import type { FileStore, TokenizationSlice } from '../store.types';
import type {
  BaseFileMetrics,
  OptimizedFileMetrics,
  TokenizerFileItem,
  TokenizerInput,
  TokenizerOutput,
} from '@/core/types/worker.types';
import { estimateTokenCount } from '@/core/utils/stats.utils';
import { MAX_AUTO_TOKENS } from '../constants';

export const createTokenizationSlice: StateCreator<FileStore, [], [], TokenizationSlice> = (set, get) => ({
  baseMetricsMap: {},
  optimizedMetricsMap: {},
  appliedOptimizationHash: 'none',
  isTokenizing: false,
  tokenizationProgress: 0,
  needsManualTokenization: false,
  tokenizerWorker: null,
  tokenizationRunId: 0,
  pendingReevaluate: false,

  invalidateOptimizedMetrics: () => {
    set({ optimizedMetricsMap: {} });
  },

  invalidateAllMetrics: () => {
    set({
      baseMetricsMap: {},
      optimizedMetricsMap: {},
      needsManualTokenization: false,
    });
  },

  pruneAndInvalidateTokens: (deletedNodeIds, dirtyNodeIds) => {
    if (deletedNodeIds.size === 0 && dirtyNodeIds.size === 0) return;
    set((state) => {
      const nextBase = { ...state.baseMetricsMap };
      const nextOpt = { ...state.optimizedMetricsMap };

      for (const id of deletedNodeIds) {
        delete nextBase[id];
        delete nextOpt[id];
      }

      for (const id of dirtyNodeIds) {
        delete nextBase[id];
        delete nextOpt[id];
      }

      return {
        baseMetricsMap: nextBase,
        optimizedMetricsMap: nextOpt,
      };
    });
  },

  evaluateTokenization: () => {
    const {
      nodes,
      isTokenizing,
      localFilters,
      baseMetricsMap,
      optimizedMetricsMap,
      appliedOptimizationHash,
    } = get();

    if (isTokenizing) {
      set({ pendingReevaluate: true });
      return;
    }

    const optActive =
      localFilters?.isOptimizationEnabled && appliedOptimizationHash !== 'none';

    let estimatedTokens = 0;
    for (const node of nodes) {
      if (
        !node.isDirectory &&
        node.isSelected &&
        !node.isIgnored &&
        node.outputMode === 'full'
      ) {
        const optEntry = optimizedMetricsMap[node.id];
        const hasValidOpt =
          optActive &&
          optEntry !== undefined &&
          optEntry.configHash === appliedOptimizationHash;
        const bytes = hasValidOpt
          ? optEntry.bytes
          : (baseMetricsMap[node.id]?.bytes ?? node.sizeBytes);
        estimatedTokens += estimateTokenCount(bytes);
      }
    }

    if (estimatedTokens >= MAX_AUTO_TOKENS) {
      set({ needsManualTokenization: true });
      get().runTokenization(false);
    } else if (estimatedTokens > 0) {
      set({ needsManualTokenization: false });
      get().runTokenization(false);
    }
  },

  cancelTokenization: () => {
    const worker = get().tokenizerWorker;
    if (worker) {
      worker.terminate();
    }
    set((state) => ({
      tokenizerWorker: null,
      isTokenizing: false,
      tokenizationProgress: 0,
      pendingReevaluate: false,
      tokenizationRunId: state.tokenizationRunId + 1,
    }));
  },

  runTokenization: (forceExact: boolean, preempt = false) => {
    const {
      nodes,
      isTokenizing,
      baseMetricsMap,
      optimizedMetricsMap,
      appliedOptimizationHash,
      localFilters,
      needsManualTokenization,
    } = get();

    const activeConfigHash = appliedOptimizationHash;
    const optActive =
      (localFilters?.isOptimizationEnabled ?? false) &&
      activeConfigHash !== 'none';
    const skipTiktoken = !forceExact && needsManualTokenization;

    const filesToTokenize: TokenizerFileItem[] = [];

    for (const n of nodes) {
      // Structure-only files do NOT emit body content -> skip expensive tokenization
      if (
        n.isDirectory ||
        !n.isSelected ||
        n.isIgnored ||
        n.outputMode === 'structure-only'
      ) {
        continue;
      }

      const baseEntry = baseMetricsMap[n.id];
      const optEntry = optimizedMetricsMap[n.id];
      const hasValidOptEntry =
        optEntry !== undefined && optEntry.configHash === activeConfigHash;

      const needsBaseBytes = baseEntry === undefined;
      const needsBaseTokens =
        !skipTiktoken &&
        (baseEntry === undefined || baseEntry.exactTokens === null);
      const needsOptBytes = optActive && !hasValidOptEntry;
      const needsOptTokens =
        optActive &&
        !skipTiktoken &&
        (!hasValidOptEntry || optEntry.exactTokens === null);

      if (
        needsBaseBytes ||
        needsBaseTokens ||
        needsOptBytes ||
        needsOptTokens
      ) {
        filesToTokenize.push({
          id: n.id,
          handle: n.handle as FileSystemFileHandle | null,
          content: n.content,
          sizeBytes: n.sizeBytes,
          needsBaseBytes,
          needsBaseTokens,
          needsOptBytes,
          needsOptTokens,
        });
      }
    }

    if (filesToTokenize.length === 0) return;

    if (isTokenizing) {
      if (!preempt) {
        set({ pendingReevaluate: true });
        return;
      }
      const oldWorker = get().tokenizerWorker;
      if (oldWorker) {
        oldWorker.terminate();
      }
      set({ tokenizerWorker: null, isTokenizing: false, pendingReevaluate: false });
    }

    const runId = get().tokenizationRunId + 1;
    let worker = get().tokenizerWorker;
    if (!worker) {
      worker = new Worker(
        new URL('@/core/workers/tokenizer.worker.ts', import.meta.url),
        { type: 'module' }
      );
    }

    set({
      isTokenizing: true,
      tokenizationProgress: 0,
      tokenizerWorker: worker,
      tokenizationRunId: runId,
      needsManualTokenization: skipTiktoken,
      pendingReevaluate: false,
    });

    worker.onmessage = (e: MessageEvent<TokenizerOutput>) => {
      const data = e.data;
      if (data.runId !== get().tokenizationRunId) return;

      if (data.type === 'chunk') {
        set((state) => {
          const nextBase: Record<string, BaseFileMetrics> = {
            ...state.baseMetricsMap,
          };
          const nextOpt: Record<string, OptimizedFileMetrics> = {
            ...state.optimizedMetricsMap,
          };

          for (const [id, res] of Object.entries(data.results)) {
            const existingBase = nextBase[id];
            if (
              res.baseBytes !== undefined ||
              res.baseExactTokens !== undefined
            ) {
              nextBase[id] = {
                bytes: res.baseBytes ?? existingBase?.bytes ?? 0,
                exactTokens:
                  res.baseExactTokens !== undefined
                    ? res.baseExactTokens
                    : (existingBase?.exactTokens ?? null),
              };
            }

            if (
              res.optBytes !== undefined ||
              res.optExactTokens !== undefined
            ) {
              const existingOpt = nextOpt[id];
              const sameHash = existingOpt?.configHash === activeConfigHash;
              nextOpt[id] = {
                configHash: activeConfigHash,
                bytes:
                  res.optBytes ??
                  (sameHash ? existingOpt.bytes : (nextBase[id]?.bytes ?? 0)),
                exactTokens:
                  res.optExactTokens !== undefined
                    ? res.optExactTokens
                    : sameHash
                      ? existingOpt.exactTokens
                      : null,
              };
            }
          }

          return {
            baseMetricsMap: nextBase,
            optimizedMetricsMap: nextOpt,
            tokenizationProgress: data.progress,
          };
        });
      } else if (data.type === 'done') {
        const shouldReevaluate = get().pendingReevaluate;
        set({
          isTokenizing: false,
          tokenizationProgress: 100,
          pendingReevaluate: false,
        });
        if (shouldReevaluate) {
          get().evaluateTokenization();
        }
      } else if (data.type === 'error') {
        console.error('[Tokenizer Worker Error]', data.error);
        const w = get().tokenizerWorker;
        if (w) w.terminate();
        set({
          isTokenizing: false,
          tokenizerWorker: null,
          pendingReevaluate: false,
        });
      }
    };

    worker.onerror = (err) => {
      if (runId !== get().tokenizationRunId) return;
      console.error('[Tokenizer Worker Fatal Error]', err);
      const w = get().tokenizerWorker;
      if (w) w.terminate();
      set({
        isTokenizing: false,
        tokenizerWorker: null,
        pendingReevaluate: false,
      });
    };

    worker.postMessage({
      runId,
      configHash: activeConfigHash,
      files: filesToTokenize,
      isOptimizationEnabled: localFilters?.isOptimizationEnabled ?? false,
      optimizationRules: localFilters?.optimizationRules ?? [],
    } as TokenizerInput);
  },
});
