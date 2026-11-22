import { getEncoding, type Tiktoken } from 'js-tiktoken';
import type { TokenizerInput, TokenizerOutput, TokenizerFileResult } from '../types/worker.types';
import {
  getEffectiveRegexRulesForFile,
  isCSharpFilePath,
  optimizeText,
} from '../utils/optimization.utils';
import { treeSitterCSharpRuntime } from '../services/csharp/TreeSitterCSharpRuntime';
import { csharpCompressor } from '../services/csharp/CSharpCompressor';

const CHUNK_SIZE = 20;
const MAX_PARSE_SIZE = 5 * 1024 * 1024; // 5 MB
const textEncoder = new TextEncoder();

// Persistent singleton encoder inside warm worker (avoids ~200ms BPE table reload per click)
let cachedEncoder: Tiktoken | null = null;
function getEncoder(): Tiktoken {
  if (!cachedEncoder) {
    cachedEncoder = getEncoding('cl100k_base');
  }
  return cachedEncoder;
}

self.onmessage = async (e: MessageEvent<TokenizerInput>) => {
  const {
    runId,
    files,
    isOptimizationEnabled,
    optimizationRules,
    isCSharpCompressionEnabled,
    csharpCompressionOptions,
  } = e.data;

  if (!files || files.length === 0) {
    self.postMessage({ type: 'done', runId } as TokenizerOutput);
    return;
  }

  try {
    const needsAnyTiktoken = files.some((f) => f.needsBaseTokens || f.needsOptTokens);
    const enc = needsAnyTiktoken ? getEncoder() : null;

    // Lazy-initialize Tree-sitter C# WASM ONLY when incoming batch has active .cs compression
    const needsCSharpWasm =
      isCSharpCompressionEnabled &&
      files.some(
        (f) =>
          (f.needsOptBytes || f.needsOptTokens) &&
          f.csharpCompressionLevel !== 'none' &&
          isCSharpFilePath(f.path)
      );

    if (needsCSharpWasm && !treeSitterCSharpRuntime.ready) {
      try {
        await treeSitterCSharpRuntime.init();
      } catch (err) {
        console.warn('[Tokenizer Worker] C# WASM init failed; falling back to regex/raw:', err);
      }
    }

    let batchResults: Record<string, TokenizerFileResult> = {};
    let processed = 0;

    for (const item of files) {
      const res: TokenizerFileResult = {
        configHash: item.effectiveConfigHash,
      };
      try {
        let rawText = '';
        let rawBytes = item.sizeBytes || 0;

        if (item.content !== undefined) {
          rawText = item.content;
          rawBytes = textEncoder.encode(rawText).byteLength;
        } else if (item.handle) {
          const file = await item.handle.getFile();
          rawText = await file.text();
          rawBytes = file.size;
        }

        if (item.needsBaseBytes) {
          res.baseBytes = rawBytes;
        }
        if (item.needsBaseTokens) {
          res.baseExactTokens = enc ? enc.encode(rawText).length : null;
        }

        if (item.needsOptBytes || item.needsOptTokens) {
          let workingText = rawText;
          let workingBytes = rawBytes;
          let wasTransformed = false;

          const shouldCompressCSharp =
            isCSharpCompressionEnabled &&
            item.csharpCompressionLevel !== 'none' &&
            isCSharpFilePath(item.path) &&
            rawBytes <= MAX_PARSE_SIZE &&
            treeSitterCSharpRuntime.ready;

          if (shouldCompressCSharp) {
            const csResult = csharpCompressor.compress(workingText, {
              level: item.csharpCompressionLevel,
              options: csharpCompressionOptions,
            });
            workingText = csResult.compressedText;
            workingBytes = csResult.compressedBytes;
            wasTransformed = true;
          }

          const effRules = getEffectiveRegexRulesForFile(
            item.path,
            isOptimizationEnabled,
            optimizationRules,
            isCSharpCompressionEnabled,
            item.csharpCompressionLevel
          );

          if (effRules.length > 0) {
            const optResult = optimizeText(workingText, effRules, false);
            workingText = optResult.optimizedText;
            workingBytes = optResult.optimizedBytes;
            wasTransformed = true;
          }

          if (wasTransformed) {
            if (item.needsOptBytes) res.optBytes = workingBytes;
            if (item.needsOptTokens) {
              res.optExactTokens = enc ? enc.encode(workingText).length : null;
            }
          } else {
            if (item.needsOptBytes) res.optBytes = rawBytes;
            if (item.needsOptTokens) {
              res.optExactTokens = res.baseExactTokens ?? (enc ? enc.encode(rawText).length : null);
            }
          }
        }
      } catch (err) {
        console.warn(`[Tokenizer Worker] Failed on ${item.id}:`, err);
        if (item.needsBaseBytes) res.baseBytes = 0;
        if (item.needsBaseTokens) res.baseExactTokens = 0;
        if (item.needsOptBytes) res.optBytes = 0;
        if (item.needsOptTokens) res.optExactTokens = 0;
      }

      batchResults[item.id] = res;
      processed++;

      if (processed % CHUNK_SIZE === 0 || processed === files.length) {
        const progress = Math.round((processed / files.length) * 100);
        self.postMessage({
          type: 'chunk',
          runId,
          progress,
          results: batchResults,
        } as TokenizerOutput);
        batchResults = {};
      }
    }

    self.postMessage({ type: 'done', runId } as TokenizerOutput);
  } catch (err) {
    self.postMessage({
      type: 'error',
      runId,
      error: err instanceof Error ? err.message : 'Tokenization failed',
    } as TokenizerOutput);
  }
};
