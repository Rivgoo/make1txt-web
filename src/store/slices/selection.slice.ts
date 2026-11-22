import type { StateCreator } from 'zustand';
import type { FileStore, SelectionSlice } from '../store.types';
import type { CSharpCompressionLevel } from '@/core/types/csharp-compression.types';
import { estimateTokenCount } from '@/core/utils/stats.utils';
import { computeFileEffectiveConfigHash, isCSharpFilePath } from '@/core/utils/optimization.utils';
import { DEFAULT_CSHARP_COMPRESSION_OPTIONS } from '@/core/constants/csharp-compression.constants';

export const createSelectionSlice: StateCreator<FileStore, [], [], SelectionSlice> = (set, get) => ({
  toggleSelection: (id, checked) => {
    set((state) => {
      const target = state.nodes.find(n => n.id === id);
      if (!target || target.isIgnored) return state;

      const pathPrefix = `${target.relativePath}/`;

      const newNodes = state.nodes.map(node => {
        if (node.isIgnored) return node;
        if (node.id === id || node.relativePath.startsWith(pathPrefix)) {
          return { ...node, isSelected: checked };
        }
        return node;
      });

      return { nodes: newNodes };
    });
    get().evaluateTokenization();
  },

  setDirectChildrenSelection: (folderId, checked) => {
    set((state) => {
      const target = state.nodes.find(n => n.id === folderId);
      if (!target || !target.isDirectory || target.isIgnored) return state;

      const pathPrefix = `${target.relativePath}/`;

      const updatedDirectChildren = state.nodes.map(node => {
        if (node.parentId === folderId && !node.isDirectory && !node.isIgnored) {
          return { ...node, isSelected: checked };
        }
        return node;
      });

      const hasAnySelectedDescendant = updatedDirectChildren.some(
        node => !node.isDirectory && !node.isIgnored && node.isSelected && node.relativePath.startsWith(pathPrefix)
      );

      const newNodes = updatedDirectChildren.map(node => {
        if (node.id === folderId) {
          return { ...node, isSelected: checked ? true : hasAnySelectedDescendant };
        }
        if (checked && node.isDirectory && !node.isIgnored && target.relativePath.startsWith(`${node.relativePath}/`)) {
          return { ...node, isSelected: true };
        }
        return node;
      });

      return { nodes: newNodes };
    });
    get().evaluateTokenization();
  },

  toggleExpand: (id) => {
    set((state) => ({
      nodes: state.nodes.map(node => node.id === id ? { ...node, isExpanded: !node.isExpanded } : node)
    }));
  },

  selectAll: () => {
    set((state) => ({
      nodes: state.nodes.map(node => node.isIgnored ? node : { ...node, isSelected: true })
    }));
    get().evaluateTokenization();
  },

  deselectAll: () => {
    set((state) => ({
      nodes: state.nodes.map(node => node.isIgnored ? node : { ...node, isSelected: false })
    }));
    get().evaluateTokenization();
  },

  getStats: () => {
    const {
      nodes,
      baseMetricsMap,
      optimizedMetricsMap,
      appliedOptimizationHash,
      appliedOptimizationRules,
      localFilters,
    } = get();

    const isRegexActive =
      (localFilters?.isOptimizationEnabled ?? false) &&
      appliedOptimizationHash !== 'none';
    const isCSharpEnabled = localFilters?.isCSharpCompressionEnabled ?? false;
    const csharpOptions =
      localFilters?.csharpCompressionOptions ?? DEFAULT_CSHARP_COMPRESSION_OPTIONS;

    let totalFiles = 0;
    let selectedFiles = 0;
    let fullSelectedFiles = 0;
    let structureOnlyFiles = 0;

    let totalSizeBytes = 0;
    let totalOptimizedBytes = 0;
    let structureOnlySavedBytes = 0;

    let baseTokens = 0;
    let tokens = 0;
    let structureOnlySavedTokens = 0;
    let optimizationSavedTokens = 0;
    let compressedCSharpFiles = 0;

    const csharpLevelCounts: Record<CSharpCompressionLevel, number> = {
      none: 0,
      clean: 0,
      compact: 0,
      skeleton: 0,
      contract: 0,
    };

    let isExactTokens = true;
    let isBaseExactTokens = true;

    for (const node of nodes) {
      if (node.isDirectory) continue;

      if (!node.isIgnored) totalFiles++;

      if (node.isSelected && !node.isIgnored) {
        selectedFiles++;

        const baseEntry = baseMetricsMap[node.id];
        const rawBytes = baseEntry?.bytes ?? node.sizeBytes;
        const baseExact = baseEntry?.exactTokens ?? null;
        const fileBaseTokens =
          baseExact !== null ? baseExact : estimateTokenCount(rawBytes);

        if (node.outputMode === 'structure-only') {
          structureOnlyFiles++;
          structureOnlySavedBytes += rawBytes;
          structureOnlySavedTokens += fileBaseTokens;
          continue;
        }

        fullSelectedFiles++;
        totalSizeBytes += rawBytes;
        baseTokens += fileBaseTokens;
        if (baseExact === null) isBaseExactTokens = false;

        if (isCSharpFilePath(node.relativePath)) {
          const effLevel: CSharpCompressionLevel = isCSharpEnabled
            ? node.csharpCompressionLevel
            : 'none';
          csharpLevelCounts[effLevel]++;
          if (effLevel !== 'none') {
            compressedCSharpFiles++;
          }
        }

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

        if (hasValidOpt) {
          totalOptimizedBytes += optEntry.bytes;
          let fileOptTokens: number;
          if (optEntry.exactTokens !== null) {
            fileOptTokens = optEntry.exactTokens;
          } else {
            fileOptTokens = estimateTokenCount(optEntry.bytes);
            isExactTokens = false;
          }
          tokens += fileOptTokens;
          optimizationSavedTokens += Math.max(0, fileBaseTokens - fileOptTokens);
        } else {
          totalOptimizedBytes += rawBytes;
          tokens += fileBaseTokens;
          if (baseExact === null) isExactTokens = false;
        }
      }
    }

    if (fullSelectedFiles === 0) {
      isExactTokens = selectedFiles > 0;
      isBaseExactTokens = selectedFiles > 0;
    }

    const estimatedTotal = estimateTokenCount(totalOptimizedBytes);

    return {
      totalFiles,
      selectedFiles,
      fullSelectedFiles,
      structureOnlyFiles,
      totalSizeBytes,
      totalOptimizedBytes,
      structureOnlySavedBytes,
      totalWords: Math.floor(estimatedTotal * 0.75),
      baseTokens,
      tokens,
      structureOnlySavedTokens,
      optimizationSavedTokens,
      compressedCSharpFiles,
      csharpLevelCounts,
      isExactTokens,
      isBaseExactTokens,
    };
  }
});
