import type { FullSyntaxNode } from '../TreeSitterCSharpRuntime';
import type { TextEdit } from '../EditEngine';
import type { CSharpCompressionConfig } from '@/core/types/csharp-compression.types';
import { STANDARD_SYSTEM_USING_PREFIXES } from '@/core/constants/csharp-compression.constants';
import { expandLineDeletionEnd } from './astHelpers';

function isStandardSystemUsing(usingText: string): boolean {
  // Extract namespace after `using` and before `;`
  const match = usingText.match(/^using\s+([A-Za-z0-9_.]+)\s*;/);
  if (!match) return false;
  const ns = match[1];
  return STANDARD_SYSTEM_USING_PREFIXES.some(
    (prefix) => ns === prefix || ns.startsWith(`${prefix}.`)
  );
}

function walkNode(
  node: FullSyntaxNode,
  source: string,
  config: CSharpCompressionConfig,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  const { level, options } = config;

  // T02: Strip #region / #endregion / #pragma / #nullable
  if (
    node.type === 'preproc_region' ||
    node.type === 'preproc_endregion' ||
    node.type === 'preproc_pragma'
  ) {
    edits.push({
      start: node.startIndex,
      end: expandLineDeletionEnd(source, node.startIndex, node.endIndex),
      replacement: '',
      priority: 30,
      kind: 'delete',
      ruleId: 'T02',
    });
    transformsApplied.add('T02');
    return;
  }

  if (node.type === 'preproc_nullable') {
    const isDisable = node.text.includes('disable');
    if (level !== 'clean' || !isDisable) {
      edits.push({
        start: node.startIndex,
        end: expandLineDeletionEnd(source, node.startIndex, node.endIndex),
        replacement: '',
        priority: 30,
        kind: 'delete',
        ruleId: 'T02',
      });
      transformsApplied.add('T02');
    }
    return;
  }

  // T10: Using directive filtering (L2 - L4)
  if (node.type === 'using_directive' && level !== 'clean') {
    if (node.hasError) return;

    const hasGlobal = node.children.some((c) => c.type === 'global' || c.text === 'global');
    const hasAlias = node.children.some((c) => c.type === 'name_equals' || c.text === '=');
    const hasStatic = node.children.some((c) => c.type === 'static' || c.text === 'static');

    // Always preserve global usings and type aliases
    if (hasGlobal || hasAlias) return;

    // Preserve `using static` in L2 & L3; strip in L4
    if (hasStatic && level !== 'contract') return;

    const shouldStrip =
      level === 'contract' ||
      !options.preserveProjectUsings ||
      isStandardSystemUsing(node.text.trim());

    if (shouldStrip) {
      edits.push({
        start: node.startIndex,
        end: expandLineDeletionEnd(source, node.startIndex, node.endIndex),
        replacement: '',
        priority: 25,
        kind: 'delete',
        ruleId: 'T10',
      });
      transformsApplied.add('T10');
    }
    return;
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkNode(child, source, config, edits, transformsApplied);
  }
}

/**
 * Pass 1.2 & 1.3: Preprocessor Cleaner (#region/#pragma/#nullable) & Using Directive Filter (T02, T10).
 */
export function runPreprocessorAndUsingsPass(
  root: FullSyntaxNode,
  source: string,
  config: CSharpCompressionConfig,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  if (config.level === 'none') return;
  walkNode(root, source, config, edits, transformsApplied);
}
