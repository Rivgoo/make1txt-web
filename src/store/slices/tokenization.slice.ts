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
import { computeFileEffectiveConfigHash } from '@/core/utils/optimization.utils';
import { DEFAULT_CSHARP_COMPRESSION_OPTIONS } from '@/core/constants/csharp-compression.constants';
import { MAX_AUTO_TOKENS } from '../constants';

export const createTokenizationSlice: StateCreator<FileStore, [], [], TokenizationSlice> = (set, get) => ({
  baseMetricsMap: {},
  optimizedMetricsMap: {},
  appliedOptimizationHash: 'none',
  appliedOptimizationRules: [],
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
      appliedOptimizationRules,
    } = get();

    if (isTokenizing) {
      set({ pendingReevaluate: true });
      return;
    }

    const isRegexActive =
      (localFilters?.isOptimizationEnabled ?? false) && appliedOptimizationHash !== 'none';
    const isCSharpEnabled = localFilters?.isCSharpCompressionEnabled ?? false;
    const csharpOptions =
      localFilters?.csharpCompressionOptions ?? DEFAULT_CSHARP_COMPRESSION_OPTIONS;

    let estimatedTokens = 0;
    for (const node of nodes) {
      if (
        !node.isDirectory &&
        node.isSelected &&
        !node.isIgnored &&
        node.outputMode === 'full'
      ) {
        const effHash = computeFileEffectiveConfigHash(
          node.relativePath,
          isRegexActive,
          appliedOptimizationRules,
          isCSharpEnabled,
          node.csharpCompressionLevel,
          csharpOptions
        );
        const optEntry = optimizedMetricsMap[node.id];
        const hasValidOpt =
          effHash !== 'none' &&
          optEntry !== undefined &&
          optEntry.configHash === effHash;
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
      appliedOptimizationRules,
      localFilters,
      needsManualTokenization,
      isRestoredFromProfile,
    } = get();

    const isRegexActive =
      (localFilters?.isOptimizationEnabled ?? false) && appliedOptimizationHash !== 'none';
    const isCSharpEnabled = localFilters?.isCSharpCompressionEnabled ?? false;
    const csharpOptions =
      localFilters?.csharpCompressionOptions ?? DEFAULT_CSHARP_COMPRESSION_OPTIONS;
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

      const effHash = computeFileEffectiveConfigHash(
        n.relativePath,
        isRegexActive,
        appliedOptimizationRules,
        isCSharpEnabled,
        n.csharpCompressionLevel,
        csharpOptions
      );
      const optActiveForFile = effHash !== 'none';

      const baseEntry = baseMetricsMap[n.id];
      const optEntry = optimizedMetricsMap[n.id];
      const hasValidOptEntry =
        optEntry !== undefined && optEntry.configHash === effHash;

      const needsBaseBytes = baseEntry === undefined;
      const needsBaseTokens =
        !skipTiktoken &&
        (baseEntry === undefined || baseEntry.exactTokens === null);
      const needsOptBytes = optActiveForFile && !hasValidOptEntry;
      const needsOptTokens =
        optActiveForFile &&
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
          path: n.relativePath,
          handle: n.handle as FileSystemFileHandle | null,
          content: n.content,
          sizeBytes: n.sizeBytes,
          effectiveConfigHash: effHash,
          csharpCompressionLevel: n.csharpCompressionLevel,
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
              const sameHash = existingOpt?.configHash === res.configHash;
              nextOpt[id] = {
                configHash: res.configHash,
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

    const dispatchToWorker = (preparedFiles: TokenizerFileItem[]) => {
      if (runId !== get().tokenizationRunId) return;
      worker!.postMessage({
        runId,
        files: preparedFiles,
        isOptimizationEnabled: isRegexActive,
        optimizationRules: appliedOptimizationRules,
        isCSharpCompressionEnabled: isCSharpEnabled,
        csharpCompressionOptions: csharpOptions,
      } as TokenizerInput);
    };

    // F9: Main-thread handle-read guard for IndexedDB-restored profile handles
    if (isRestoredFromProfile) {
      void (async () => {
        const hydrated = await Promise.all(
          filesToTokenize.map(async (item) => {
            if (item.content === undefined && item.handle) {
              try {
                const file = await item.handle.getFile();
                return { ...item, content: await file.text(), sizeBytes: file.size };
              } catch {
                return item;
              }
            }
            return item;
          })
        );
        dispatchToWorker(hydrated);
      })();
    } else {
      dispatchToWorker(filesToTokenize);
    }
  },
});
