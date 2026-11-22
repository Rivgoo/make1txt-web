import type {
  FileNode,
  GlobalSettings,
  LocalFilters,
  ExtensionStat,
  OutputMode,
  OutputModeSource,
} from '@/core/types/file.types';
import { isPathGloballyIgnored, compileGlobToRegex } from '@/core/services/IgnoreService';
import { getFileExtension } from '@/core/utils/stats.utils';

export interface NodeComputeContext {
  nodes: FileNode[];
  globalSettings: GlobalSettings;
  localFilters: LocalFilters;
  gitignoreRegexes: RegExp[];
  compiledCustomRegexes: RegExp[];
}

export function buildExtMap(
  nodes: FileNode[], 
  settings: GlobalSettings, 
  oldExtMap: Record<string, ExtensionStat>
): Record<string, ExtensionStat> {
  const newExtMap: Record<string, ExtensionStat> = {};
  
  for (const node of nodes) {
    if (node.isDirectory) continue;

    const ext = getFileExtension(node.name);
    const isGloballyIgnoredPath = isPathGloballyIgnored(node.relativePath, settings.ignoredPaths);
    const isGloballyIgnoredExt = settings.ignoredExtensions.includes(ext);
    
    if (!isGloballyIgnoredPath && !isGloballyIgnoredExt) {
      if (!newExtMap[ext]) {
        newExtMap[ext] = { count: 0, isActive: oldExtMap[ext]?.isActive ?? true };
      }
      newExtMap[ext].count++;
    }
  }
  
  return newExtMap;
}

export function computeNodes(
  state: NodeComputeContext, 
  forceSelectExt?: string, 
  forceSelectAllExts?: boolean
): FileNode[] {
  const { globalSettings, localFilters, gitignoreRegexes, compiledCustomRegexes } = state;
  const globallyIgnoredDirIds = new Set<string>();
  const locallyIgnoredDirIds = new Set<string>();
  const overrides = localFilters.outputModeOverrides ?? {};
  const resolvedModeMap = new Map<string, { mode: OutputMode; anchorPath: string | null }>();

  return state.nodes.map(node => {
    let isGloballyIgnored = false;
    let isLocallyIgnored = false;

    if (node.parentId) {
      if (globallyIgnoredDirIds.has(node.parentId)) isGloballyIgnored = true;
      if (locallyIgnoredDirIds.has(node.parentId)) isLocallyIgnored = true;
    }

    if (!isGloballyIgnored) {
      if (isPathGloballyIgnored(node.relativePath, globalSettings.ignoredPaths)) {
        isGloballyIgnored = true;
      }
      if (!node.isDirectory && globalSettings.maxFileSizeKb > 0 && node.sizeBytes > globalSettings.maxFileSizeKb * 1024) {
        isGloballyIgnored = true;
      }
      if (!node.isDirectory && globalSettings.ignoredExtensions.includes(getFileExtension(node.name))) {
        isGloballyIgnored = true;
      }
      if (gitignoreRegexes.some(rx => rx.test(node.relativePath))) {
        isGloballyIgnored = true;
      }
    }

    if (!isLocallyIgnored) {
      if (compiledCustomRegexes.some(rx => rx.test(node.relativePath))) {
        isLocallyIgnored = true;
      }
      if (!node.isDirectory) {
        const ext = getFileExtension(node.name);
        const extStat = localFilters.extensions[ext];
        if (extStat && !extStat.isActive) {
          isLocallyIgnored = true;
        }
      }
    }

    if (node.isDirectory) {
      if (isGloballyIgnored) globallyIgnoredDirIds.add(node.id);
      if (isLocallyIgnored) locallyIgnoredDirIds.add(node.id);
    }

    const isIgnored = isGloballyIgnored || isLocallyIgnored;
    let isSelected = node.isSelected;
    
    if (isIgnored) {
      isSelected = false;
    } else if (!node.isDirectory) {
      const ext = getFileExtension(node.name);
      if (forceSelectAllExts) {
        isSelected = true;
      } else if (forceSelectExt === ext) {
        isSelected = true;
      }
    }

    // O(N) top-down longest-prefix outputMode resolution
    const parentModeState = node.parentId
      ? (resolvedModeMap.get(node.parentId) ?? { mode: 'full' as OutputMode, anchorPath: null })
      : { mode: 'full' as OutputMode, anchorPath: null };

    const directOverride = overrides[node.relativePath];
    let outputMode: OutputMode;
    let outputModeSource: OutputModeSource;
    let outputModeAnchorPath: string | null;

    if (directOverride !== undefined) {
      outputMode = directOverride;
      outputModeSource = 'direct';
      outputModeAnchorPath = node.relativePath;
    } else {
      outputMode = parentModeState.mode;
      outputModeSource = parentModeState.anchorPath ? 'inherited' : 'default';
      outputModeAnchorPath = parentModeState.anchorPath;
    }

    if (node.isDirectory) {
      resolvedModeMap.set(node.id, { mode: outputMode, anchorPath: outputModeAnchorPath });
    }

    return {
      ...node,
      isGloballyIgnored,
      isLocallyIgnored,
      isIgnored,
      isSelected,
      outputMode,
      outputModeSource,
      outputModeAnchorPath,
    };
  });
}

export function recompileAndRecalculate(state: NodeComputeContext): { compiledCustomRegexes: RegExp[]; nodes: FileNode[] } {
  const activePatterns = state.localFilters.customPatterns.filter(p => p.isActive);
  const compiled = activePatterns.map(p => compileGlobToRegex(p.pattern));
  
  const tempState: NodeComputeContext = { ...state, compiledCustomRegexes: compiled };
  
  return { 
    compiledCustomRegexes: compiled,
    nodes: computeNodes(tempState) 
  };
}