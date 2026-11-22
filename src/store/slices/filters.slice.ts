import type { StateCreator } from 'zustand';
import type { FileStore, FiltersSlice } from '../store.types';
import type { ExtensionStat, OutputMode } from '@/core/types/file.types';
import { computeNodes, recompileAndRecalculate } from '../helpers/node.helper';
import { PREDEFINED_OPTIMIZATION_RULES } from '@/core/constants/optimization.constants';
import { setOutputModeOverride } from '@/core/utils/output-mode.utils';

export const createFiltersSlice: StateCreator<FileStore, [], [], FiltersSlice> = (set, get) => ({
  localFilters: { 
    extensions: {}, 
    customPatterns: [], 
    outputModeOverrides: {},
    showGloballyIgnored: false,
    showLocallyIgnored: true,
    showEmptyFolders: false,
    generateTree: true,
    treeIncludeIgnored: false,
    isOptimizationEnabled: false,
    isOptimizationDirty: false,
    optimizationRules: PREDEFINED_OPTIMIZATION_RULES,
    enableCSharpAnalysis: true
  },

  updateLocalFilters: (newFilters) => {
    set((state) => {
      const filters = { ...state.localFilters, ...newFilters };
      const tempState = { ...state, localFilters: filters };
      return { localFilters: filters, ...recompileAndRecalculate(tempState) };
    });
    get().evaluateTokenization();
  },

  toggleExtension: (ext) => {
    set((state) => {
      const extData = state.localFilters.extensions[ext];
      if (!extData) return state;
      
      const newIsActive = !extData.isActive;
      const newFilters = {
        ...state.localFilters,
        extensions: {
          ...state.localFilters.extensions,
          [ext]: { ...extData, isActive: newIsActive }
        }
      };
      
      const tempState = { ...state, localFilters: newFilters };
      return {
        localFilters: newFilters,
        nodes: computeNodes(tempState, newIsActive ? ext : undefined)
      };
    });
    get().evaluateTokenization();
  },

  setAllExtensionsState: (isActive) => {
    set((state) => {
      const newExts: Record<string, ExtensionStat> = {};
      for (const e in state.localFilters.extensions) {
        newExts[e] = { ...state.localFilters.extensions[e], isActive };
      }
      
      const newFilters = { ...state.localFilters, extensions: newExts };
      const tempState = { ...state, localFilters: newFilters };
      
      return {
        localFilters: newFilters,
        nodes: computeNodes(tempState, undefined, isActive)
      };
    });
    get().evaluateTokenization();
  },

  addCustomPattern: (pattern) => {
    set((state) => {
      const exists = state.localFilters.customPatterns.find(p => p.pattern === pattern);
      if (exists) return state;
      
      const newFilters = { 
        ...state.localFilters, 
        customPatterns: [...state.localFilters.customPatterns, { id: crypto.randomUUID(), pattern, isActive: true }] 
      };
      return { localFilters: newFilters, ...recompileAndRecalculate({ ...state, localFilters: newFilters }) };
    });
    get().evaluateTokenization();
  },

  updateCustomPattern: (id, newPattern) => {
    set((state) => {
      const newFilters = { 
        ...state.localFilters, 
        customPatterns: state.localFilters.customPatterns.map(p => p.id === id ? { ...p, pattern: newPattern } : p) 
      };
      return { localFilters: newFilters, ...recompileAndRecalculate({ ...state, localFilters: newFilters }) };
    });
    get().evaluateTokenization();
  },

  toggleCustomPattern: (id) => {
    set((state) => {
      const newFilters = { 
        ...state.localFilters, 
        customPatterns: state.localFilters.customPatterns.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p) 
      };
      return { localFilters: newFilters, ...recompileAndRecalculate({ ...state, localFilters: newFilters }) };
    });
    get().evaluateTokenization();
  },

  removeCustomPattern: (id) => {
    set((state) => {
      const newFilters = { 
        ...state.localFilters, 
        customPatterns: state.localFilters.customPatterns.filter(p => p.id !== id) 
      };
      return { localFilters: newFilters, ...recompileAndRecalculate({ ...state, localFilters: newFilters }) };
    });
    get().evaluateTokenization();
  },

  moveCustomPattern: (id, direction) => {
    set((state) => {
      const patterns = [...state.localFilters.customPatterns];
      const idx = patterns.findIndex(p => p.id === id);
      if (idx < 0) return state;
      
      if (direction === 'up' && idx > 0) {
        [patterns[idx - 1], patterns[idx]] = [patterns[idx], patterns[idx - 1]];
      } else if (direction === 'down' && idx < patterns.length - 1) {
        [patterns[idx + 1], patterns[idx]] = [patterns[idx], patterns[idx + 1]];
      }
      
      const newFilters = { ...state.localFilters, customPatterns: patterns };
      return { localFilters: newFilters, ...recompileAndRecalculate({ ...state, localFilters: newFilters }) };
    });
    get().evaluateTokenization();
  },

  toggleLocalPathIgnore: (path) => {
    set((state) => {
      const exists = state.localFilters.customPatterns.find(p => p.pattern === path);
      
      if (exists) {
        const newPatterns = state.localFilters.customPatterns.filter(p => p.pattern !== path);
        const newFilters = { ...state.localFilters, customPatterns: newPatterns };
        
        const pathPrefix = `${path}/`;
        const newNodes = state.nodes.map(n => {
          if (n.relativePath === path || n.relativePath.startsWith(pathPrefix)) {
            return { ...n, isSelected: true };
          }
          return n;
        });
        
        const tempState = { ...state, nodes: newNodes, localFilters: newFilters };
        return { localFilters: newFilters, ...recompileAndRecalculate(tempState) };
      } else {
        const newPatterns = [...state.localFilters.customPatterns, { id: crypto.randomUUID(), pattern: path, isActive: true }];
        const newFilters = { ...state.localFilters, customPatterns: newPatterns };
        return { localFilters: newFilters, ...recompileAndRecalculate({ ...state, localFilters: newFilters }) };
      }
    });
    get().evaluateTokenization();
  },

  setNodeOutputMode: (relativePath, mode) => {
    set((state) => {
      const currentOverrides = state.localFilters.outputModeOverrides ?? {};
      const nextOverrides = setOutputModeOverride(currentOverrides, relativePath, mode);

      // Auto-Guard 1: Auto-enable generateTree when marking structure-only
      const generateTree =
        mode === 'structure-only' && !state.localFilters.generateTree
          ? true
          : state.localFilters.generateTree;

      const newFilters = {
        ...state.localFilters,
        outputModeOverrides: nextOverrides,
        generateTree,
      };

      // Auto-Guard 2: If marking a folder with 0 selected non-ignored descendants as structure-only,
      // auto-select its non-ignored descendants so the action has immediate observable effect.
      let updatedNodes = state.nodes;
      if (mode === 'structure-only') {
        const target = state.nodes.find((n) => n.relativePath === relativePath);
        if (target && target.isDirectory && !target.isIgnored) {
          const prefix = `${relativePath}/`;
          const hasSelectedDescendant = state.nodes.some(
            (n) =>
              !n.isDirectory &&
              !n.isIgnored &&
              n.isSelected &&
              n.relativePath.startsWith(prefix)
          );
          if (!hasSelectedDescendant) {
            updatedNodes = state.nodes.map((n) => {
              if (n.isIgnored) return n;
              if (n.relativePath === relativePath || n.relativePath.startsWith(prefix)) {
                return { ...n, isSelected: true };
              }
              return n;
            });
          }
        }
      }

      const tempState = { ...state, nodes: updatedNodes, localFilters: newFilters };
      return {
        localFilters: newFilters,
        nodes: computeNodes(tempState),
      };
    });
    get().evaluateTokenization();
  },

  toggleNodeOutputMode: (nodeId) => {
    const target = get().nodes.find((n) => n.id === nodeId);
    if (!target || target.isIgnored) return;
    const desiredMode: OutputMode =
      target.outputMode === 'structure-only' ? 'full' : 'structure-only';
    get().setNodeOutputMode(target.relativePath, desiredMode);
  },

  clearNodeOutputModeOverride: (relativePath) => {
    const state = get();
    const overrides = state.localFilters.outputModeOverrides ?? {};
    // Determine parent's inherited mode and pass it to setNodeOutputMode so self + redundant children prune cleanly
    let parentMode: OutputMode = 'full';
    const parts = relativePath.split('/');
    parts.pop();
    while (parts.length > 0) {
      const anc = parts.join('/');
      if (overrides[anc] !== undefined) {
        parentMode = overrides[anc];
        break;
      }
      parts.pop();
    }
    get().setNodeOutputMode(relativePath, parentMode);
  },

  clearAllOutputModeOverrides: () => {
    set((state) => {
      const newFilters = {
        ...state.localFilters,
        outputModeOverrides: {},
      };
      const tempState = { ...state, localFilters: newFilters };
      return {
        localFilters: newFilters,
        nodes: computeNodes(tempState),
      };
    });
    get().evaluateTokenization();
  },
});