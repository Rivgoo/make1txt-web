import type { StateCreator } from 'zustand';
import type { FileStore, DirectorySlice } from '../store.types';
import type { FileNode, LocalFilters } from '@/core/types/file.types';
import { requestDirectoryAccess, readDirectoryRecursively, verifyDirectoryPermission } from '@/core/services/FileSystemService';
import { createIgnoreRegexes, isPathGloballyIgnored } from '@/core/services/IgnoreService';
import { getFileExtension } from '@/core/utils/stats.utils';
import { buildExtMap, recompileAndRecalculate } from '../helpers/node.helper';
import { saveGlobalSettings } from '../helpers/settings.helper';
import { PREDEFINED_OPTIMIZATION_RULES } from '@/core/constants/optimization.constants';
import { DEFAULT_GLOBAL_SETTINGS } from '../constants';
import { IdeSyncService } from '@/core/services/IdeSyncService';
import { reconcileFileTree } from '@/core/utils/reconcile.utils';

export const createDirectorySlice: StateCreator<FileStore, [], [], DirectorySlice> = (set, get) => ({
  nodes: [],
  isLoading: false,
  isResyncing: false,
  scannedFilesCount: 0,
  rootHandle: null,
  sourceMode: 'browser-fs',
  syncProjectName: null,
  abortController: null,
  isRestoredFromProfile: false,
  activeTab: 'tree',
  generatedText: null,
  previewNode: null,
  sessionFileName: null,
  gitignoreRegexes: [],
  compiledCustomRegexes: [],

  setActiveTab: (tab) => set({ activeTab: tab }),
  setGeneratedText: (text) => set({ generatedText: text }),
  setPreviewNode: (node) => set({ previewNode: node }),
  setSessionFileName: (name) => set({ sessionFileName: name }),

  cancelDirectoryLoad: () => {
    get().abortController?.abort();
    set({ isLoading: false, abortController: null, scannedFilesCount: 0 });
  },

  resyncWorkspace: async () => {
    const { rootHandle, isLoading, isResyncing, globalSettings, cancelTokenization, nodes } = get();
    if (isLoading || isResyncing) throw new Error('ALREADY_LOADING');
    if (!rootHandle) throw new Error('NO_DIRECTORY_LOADED');

    cancelTokenization();
    set({ isResyncing: true });

    try {
      const hasPermission = await verifyDirectoryPermission(rootHandle);
      if (!hasPermission) throw new Error('NO_PERMISSION');

      let gitRegexes: RegExp[] = [];
      if (globalSettings.useGitignore) {
        try {
          const gitignoreHandle = await rootHandle.getFileHandle('.gitignore');
          const file = await gitignoreHandle.getFile();
          gitRegexes = createIgnoreRegexes(await file.text());
        } catch {
          // Ігноруємо, якщо .gitignore відсутній
        }
      }

      const skipPredicate = globalSettings.pruneIgnoredOnRead
        ? (name: string, relativePath: string, isDirectory: boolean) => {
            if (isPathGloballyIgnored(relativePath, globalSettings.ignoredPaths)) return true;
            if (!isDirectory && globalSettings.ignoredExtensions.includes(getFileExtension(name))) return true;
            if (gitRegexes.some(rx => rx.test(relativePath))) return true;
            return false;
          }
        : undefined;

      // Надійно знаходимо корінь з глибиною 0
      const existingRoot = nodes.find(n => n.depth === 0) || nodes[0];
      const rootId = existingRoot ? existingRoot.id : crypto.randomUUID();
      const rootNode: FileNode = {
        id: rootId,
        name: rootHandle.name,
        relativePath: rootHandle.name,
        isDirectory: true,
        sizeBytes: 0,
        handle: rootHandle,
        depth: 0,
        parentId: null,
        isSelected: existingRoot ? existingRoot.isSelected : true,
        isIgnored: false,
        isGloballyIgnored: false,
        isLocallyIgnored: false,
        isExpanded: existingRoot ? existingRoot.isExpanded : true,
      };

      const rawChildren = await readDirectoryRecursively(
        rootHandle,
        undefined,
        undefined,
        skipPredicate,
        { count: 0 },
        rootHandle.name,
        1,
        rootId
      );

      const freshlyScannedNodes = [rootNode, ...rawChildren];

      const { reconciledNodes, dirtyNodeIds, deletedNodeIds, stats } = reconcileFileTree({
        oldNodes: get().nodes,
        newScannedNodes: freshlyScannedNodes,
        globalSettings,
        localFilters: get().localFilters,
        gitignoreRegexes: gitRegexes,
        compiledCustomRegexes: get().compiledCustomRegexes
      });

      get().pruneAndInvalidateTokens(deletedNodeIds, dirtyNodeIds);

      // Обробка активного вікна попереднього перегляду, якщо файл було видалено або змінено
      const currentPreview = get().previewNode;
      if (currentPreview) {
        if (deletedNodeIds.has(currentPreview.id)) {
          set({ previewNode: null });
        } else {
          const updatedPreview = reconciledNodes.find(n => n.id === currentPreview.id);
          if (updatedPreview) set({ previewNode: updatedPreview });
        }
      }

      const extMap = buildExtMap(reconciledNodes, globalSettings, get().localFilters.extensions);

      const hasCsFiles = reconciledNodes.some(n => !n.isDirectory && n.name.toLowerCase().endsWith('.cs'));
      const currentCsChoice = get().localFilters?.enableCSharpAnalysis ?? true;
      const finalEnableCSharp = hasCsFiles ? currentCsChoice : false;

      const nextState = {
        ...get(),
        nodes: reconciledNodes,
        gitignoreRegexes: gitRegexes,
        localFilters: {
          ...get().localFilters,
          extensions: extMap,
          enableCSharpAnalysis: finalEnableCSharp
        },
        isResyncing: false,
      };

      set({ ...nextState, ...recompileAndRecalculate(nextState) });
      get().evaluateTokenization();

      return stats;
    } catch (error) {
      set({ isResyncing: false });
      throw error;
    }
  },

  resyncSubtree: async (targetNodeId: string) => {
    const { nodes, isLoading, isResyncing, globalSettings, cancelTokenization } = get();
    if (isLoading || isResyncing) throw new Error('ALREADY_LOADING');

    const targetNode = nodes.find(n => n.id === targetNodeId);
    if (!targetNode || !targetNode.isDirectory || !targetNode.handle) {
      throw new Error('INVALID_TARGET_NODE');
    }

    cancelTokenization();
    set({ isResyncing: true });

    try {
      const dirHandle = targetNode.handle as FileSystemDirectoryHandle;
      const hasPermission = await verifyDirectoryPermission(dirHandle);
      if (!hasPermission) throw new Error('NO_PERMISSION');

      const skipPredicate = globalSettings.pruneIgnoredOnRead
        ? (name: string, relativePath: string, isDirectory: boolean) => {
            if (isPathGloballyIgnored(relativePath, globalSettings.ignoredPaths)) return true;
            if (!isDirectory && globalSettings.ignoredExtensions.includes(getFileExtension(name))) return true;
            if (get().gitignoreRegexes.some(rx => rx.test(relativePath))) return true;
            return false;
          }
        : undefined;

      const rawChildren = await readDirectoryRecursively(
        dirHandle,
        undefined,
        undefined,
        skipPredicate,
        { count: 0 },
        targetNode.relativePath,
        targetNode.depth + 1,
        targetNode.id
      );

      const freshlyScannedSubtree: FileNode[] = [
        { ...targetNode, handle: dirHandle },
        ...rawChildren
      ];

      const { reconciledNodes, dirtyNodeIds, deletedNodeIds, stats } = reconcileFileTree({
        oldNodes: get().nodes,
        newScannedNodes: freshlyScannedSubtree,
        targetSubtreeRootPath: targetNode.relativePath,
        globalSettings,
        localFilters: get().localFilters,
        gitignoreRegexes: get().gitignoreRegexes,
        compiledCustomRegexes: get().compiledCustomRegexes
      });

      get().pruneAndInvalidateTokens(deletedNodeIds, dirtyNodeIds);

      const currentPreview = get().previewNode;
      if (currentPreview) {
        if (deletedNodeIds.has(currentPreview.id)) {
          set({ previewNode: null });
        } else {
          const updatedPreview = reconciledNodes.find(n => n.id === currentPreview.id);
          if (updatedPreview) set({ previewNode: updatedPreview });
        }
      }

      const extMap = buildExtMap(reconciledNodes, globalSettings, get().localFilters.extensions);

      const hasCsFiles = reconciledNodes.some(n => !n.isDirectory && n.name.toLowerCase().endsWith('.cs'));
      const currentCsChoice = get().localFilters?.enableCSharpAnalysis ?? true;
      const finalEnableCSharp = hasCsFiles ? currentCsChoice : false;

      const nextState = {
        ...get(),
        nodes: reconciledNodes,
        localFilters: {
          ...get().localFilters,
          extensions: extMap,
          enableCSharpAnalysis: finalEnableCSharp
        },
        isResyncing: false,
      };

      set({ ...nextState, ...recompileAndRecalculate(nextState) });
      get().evaluateTokenization();

      return stats;
    } catch (error) {
      set({ isResyncing: false });
      throw error;
    }
  },

  loadFromIdeSync: async (port: string, token: string) => {
    if (get().isLoading) throw new Error('ALREADY_LOADING');
    
    get().cancelTokenization();
    
    set({ 
      isLoading: true, 
      scannedFilesCount: 0, 
      previewNode: null, 
      sessionFileName: null,
      realTokenMap: {},
      optimizedBytesMap: {},
      needsManualTokenization: false,
      sourceMode: 'ide-sync',
      rootHandle: null,
    });

    try {
      const payload = await IdeSyncService.fetchContext(port, token);
      const { projectName, files } = payload;
      
      const rawNodes: FileNode[] = [];
      const dirMap = new Map<string, FileNode>();
      
      const rootId = crypto.randomUUID();
      const rootNode: FileNode = {
        id: rootId,
        name: projectName || 'project',
        relativePath: projectName || 'project',
        isDirectory: true,
        sizeBytes: 0,
        handle: null,
        depth: 0,
        parentId: null,
        isSelected: true,
        isIgnored: false,
        isGloballyIgnored: false,
        isLocallyIgnored: false,
        isExpanded: true,
      };
      
      rawNodes.push(rootNode);
      dirMap.set('', rootNode);

      files.forEach((file) => {
        const parts = file.path.split('/');
        const fileName = parts.pop()!;
        
        let currentPath = '';
        let parentId: string = rootId;
        let depth = 1;

        for (const part of parts) {
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          
          if (!dirMap.has(currentPath)) {
            const dirNode: FileNode = {
              id: crypto.randomUUID(),
              name: part,
              relativePath: currentPath,
              isDirectory: true,
              sizeBytes: 0,
              handle: null,
              depth,
              parentId,
              isSelected: true,
              isIgnored: false,
              isGloballyIgnored: false,
              isLocallyIgnored: false,
              isExpanded: false,
            };
            rawNodes.push(dirNode);
            dirMap.set(currentPath, dirNode);
          }
          parentId = dirMap.get(currentPath)!.id;
          depth++;
        }

        rawNodes.push({
          id: crypto.randomUUID(),
          name: fileName,
          relativePath: file.path,
          isDirectory: false,
          sizeBytes: file.size,
          handle: null,
          content: file.content,
          depth,
          parentId,
          isSelected: true,
          isIgnored: false,
          isGloballyIgnored: false,
          isLocallyIgnored: false,
          isExpanded: false,
        });
      });

      set({ scannedFilesCount: rawNodes.length });

      const activeGlobalSettings = get().globalSettings;
      const extMap = buildExtMap(rawNodes, activeGlobalSettings, {});
      
      const hasCsFiles = rawNodes.some(n => !n.isDirectory && n.name.toLowerCase().endsWith('.cs'));
      const currentChoice = get().localFilters?.enableCSharpAnalysis ?? true;
      const finalEnableCSharp = hasCsFiles ? currentChoice : false;

      const initialState = { 
        ...get(),
        syncProjectName: projectName || 'project',
        gitignoreRegexes: [],
        isRestoredFromProfile: false,
        localFilters: {
          ...get().localFilters,
          extensions: extMap,
          enableCSharpAnalysis: finalEnableCSharp
        },
        nodes: rawNodes,
        isLoading: false,
        activeTab: 'tree' as const
      };

      set({ ...initialState, ...recompileAndRecalculate(initialState) });
      get().evaluateTokenization();

    } catch (error) {
      set({ isLoading: false, scannedFilesCount: 0, sourceMode: 'browser-fs' });
      throw error;
    }
  },

  loadDirectory: async () => {
    if (get().isLoading) throw new Error('ALREADY_LOADING');
    const handle = await requestDirectoryAccess();
    await get().loadDirectoryFromHandle(handle, undefined, false);
  },

  loadDirectoryFromHandle: async (handle, applyProfile, isRestored = false) => {
    if (get().isLoading) throw new Error('ALREADY_LOADING');
    
    get().cancelTokenization();
    const controller = new AbortController();
    
    set({ 
      isLoading: true, 
      scannedFilesCount: 0, 
      previewNode: null, 
      sessionFileName: null,
      abortController: controller,
      realTokenMap: {},
      optimizedBytesMap: {},
      needsManualTokenization: false,
      sourceMode: 'browser-fs',
      syncProjectName: null
    });
    
    try {
      const hasPermission = await verifyDirectoryPermission(handle);
      if (!hasPermission) throw new Error('NO_PERMISSION');

      let activeGlobalSettings = get().globalSettings;
      if (applyProfile) {
        activeGlobalSettings = { ...DEFAULT_GLOBAL_SETTINGS, ...applyProfile.settings };
        set({ globalSettings: activeGlobalSettings });
        saveGlobalSettings(activeGlobalSettings);
      }

      let gitRegexes: RegExp[] = [];
      if (activeGlobalSettings.useGitignore) {
        try {
          const gitignoreHandle = await handle.getFileHandle('.gitignore');
          const file = await gitignoreHandle.getFile();
          gitRegexes = createIgnoreRegexes(await file.text());
        } catch {
          // Ігноруємо, якщо .gitignore відсутній
        }
      }

      const skipPredicate = activeGlobalSettings.pruneIgnoredOnRead
        ? (name: string, relativePath: string, isDirectory: boolean) => {
            if (isPathGloballyIgnored(relativePath, activeGlobalSettings.ignoredPaths)) return true;
            if (!isDirectory && activeGlobalSettings.ignoredExtensions.includes(getFileExtension(name))) return true;
            if (gitRegexes.some(rx => rx.test(relativePath))) return true;
            return false;
          }
        : undefined;

      const rootId = crypto.randomUUID();
      const rootNode: FileNode = {
        id: rootId,
        name: handle.name,
        relativePath: handle.name,
        isDirectory: true,
        sizeBytes: 0,
        handle,
        depth: 0,
        parentId: null,
        isSelected: true,
        isIgnored: false,
        isGloballyIgnored: false,
        isLocallyIgnored: false,
        isExpanded: true,
      };

      const rawChildren = await readDirectoryRecursively(
        handle, 
        (count) => set({ scannedFilesCount: count }),
        controller.signal,
        skipPredicate,
        { count: 0 },
        handle.name,
        1,
        rootId
      );

      const rawNodes = [rootNode, ...rawChildren];
      const extMap = buildExtMap(rawNodes, activeGlobalSettings, {});
      
      const hasCsFiles = rawNodes.some(n => !n.isDirectory && n.name.toLowerCase().endsWith('.cs'));

      let localFiltersToApply: Partial<LocalFilters> = {};
      if (applyProfile) {
        const savedFilters = applyProfile.localFilters;

        Object.keys(extMap).forEach(ext => {
          extMap[ext].isActive = !savedFilters.hiddenExtensions.includes(ext);
        });

        localFiltersToApply = {
          customPatterns: savedFilters.customPatterns,
          showGloballyIgnored: savedFilters.showGloballyIgnored ?? false,
          showLocallyIgnored: savedFilters.showLocallyIgnored ?? true,
          showEmptyFolders: savedFilters.showEmptyFolders ?? false,
          generateTree: savedFilters.generateTree ?? true,
          treeIncludeIgnored: savedFilters.treeIncludeIgnored ?? false,
          isOptimizationEnabled: savedFilters.isOptimizationEnabled ?? false,
          isOptimizationDirty: savedFilters.isOptimizationDirty ?? false,
          optimizationRules: savedFilters.optimizationRules ?? PREDEFINED_OPTIMIZATION_RULES,
          enableCSharpAnalysis: hasCsFiles ? (savedFilters.enableCSharpAnalysis ?? true) : false
        };
      }

      const currentChoice = get().localFilters?.enableCSharpAnalysis ?? true;
      const finalEnableCSharp = hasCsFiles ? (localFiltersToApply.enableCSharpAnalysis ?? currentChoice) : false;

      const initialState = { 
        ...get(),
        rootHandle: handle,
        gitignoreRegexes: gitRegexes,
        isRestoredFromProfile: isRestored,
        localFilters: {
          extensions: extMap,
          customPatterns: localFiltersToApply.customPatterns ?? [],
          showGloballyIgnored: localFiltersToApply.showGloballyIgnored ?? false,
          showLocallyIgnored: localFiltersToApply.showLocallyIgnored ?? true,
          showEmptyFolders: localFiltersToApply.showEmptyFolders ?? false,
          generateTree: localFiltersToApply.generateTree ?? true,
          treeIncludeIgnored: localFiltersToApply.treeIncludeIgnored ?? false,
          isOptimizationEnabled: localFiltersToApply.isOptimizationEnabled ?? false,
          isOptimizationDirty: localFiltersToApply.isOptimizationDirty ?? false,
          optimizationRules: localFiltersToApply.optimizationRules ?? PREDEFINED_OPTIMIZATION_RULES,
          enableCSharpAnalysis: finalEnableCSharp
        },
        nodes: rawNodes,
        isLoading: false,
        abortController: null,
        activeTab: 'tree' as const
      };

      set({ ...initialState, ...recompileAndRecalculate(initialState) });
      get().evaluateTokenization();

    } catch (error) {
      set({ isLoading: false, scannedFilesCount: 0, abortController: null });
      if (error instanceof Error && error.message === 'Scanning cancelled') throw new Error('CANCELLED');
      throw error;
    }
  }
});