import type { OptimizationRule } from './optimization.types';

export interface FileSystemHandle {
  readonly kind: 'file' | 'directory';
  readonly name: string;
}

export interface FileNode {
  id: string;
  name: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number;
  handle: FileSystemHandle | null;
  content?: string;
  depth: number;
  parentId: string | null;
  isSelected: boolean;
  isIgnored: boolean;
  isGloballyIgnored: boolean;
  isLocallyIgnored: boolean;
  isExpanded: boolean;
}

export interface IdeSyncPayload {
  projectName: string;
  files: {
    path: string;
    content: string;
    size: number;
  }[];
}

export interface GeneratorStats {
  totalFiles: number;
  selectedFiles: number;
  totalSizeBytes: number;
  totalOptimizedBytes: number;
  totalWords: number;
  baseTokens: number;
  tokens: number;
  isExactTokens: boolean;
}

export interface TreeSymbols {
  branch: string;
  last: string;
  vertical: string;
  space: string;
  ignoredSuffix: string;
}

export type SaveStrategy = 'default' | 'ask';
export type FileDelimiterFormat = 'markdown' | 'classic' | 'custom';

export interface GlobalSettings {
  language: 'auto' | 'en' | 'uk';
  maxFileSizeKb: number;
  ignoredExtensions: string[];
  ignoredPaths: string[];
  useGitignore: boolean;
  pruneIgnoredOnRead: boolean;
  fileDelimiterFormat: FileDelimiterFormat;
  outputTemplate: string;
  treePlacement: 'top' | 'bottom';
  treeWrapper: string;
  treeSymbols: TreeSymbols;
  saveStrategy: SaveStrategy;
  fileNameTemplate: string;
}

export interface CustomPattern {
  id: string;
  pattern: string;
  isActive: boolean;
}

export interface ExtensionStat {
  count: number;
  isActive: boolean;
}

export interface LocalFilters {
  extensions: Record<string, ExtensionStat>;
  customPatterns: CustomPattern[];
  showGloballyIgnored: boolean;
  showLocallyIgnored: boolean;
  showEmptyFolders: boolean;
  generateTree: boolean;
  treeIncludeIgnored: boolean;
  isOptimizationEnabled: boolean;
  isOptimizationDirty: boolean;
  optimizationRules: OptimizationRule[];
  enableCSharpAnalysis: boolean;
}

export interface SavedLocalFilters {
  hiddenExtensions: string[];
  customPatterns: CustomPattern[];
  showGloballyIgnored: boolean;
  showLocallyIgnored: boolean;
  showEmptyFolders: boolean;
  generateTree: boolean;
  treeIncludeIgnored: boolean;
  isOptimizationEnabled: boolean;
  isOptimizationDirty?: boolean;
  optimizationRules: OptimizationRule[];
  enableCSharpAnalysis?: boolean;
}

export interface Profile {
  id: string;
  name: string;
  lastUsed: number;
  directoryHandle?: FileSystemDirectoryHandle;
  directoryName?: string;
  settings: GlobalSettings;
  localFilters: SavedLocalFilters;
}

export interface SubtreeSyncResult {
  addedCount: number;
  updatedCount: number;
  deletedCount: number;
  affectedBytes: number;
}

export interface ReconcileOptions {
  oldNodes: FileNode[];
  newScannedNodes: FileNode[];
  targetSubtreeRootPath?: string;
  globalSettings: GlobalSettings;
  localFilters: LocalFilters;
  gitignoreRegexes: RegExp[];
  compiledCustomRegexes: RegExp[];
}

export interface ReconciledTreeOutput {
  reconciledNodes: FileNode[];
  dirtyNodeIds: Set<string>;
  deletedNodeIds: Set<string>;
  stats: SubtreeSyncResult;
}
