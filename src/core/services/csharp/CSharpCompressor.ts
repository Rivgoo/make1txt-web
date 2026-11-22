import type {
  CSharpCompressionConfig,
  CSharpCompressionResult,
} from '@/core/types/csharp-compression.types';
import { treeSitterCSharpRuntime, type FullSyntaxTree } from './TreeSitterCSharpRuntime';
import { applyLaminarEdits, type TextEdit } from './EditEngine';
import { runCommentsAndDocsPass } from './passes/commentsAndDocs.pass';
import { runPreprocessorAndUsingsPass } from './passes/preprocessorAndUsings.pass';
import { runTypesAndMembersPass } from './passes/typesAndMembers.pass';
import { runExpressionsAndLogsPass } from './passes/expressionsAndLogs.pass';
import { runSkeletonAndContractPass } from './passes/skeletonAndContract.pass';
import { normalizeCSharpLayout } from './passes/layoutNormalizer.pass';

const textEncoder = new TextEncoder();

class CSharpCompressorService {
  /**
   * Parses `source` via the shared Tree-sitter runtime, compresses it, and frees the Tree.
   */
  compress(
    source: string,
    config: CSharpCompressionConfig,
    includeDiffSpans = false
  ): CSharpCompressionResult {
    const originalBytes = textEncoder.encode(source).byteLength;

    if (config.level === 'none' || !treeSitterCSharpRuntime.ready) {
      return {
        compressedText: source,
        originalBytes,
        compressedBytes: originalBytes,
        appliedLevel: config.level === 'none' ? 'none' : config.level,
        hadSyntaxErrors: false,
        transformsApplied: [],
      };
    }

    const tree = treeSitterCSharpRuntime.parse(source);
    if (!tree) {
      return {
        compressedText: source,
        originalBytes,
        compressedBytes: originalBytes,
        appliedLevel: config.level,
        hadSyntaxErrors: true,
        transformsApplied: [],
      };
    }

    try {
      return this.compressFromTree(tree, source, config, includeDiffSpans, originalBytes);
    } finally {
      tree.delete();
    }
  }

  /**
   * Compresses `source` using an already-parsed `FullSyntaxTree` (zero duplicate WASM parse).
   * Caller retains ownership of `tree` and is responsible for calling `tree.delete()`.
   */
  compressFromTree(
    tree: FullSyntaxTree,
    source: string,
    config: CSharpCompressionConfig,
    includeDiffSpans = false,
    precomputedOriginalBytes?: number
  ): CSharpCompressionResult {
    const originalBytes = precomputedOriginalBytes ?? textEncoder.encode(source).byteLength;

    if (config.level === 'none') {
      return {
        compressedText: source,
        originalBytes,
        compressedBytes: originalBytes,
        appliedLevel: 'none',
        hadSyntaxErrors: tree.rootNode.hasError,
        transformsApplied: [],
      };
    }

    const edits: TextEdit[] = [];
    const transformsApplied = new Set<string>();
    const root = tree.rootNode;

    // Pass 1: Semantic CST Visitors -> Emit TextEdit[]
    runCommentsAndDocsPass(root, source, config, edits, transformsApplied);
    runPreprocessorAndUsingsPass(root, source, config, edits, transformsApplied);
    runTypesAndMembersPass(root, source, config, edits, transformsApplied);
    runExpressionsAndLogsPass(root, source, config, edits, transformsApplied);
    runSkeletonAndContractPass(root, source, config, edits, transformsApplied);

    // Pass 2: Laminar Edit Resolution & Application
    const { text: s1, appliedEdits } = applyLaminarEdits(source, edits);

    // Pass 3: Preprocessor-Safe K&R Layout & Indentation Normalizer
    const compressedText = normalizeCSharpLayout(s1, config.options.indentSpaces);
    transformsApplied.add('T01');
    transformsApplied.add('T06');

    const compressedBytes = textEncoder.encode(compressedText).byteLength;

    return {
      compressedText,
      originalBytes,
      compressedBytes,
      appliedLevel: config.level,
      hadSyntaxErrors: root.hasError,
      transformsApplied: Array.from(transformsApplied).sort(),
      diffSpans: includeDiffSpans
        ? appliedEdits.map((e) => ({
            start: e.start,
            end: e.end,
            replacement: e.replacement,
            kind: e.kind,
          }))
        : undefined,
    };
  }
}

export const csharpCompressor = new CSharpCompressorService();
