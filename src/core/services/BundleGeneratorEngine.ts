import type { WorkerInput } from '../types/worker.types';
import { optimizeText } from '../utils/optimization.utils';
import { csharpAnalyzer, type FileMetaData } from './CSharpAnalyzer';

const MAX_PARSE_SIZE = 5 * 1024 * 1024; // 5 MB
const textEncoder = new TextEncoder();

export interface BundleGenerationParams extends WorkerInput {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  fileErrorTemplate?: string;
}

export interface BundleGenerationResult {
  blob: Blob;
  metaMap: Record<string, string>;
}

export async function runBundleGeneration(
  params: BundleGenerationParams
): Promise<BundleGenerationResult> {
  const {
    files,
    template,
    maxFileSizeBytes,
    isOptimizationEnabled,
    optimizationRules,
    enableCSharpAnalysis,
    onProgress,
    signal,
    fileErrorTemplate = '[Error reading file: {{path}}]',
  } = params;

  if (files.length === 0) {
    return {
      blob: new Blob([], { type: 'text/plain;charset=utf-8' }),
      metaMap: {},
    };
  }

  // Lazy-init C# Tree-sitter WASM only if at least one selected .cs file exists (full OR structure-only)
  if (enableCSharpAnalysis && files.some((f) => f.path.toLowerCase().endsWith('.cs'))) {
    try {
      await csharpAnalyzer.init();
    } catch (err) {
      console.warn('[BundleEngine] CSharpAnalyzer init failed; continuing without AST meta.', err);
    }
  }

  const fileTextCache = new Map<string, Blob>();
  const fileMetaCache = new Map<string, FileMetaData>();
  const asmdefMetaCache = new Map<string, string>();
  const globalTypeRegistry = new Set<string>();

  const totalSteps = files.length * 2;
  let processed = 0;

  // PASS 1: Read, AST Index, Cache Full Bodies
  for (const item of files) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const isStructureOnly = item.outputMode === 'structure-only';
    const lowerPath = item.path.toLowerCase();
    const isCSharp = lowerPath.endsWith('.cs');
    const isAsmdef = lowerPath.endsWith('.asmdef');

    // FAST PATH: Non-analyzed files in structure-only mode require ZERO disk I/O
    if (isStructureOnly && (!enableCSharpAnalysis || (!isCSharp && !isAsmdef))) {
      processed++;
      if (processed % 10 === 0) {
        onProgress?.(Math.round((processed / totalSteps) * 100));
        await new Promise((r) => setTimeout(r, 0));
      }
      continue;
    }

    try {
      let rawText = '';
      let size = 0;

      if (item.content !== undefined) {
        rawText = item.content;
        size = textEncoder.encode(rawText).byteLength;
      } else if (item.handle) {
        const file = await item.handle.getFile();
        size = file.size;
        if (maxFileSizeBytes <= 0 || size <= maxFileSizeBytes) {
          rawText = await file.text();
        }
      }

      const exceedsLimit = maxFileSizeBytes > 0 && size > maxFileSizeBytes;

      if (exceedsLimit) {
        if (!isStructureOnly) {
          fileTextCache.set(
            item.path,
            new Blob([`[Skipped — file exceeds size limit: ${item.path}]\n`], {
              type: 'text/plain;charset=utf-8',
            })
          );
        }
      } else {
        // 1. AST / .asmdef Meta-Analysis on RAW text (immune to destructive custom regexes)
        if (enableCSharpAnalysis && isCSharp && size <= MAX_PARSE_SIZE) {
          const meta = csharpAnalyzer.parseFile(rawText);
          if (meta) {
            meta.classes.forEach((c) => globalTypeRegistry.add(c.name));
            meta.interfaces.forEach((i) => globalTypeRegistry.add(i.name));
            meta.structs.forEach((s) => globalTypeRegistry.add(s.name));
            meta.records.forEach((r) => globalTypeRegistry.add(r.name));
            meta.enums.forEach((e) => globalTypeRegistry.add(e));
            meta.delegates.forEach((d) => globalTypeRegistry.add(d));
            fileMetaCache.set(item.path, meta);
          }
        } else if (enableCSharpAnalysis && isAsmdef) {
          try {
            const cleanJson = rawText.replace(
              /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
              (m, g) => (g ? '' : m)
            );
            const parsed = JSON.parse(cleanJson);
            const modName = parsed.name || 'Unknown';
            const rawRefs: string[] = parsed.references || [];
            const cleanRefs = rawRefs
              .filter((r) => !r.startsWith('GUID:'))
              .map((r) => r.split('/').pop() || r);
            let asmdefMeta = `Module: ${modName}`;
            if (cleanRefs.length > 0) asmdefMeta += ` ✦ Refs: ${cleanRefs.join(', ')}`;
            asmdefMetaCache.set(item.path, ` -> [ ${asmdefMeta} ]`);
          } catch {
            console.warn(`[BundleEngine] Failed to parse asmdef: ${item.path}`);
          }
        }

        // 2. Optimize & Cache Body ONLY for 'full' files (0 RAM retained for structure-only)
        if (!isStructureOnly) {
          const bodyText =
            isOptimizationEnabled && optimizationRules && optimizationRules.length > 0
              ? optimizeText(rawText, optimizationRules).optimizedText
              : rawText;
          fileTextCache.set(
            item.path,
            new Blob([bodyText], { type: 'text/plain;charset=utf-8' })
          );
        }
      }
    } catch (err) {
      console.warn(`[BundleEngine] Error reading ${item.path}:`, err);
      if (!isStructureOnly) {
        const msg = fileErrorTemplate.replace(/\{\{path\}\}/g, () => item.path) + '\n';
        fileTextCache.set(item.path, new Blob([msg], { type: 'text/plain;charset=utf-8' }));
      }
    }

    processed++;
    if (processed % 10 === 0) {
      onProgress?.(Math.round((processed / totalSteps) * 100));
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // PASS 2: Format MetaMap & Emit Full Bodies Only
  const chunks: Blob[] = [];
  const formattedMetaMap: Record<string, string> = {};

  for (const item of files) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    if (enableCSharpAnalysis) {
      if (fileMetaCache.has(item.path)) {
        const metaStr = csharpAnalyzer.formatTreeMetaData(
          fileMetaCache.get(item.path)!,
          globalTypeRegistry
        );
        if (metaStr) formattedMetaMap[item.path] = metaStr;
      } else if (asmdefMetaCache.has(item.path)) {
        formattedMetaMap[item.path] = asmdefMetaCache.get(item.path)!;
      }
    }

    // Suppress source body for structure-only files
    if (item.outputMode === 'full') {
      const cachedBlob = fileTextCache.get(item.path);
      if (cachedBlob) {
        const text = await cachedBlob.text();
        const extMatch = item.path.match(/\.([^.]+)$/);
        const fileExt = extMatch ? extMatch[1].toLowerCase() : '';

        // Function replacers avoid $&, $', $`, $$ substitution corruption
        const finalBlock = template
          .replace(/\{\{path\}\}/g, () => item.path)
          .replace(/\{\{ext\}\}/g, () => fileExt)
          .replace(/\{\{content\}\}/g, () => text);

        chunks.push(new Blob([finalBlock], { type: 'text/plain;charset=utf-8' }));
      }
    }

    processed++;
    if (processed % 10 === 0) {
      onProgress?.(Math.round((processed / totalSteps) * 100));
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.(100);
  return {
    blob: new Blob(chunks, { type: 'text/plain;charset=utf-8' }),
    metaMap: formattedMetaMap,
  };
}
