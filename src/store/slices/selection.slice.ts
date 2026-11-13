import type { StateCreator } from 'zustand';
import type { FileStore, SelectionSlice } from '../store.types';
import { estimateTokenCount, hasMeaningfulOptimization } from '@/core/utils/stats.utils';

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
    const { nodes, realTokenMap, optimizedBytesMap, localFilters } = get();
    
    let totalFiles = 0;
    let selectedFiles = 0;
    let totalSizeBytes = 0;
    let totalOptimizedBytes = 0;
    
    let baseTokens = 0;
    let optimizedTokens = 0;
    
    let allSelectedHaveRealTokens = true;

    for (const node of nodes) {
      if (node.isDirectory) continue;
      
      if (!node.isIgnored) totalFiles++;
      
      if (node.isSelected && !node.isIgnored) {
        selectedFiles++;
        totalSizeBytes += node.sizeBytes;
        
        const optBytes = optimizedBytesMap[node.id];
        let finalBytes = node.sizeBytes;

        if (localFilters?.isOptimizationEnabled && optBytes !== undefined && hasMeaningfulOptimization(node.sizeBytes, optBytes)) {
          finalBytes = optBytes;
          totalOptimizedBytes += optBytes;
        } else {
          totalOptimizedBytes += node.sizeBytes;
        }
        
        if (realTokenMap[node.id] !== undefined) {
          baseTokens += realTokenMap[node.id];
          
          if (localFilters?.isOptimizationEnabled && finalBytes < node.sizeBytes) {
            // If we optimized, we estimate the tokens of the new string roughly 
            // since we skipped Tiktoken for the optimized string for speed.
            optimizedTokens += estimateTokenCount(finalBytes);
          } else {
            optimizedTokens += realTokenMap[node.id];
          }
        } else {
          baseTokens += estimateTokenCount(node.sizeBytes);
          optimizedTokens += estimateTokenCount(finalBytes);
          allSelectedHaveRealTokens = false;
        }
      }
    }

    const estimatedTotal = estimateTokenCount(totalSizeBytes);
    if (selectedFiles === 0) allSelectedHaveRealTokens = false;

    return {
      totalFiles,
      selectedFiles,
      totalSizeBytes,
      totalOptimizedBytes,
      totalWords: Math.floor(estimatedTotal * 0.75),
      baseTokens,
      tokens: optimizedTokens,
      isExactTokens: allSelectedHaveRealTokens,
    };
  }
});
