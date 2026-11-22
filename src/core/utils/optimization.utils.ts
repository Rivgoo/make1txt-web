import type { OptimizationRule, OptimizationResult } from '../types/optimization.types';
import type {
  CSharpCompressionLevel,
  CSharpCompressionOptions,
} from '../types/csharp-compression.types';

const STRING_LITERAL_REGEX = '("([^"\\\\]|\\\\.)*"|\'([^\'\\\\]|\\\\.)*\'|`([^`\\\\]|\\\\.)*`)';

const textEncoder = new TextEncoder();

const AST_SUPERSEDED_PREDEFINED_RULE_IDS = new Set([
  'opt-c-line',
  'opt-c-block',
  'opt-csharp-xml',
  'opt-script-line',
  'opt-whitespace-empty',
]);

export function isCSharpFilePath(path: string): boolean {
  return path.toLowerCase().endsWith('.cs');
}

export function serializeRelevantCSharpOptions(
  level: CSharpCompressionLevel,
  options: CSharpCompressionOptions
): string {
  if (level === 'none') return '0';
  const parts: (string | number | boolean)[] = [options.indentSpaces];
  if (level === 'clean' || level === 'compact') {
    parts.push(options.preserveTodoComments);
  }
  if (level === 'compact') {
    parts.push(options.stripDiagnosticLogsInCompact);
  }
  if (level === 'compact' || level === 'skeleton') {
    parts.push(options.preserveProjectUsings);
  }
  if (level === 'skeleton') {
    parts.push(
      options.preserveUnityLifecycleMethods,
      options.emitCallGraphStubsInSkeleton,
      options.skeletonInlineStatementLimit
    );
  }
  if (level === 'contract') {
    parts.push(options.preserveUnitySerializedFields);
  }
  return parts.join(',');
}

export function getEffectiveRegexRulesForFile(
  path: string,
  isOptEnabled: boolean,
  rules: OptimizationRule[],
  isCSharpEnabled: boolean,
  csharpLevel: CSharpCompressionLevel
): OptimizationRule[] {
  if (!isOptEnabled) return [];
  const active = rules.filter((r) => r.isActive);
  if (active.length === 0) return [];

  if (isCSharpFilePath(path) && isCSharpEnabled && csharpLevel !== 'none') {
    return active.filter((r) => !AST_SUPERSEDED_PREDEFINED_RULE_IDS.has(r.id));
  }
  return active;
}

export function computeFileEffectiveConfigHash(
  path: string,
  isOptEnabled: boolean,
  rules: OptimizationRule[],
  isCSharpEnabled: boolean,
  csharpLevel: CSharpCompressionLevel,
  csharpOptions: CSharpCompressionOptions
): string {
  const isCsAstActive = isCSharpFilePath(path) && isCSharpEnabled && csharpLevel !== 'none';
  const csHash = isCsAstActive
    ? `cs:${csharpLevel}:${serializeRelevantCSharpOptions(csharpLevel, csharpOptions)}`
    : '0';

  const effRules = getEffectiveRegexRulesForFile(
    path,
    isOptEnabled,
    rules,
    isCSharpEnabled,
    csharpLevel
  );
  const regexHash =
    effRules.length > 0
      ? JSON.stringify(effRules.map((r) => [r.pattern, r.flags, r.replacement]))
      : '0';

  if (csHash === '0' && regexHash === '0') return 'none';
  return `${csHash}|${regexHash}`;
}

export function computeOptimizationHash(
  isEnabled: boolean,
  rules: OptimizationRule[]
): string {
  if (!isEnabled) return 'none';
  const active = rules.filter((r) => r.isActive);
  if (active.length === 0) return 'none';
  return JSON.stringify(
    active.map((r) => [r.pattern, r.flags, r.replacement])
  );
}

export function compileSafeRegex(rule: OptimizationRule): RegExp {
  const safePattern = `${STRING_LITERAL_REGEX}|(${rule.pattern})`;
  return new RegExp(safePattern, rule.flags);
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function optimizeText(
  text: string, 
  rules: OptimizationRule[], 
  previewDiff = false
): OptimizationResult {
  const activeRules = rules.filter(r => r.isActive);
  const originalBytes = textEncoder.encode(text).byteLength;

  if (activeRules.length === 0) {
    return {
      optimizedText: previewDiff ? escapeHtml(text) : text,
      originalBytes,
      optimizedBytes: originalBytes
    };
  }

  let processedText = text;
  const placeholders = new Map<string, string>();
  let pCounter = 0;

  for (const rule of activeRules) {
    try {
      const regex = compileSafeRegex(rule);
      processedText = processedText.replace(regex, (match, stringLiteralGroup) => {
        if (stringLiteralGroup !== undefined) {
          return match;
        }
        
        if (previewDiff) {
          const id = `__M1TXT_REMOVED_${pCounter++}__`;
          placeholders.set(id, match);
          return id + rule.replacement;
        }

        return rule.replacement;
      });
    } catch (err) {
      console.warn(`[Optimization] Failed to apply rule ${rule.name}:`, err);
    }
  }

  if (previewDiff) {
    let html = escapeHtml(processedText);
    placeholders.forEach((originalMatch, id) => {
      const escapedMatch = escapeHtml(originalMatch);
      html = html.replace(id, `<span class="diff-removed">${escapedMatch}</span>`);
    });

    const actualResult = optimizeText(text, activeRules, false);

    return {
      optimizedText: html,
      originalBytes,
      optimizedBytes: actualResult.optimizedBytes
    };
  }

  return {
    optimizedText: processedText,
    originalBytes,
    optimizedBytes: textEncoder.encode(processedText).byteLength
  };
}