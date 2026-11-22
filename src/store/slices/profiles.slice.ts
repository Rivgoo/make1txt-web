import type { StateCreator } from 'zustand';
import type { FileStore, ProfilesSlice } from '../store.types';
import type { Profile } from '@/core/types/file.types';
import { dbService } from '@/core/services/DatabaseService';
import { recompileAndRecalculate } from '../helpers/node.helper';
import { saveGlobalSettings } from '../helpers/settings.helper';
import { PREDEFINED_OPTIMIZATION_RULES } from '@/core/constants/optimization.constants';
import { DEFAULT_GLOBAL_SETTINGS } from '../constants';
import { computeOptimizationHash } from '@/core/utils/optimization.utils';
import { DEFAULT_CSHARP_COMPRESSION_OPTIONS } from '@/core/constants/csharp-compression.constants';

export const createProfilesSlice: StateCreator<FileStore, [], [], ProfilesSlice> = (set, get) => ({
  profiles: [],
  activeProfileId: null,
  activeProfileSnapshot: null,
  hasUnsavedProfileChanges: false,

  fetchProfiles: async () => {
    const data = await dbService.getAllProfiles();
    set({ profiles: data });
  },

  saveCurrentProfile: async (name, saveDirectory) => {
    const { rootHandle, globalSettings, localFilters } = get();
    
    const hiddenExtensions = Object.entries(localFilters.extensions)
      .filter(([, stat]) => !stat.isActive)
      .map(([ext]) => ext);

    const profile: Profile = {
      id: crypto.randomUUID(),
      name,
      lastUsed: Date.now(),
      directoryHandle: saveDirectory && rootHandle ? rootHandle : undefined,
      directoryName: saveDirectory && rootHandle ? rootHandle.name : undefined,
      settings: globalSettings,
      localFilters: {
        hiddenExtensions,
        customPatterns: localFilters.customPatterns,
        outputModeOverrides: localFilters.outputModeOverrides ?? {},
        showGloballyIgnored: localFilters.showGloballyIgnored,
        showLocallyIgnored: localFilters.showLocallyIgnored,
        showEmptyFolders: localFilters.showEmptyFolders,
        generateTree: localFilters.generateTree,
        treeIncludeIgnored: localFilters.treeIncludeIgnored,
        isOptimizationEnabled: localFilters.isOptimizationEnabled,
        optimizationRules: localFilters.optimizationRules,
        enableCSharpAnalysis: localFilters.enableCSharpAnalysis,
        isCSharpCompressionEnabled: localFilters.isCSharpCompressionEnabled,
        defaultCSharpCompressionLevel: localFilters.defaultCSharpCompressionLevel,
        csharpCompressionOverrides: localFilters.csharpCompressionOverrides ?? {},
        csharpCompressionOptions: localFilters.csharpCompressionOptions,
      }
    };

    await dbService.saveProfile(profile);
    await get().fetchProfiles();

    set({ 
      activeProfileId: profile.id, 
      activeProfileSnapshot: profile, 
      hasUnsavedProfileChanges: false 
    });
  },

  loadProfile: async (profile) => {
    if (get().isLoading) throw new Error('ALREADY_LOADING');
    
    const updatedProfile = { ...profile, lastUsed: Date.now() };
    await dbService.saveProfile(updatedProfile);
    await get().fetchProfiles();

    set({ 
      activeProfileId: updatedProfile.id, 
      activeProfileSnapshot: updatedProfile, 
      hasUnsavedProfileChanges: false 
    });

    if (profile.directoryHandle) {
      await get().loadDirectoryFromHandle(profile.directoryHandle, profile, true);
    } else {
      set((state) => {
        const newExts = { ...state.localFilters.extensions };
        Object.keys(newExts).forEach(ext => {
          newExts[ext] = { ...newExts[ext], isActive: !profile.localFilters.hiddenExtensions.includes(ext) };
        });
        
        const savedFilters = profile.localFilters;
        const mergedSettings = { ...DEFAULT_GLOBAL_SETTINGS, ...profile.settings };
        const optEnabled = savedFilters.isOptimizationEnabled ?? false;
        const optRules = savedFilters.optimizationRules ?? PREDEFINED_OPTIMIZATION_RULES;

        const newLocalFilters = {
          ...state.localFilters,
          extensions: newExts,
          customPatterns: savedFilters.customPatterns,
          outputModeOverrides: savedFilters.outputModeOverrides ?? {},
          showGloballyIgnored: savedFilters.showGloballyIgnored ?? false,
          showLocallyIgnored: savedFilters.showLocallyIgnored ?? true,
          showEmptyFolders: savedFilters.showEmptyFolders ?? false,
          generateTree: savedFilters.generateTree ?? true,
          treeIncludeIgnored: savedFilters.treeIncludeIgnored ?? false,
          isOptimizationEnabled: optEnabled,
          isOptimizationDirty: false,
          optimizationRules: optRules,
          enableCSharpAnalysis: savedFilters.enableCSharpAnalysis ?? true,
          isCSharpCompressionEnabled: savedFilters.isCSharpCompressionEnabled ?? false,
          defaultCSharpCompressionLevel: savedFilters.defaultCSharpCompressionLevel ?? 'compact',
          csharpCompressionOverrides: savedFilters.csharpCompressionOverrides ?? {},
          csharpCompressionOptions: {
            ...DEFAULT_CSHARP_COMPRESSION_OPTIONS,
            ...(savedFilters.csharpCompressionOptions ?? {}),
          },
        };

        const tempState = { ...state, globalSettings: mergedSettings, localFilters: newLocalFilters };
        return {
          globalSettings: mergedSettings,
          localFilters: newLocalFilters,
          appliedOptimizationHash: optEnabled ? computeOptimizationHash(true, optRules) : 'none',
          appliedOptimizationRules: optEnabled ? optRules : [],
          ...recompileAndRecalculate(tempState)
        };
      });
      
      saveGlobalSettings({ ...DEFAULT_GLOBAL_SETTINGS, ...profile.settings });
      get().evaluateTokenization();
    }
  },

  deleteProfile: async (id) => {
    await dbService.deleteProfile(id);
    
    if (get().activeProfileId === id) {
      set({ 
        activeProfileId: null, 
        activeProfileSnapshot: null, 
        hasUnsavedProfileChanges: false 
      });
    }

    await get().fetchProfiles();
  },

  checkProfileChanges: () => {
    const { activeProfileSnapshot, globalSettings, localFilters } = get();
    if (!activeProfileSnapshot) return;

    const hiddenExtensions = Object.entries(localFilters.extensions)
      .filter(([, stat]) => !stat.isActive)
      .map(([ext]) => ext);

    const currentSavedFilters = {
      hiddenExtensions,
      customPatterns: localFilters.customPatterns,
      outputModeOverrides: localFilters.outputModeOverrides ?? {},
      showGloballyIgnored: localFilters.showGloballyIgnored,
      showLocallyIgnored: localFilters.showLocallyIgnored,
      showEmptyFolders: localFilters.showEmptyFolders,
      generateTree: localFilters.generateTree,
      treeIncludeIgnored: localFilters.treeIncludeIgnored,
      isOptimizationEnabled: localFilters.isOptimizationEnabled,
      optimizationRules: localFilters.optimizationRules,
      enableCSharpAnalysis: localFilters.enableCSharpAnalysis,
      isCSharpCompressionEnabled: localFilters.isCSharpCompressionEnabled,
      defaultCSharpCompressionLevel: localFilters.defaultCSharpCompressionLevel,
      csharpCompressionOverrides: localFilters.csharpCompressionOverrides ?? {},
      csharpCompressionOptions: localFilters.csharpCompressionOptions,
    };

    const snapshotFilters = {
      ...activeProfileSnapshot.localFilters,
      outputModeOverrides: activeProfileSnapshot.localFilters.outputModeOverrides ?? {},
      isCSharpCompressionEnabled:
        activeProfileSnapshot.localFilters.isCSharpCompressionEnabled ?? false,
      defaultCSharpCompressionLevel:
        activeProfileSnapshot.localFilters.defaultCSharpCompressionLevel ?? 'compact',
      csharpCompressionOverrides:
        activeProfileSnapshot.localFilters.csharpCompressionOverrides ?? {},
      csharpCompressionOptions: {
        ...DEFAULT_CSHARP_COMPRESSION_OPTIONS,
        ...(activeProfileSnapshot.localFilters.csharpCompressionOptions ?? {}),
      },
    };

    const isSettingsChanged = JSON.stringify(globalSettings) !== JSON.stringify(activeProfileSnapshot.settings);
    const isFiltersChanged = JSON.stringify(currentSavedFilters) !== JSON.stringify(snapshotFilters);

    set({ hasUnsavedProfileChanges: isSettingsChanged || isFiltersChanged });
  },

  saveActiveProfileChanges: async () => {
    const { activeProfileSnapshot, globalSettings, localFilters } = get();
    if (!activeProfileSnapshot) return;

    const hiddenExtensions = Object.entries(localFilters.extensions)
      .filter(([, stat]) => !stat.isActive)
      .map(([ext]) => ext);

    const updatedProfile: Profile = {
      ...activeProfileSnapshot,
      lastUsed: Date.now(),
      settings: globalSettings,
      localFilters: {
        hiddenExtensions,
        customPatterns: localFilters.customPatterns,
        outputModeOverrides: localFilters.outputModeOverrides ?? {},
        showGloballyIgnored: localFilters.showGloballyIgnored,
        showLocallyIgnored: localFilters.showLocallyIgnored,
        showEmptyFolders: localFilters.showEmptyFolders,
        generateTree: localFilters.generateTree,
        treeIncludeIgnored: localFilters.treeIncludeIgnored,
        isOptimizationEnabled: localFilters.isOptimizationEnabled,
        optimizationRules: localFilters.optimizationRules,
        enableCSharpAnalysis: localFilters.enableCSharpAnalysis,
        isCSharpCompressionEnabled: localFilters.isCSharpCompressionEnabled,
        defaultCSharpCompressionLevel: localFilters.defaultCSharpCompressionLevel,
        csharpCompressionOverrides: localFilters.csharpCompressionOverrides ?? {},
        csharpCompressionOptions: localFilters.csharpCompressionOptions,
      }
    };

    await dbService.saveProfile(updatedProfile);
    await get().fetchProfiles();

    set({ 
      activeProfileSnapshot: updatedProfile, 
      hasUnsavedProfileChanges: false 
    });
  }
});