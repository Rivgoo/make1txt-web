import type { OptimizationRule } from './optimization.types';
import type { OutputMode } from './file.types';
import type {
  CSharpCompressionLevel,
  CSharpCompressionOptions,
} from './csharp-compression.types';

export interface GeneratorFileItem {
  handle: FileSystemFileHandle | null;
  path: string;
  content?: string;
  outputMode: OutputMode;
  csharpCompressionLevel: CSharpCompressionLevel;
}

export interface WorkerInput {
  files: GeneratorFileItem[];
  template: string;
  maxFileSizeBytes: number;
  isOptimizationEnabled?: boolean;
  optimizationRules?: OptimizationRule[];
  isCSharpCompressionEnabled?: boolean;
  csharpCompressionOptions?: CSharpCompressionOptions;
  enableCSharpAnalysis?: boolean;
}

export type WorkerOutput =
  | { type: 'progress'; progress: number }
  | { type: 'done'; blob: Blob; metaMap?: Record<string, string> }
  | { type: 'error'; error: string };

export interface BaseFileMetrics {
  bytes: number;
  exactTokens: number | null;
}

export interface OptimizedFileMetrics {
  configHash: string;
  bytes: number;
  exactTokens: number | null;
}

export interface TokenizerFileItem {
  id: string;
  path: string;
  handle: FileSystemFileHandle | null;
  content?: string;
  sizeBytes: number;
  effectiveConfigHash: string;
  csharpCompressionLevel: CSharpCompressionLevel;
  needsBaseBytes: boolean;
  needsBaseTokens: boolean;
  needsOptBytes: boolean;
  needsOptTokens: boolean;
}

export interface TokenizerInput {
  runId: number;
  files: TokenizerFileItem[];
  isOptimizationEnabled: boolean;
  optimizationRules: OptimizationRule[];
  isCSharpCompressionEnabled: boolean;
  csharpCompressionOptions: CSharpCompressionOptions;
}

export interface TokenizerFileResult {
  configHash: string;
  baseBytes?: number;
  baseExactTokens?: number | null;
  optBytes?: number;
  optExactTokens?: number | null;
}

export type TokenizerOutput =
  | { type: 'chunk'; runId: number; progress: number; results: Record<string, TokenizerFileResult> }
  | { type: 'done'; runId: number }
  | { type: 'error'; runId: number; error: string };
