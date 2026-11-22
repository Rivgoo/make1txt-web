import type { StateCreator } from 'zustand';
import type { FileStore, OptimizationSlice } from '../store.types';
import { PREDEFINED_OPTIMIZATION_RULES } from '@/core/constants/optimization.constants';
import { computeOptimizationHash } from '@/core/utils/optimization.utils';

export const createOptimizationSlice: StateCreator<FileStore, [], [], OptimizationSlice> = (set, get) => ({
  toggleOptimization: (isEnabled) => {
    set((state) => {
      const rules = state.localFilters.optimizationRules || PREDEFINED_OPTIMIZATION_RULES;
      if (!isEnabled) {
        return {
          appliedOptimizationHash: 'none',
          localFilters: {
            ...state.localFilters,
            isOptimizationEnabled: false,
            isOptimizationDirty: false,
            optimizationRules: rules,
          },
        };
      }
      const pendingHash = computeOptimizationHash(true, rules);
      return {
        localFilters: {
          ...state.localFilters,
          isOptimizationEnabled: true,
          isOptimizationDirty: pendingHash !== state.appliedOptimizationHash,
          optimizationRules: rules,
        },
      };
    });
  },

  toggleOptimizationRule: (id) => {
    set((state) => {
      const currentRules = state.localFilters.optimizationRules || PREDEFINED_OPTIMIZATION_RULES;
      const newRules = currentRules.map((rule) =>
        rule.id === id ? { ...rule, isActive: !rule.isActive } : rule
      );
      const pendingHash = computeOptimizationHash(
        state.localFilters.isOptimizationEnabled,
        newRules
      );
      return {
        localFilters: {
          ...state.localFilters,
          optimizationRules: newRules,
          isOptimizationDirty: state.localFilters.isOptimizationEnabled
            ? pendingHash !== state.appliedOptimizationHash
            : false,
        },
      };
    });
  },

  addCustomOptimizationRule: (ruleData) => {
    set((state) => {
      const currentRules = state.localFilters.optimizationRules || PREDEFINED_OPTIMIZATION_RULES;
      const newRule = { ...ruleData, id: crypto.randomUUID(), isPredefined: false };
      const newRules = [...currentRules, newRule];
      const pendingHash = computeOptimizationHash(
        state.localFilters.isOptimizationEnabled,
        newRules
      );
      return {
        localFilters: {
          ...state.localFilters,
          optimizationRules: newRules,
          isOptimizationDirty: state.localFilters.isOptimizationEnabled
            ? pendingHash !== state.appliedOptimizationHash
            : false,
        },
      };
    });
  },

  removeCustomOptimizationRule: (id) => {
    set((state) => {
      const currentRules = state.localFilters.optimizationRules || PREDEFINED_OPTIMIZATION_RULES;
      const newRules = currentRules.filter((rule) => rule.id !== id);
      const pendingHash = computeOptimizationHash(
        state.localFilters.isOptimizationEnabled,
        newRules
      );
      return {
        localFilters: {
          ...state.localFilters,
          optimizationRules: newRules,
          isOptimizationDirty: state.localFilters.isOptimizationEnabled
            ? pendingHash !== state.appliedOptimizationHash
            : false,
        },
      };
    });
  },

  updateCustomOptimizationRule: (id, updates) => {
    set((state) => {
      const currentRules = state.localFilters.optimizationRules || PREDEFINED_OPTIMIZATION_RULES;
      const newRules = currentRules.map((rule) =>
        rule.id === id ? { ...rule, ...updates } : rule
      );
      const pendingHash = computeOptimizationHash(
        state.localFilters.isOptimizationEnabled,
        newRules
      );
      return {
        localFilters: {
          ...state.localFilters,
          optimizationRules: newRules,
          isOptimizationDirty: state.localFilters.isOptimizationEnabled
            ? pendingHash !== state.appliedOptimizationHash
            : false,
        },
      };
    });
  },

  applyOptimization: () => {
    const { localFilters, needsManualTokenization } = get();
    const rules = localFilters.optimizationRules || PREDEFINED_OPTIMIZATION_RULES;
    const newHash = computeOptimizationHash(localFilters.isOptimizationEnabled, rules);

    set((state) => ({
      appliedOptimizationHash: newHash,
      localFilters: {
        ...state.localFilters,
        isOptimizationDirty: false,
      },
    }));

    get().runTokenization(!needsManualTokenization, true);
  },
});
