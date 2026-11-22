import type { FullSyntaxNode } from '../TreeSitterCSharpRuntime';
import type { TextEdit } from '../EditEngine';
import type { CSharpCompressionConfig } from '@/core/types/csharp-compression.types';
import { expandLineDeletionEnd } from './astHelpers';

const TODO_MARKER_REGEX = /\b(TODO|FIXME|HACK|INVARIANT|SAFETY)\b/i;

function collectCommentNodes(node: FullSyntaxNode, out: FullSyntaxNode[]): void {
  if (node.type === 'comment') {
    out.push(node);
    return;
  }
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) collectCommentNodes(c, out);
  }
}

function cleanXmlProse(raw: string): string {
  return raw
    .replace(/<see\s+cref="([^"]+)"\s*\/>/gi, '$1')
    .replace(/<see\s+langword="([^"]+)"\s*\/>/gi, '$1')
    .replace(/<paramref\s+name="([^"]+)"\s*\/>/gi, '$1')
    .replace(/<typeparamref\s+name="([^"]+)"\s*\/>/gi, '$1')
    .replace(/<c>([\s\S]*?)<\/c>/gi, '$1')
    .replace(/<code>([\s\S]*?)<\/code>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function condenseXmlDocBlock(lines: string[]): string {
  const joined = lines
    .map((l) => l.trim().replace(/^\/\/\/\s?/, ''))
    .join(' ')
    .trim();

  if (!joined) return '';

  const segments: string[] = [];

  const summaryMatch = joined.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch) {
    const s = cleanXmlProse(summaryMatch[1]);
    if (s) segments.push(s);
  }

  const paramRegex = /<param\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/param>/gi;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = paramRegex.exec(joined)) !== null) {
    const desc = cleanXmlProse(pMatch[2]);
    if (desc) segments.push(`@${pMatch[1]}: ${desc}`);
  }

  const returnsMatch = joined.match(/<returns>([\s\S]*?)<\/returns>/i);
  if (returnsMatch) {
    const r = cleanXmlProse(returnsMatch[1]);
    if (r) segments.push(`-> ${r}`);
  }

  const excRegex = /<exception\s+cref="([^"]+)"[^>]*>([\s\S]*?)<\/exception>/gi;
  let eMatch: RegExpExecArray | null;
  while ((eMatch = excRegex.exec(joined)) !== null) {
    const desc = cleanXmlProse(eMatch[2]);
    if (desc) segments.push(`!${eMatch[1]}: ${desc}`);
  }

  if (segments.length === 0) {
    // Fallback: strip all XML tags from joined text
    const fallback = cleanXmlProse(joined);
    return fallback ? `/// ${fallback}` : '';
  }

  return `/// ${segments.join(' ')}`;
}

/**
 * Pass 1.1: Comment & XML Documentation Condenser / Stripper (T03, T04).
 */
export function runCommentsAndDocsPass(
  root: FullSyntaxNode,
  source: string,
  config: CSharpCompressionConfig,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  const { level, options } = config;
  if (level === 'none') return;

  const comments: FullSyntaxNode[] = [];
  collectCommentNodes(root, comments);
  if (comments.length === 0) return;

  let i = 0;
  while (i < comments.length) {
    const curr = comments[i];
    const trimmed = curr.text.trimStart();

    if (trimmed.startsWith('///')) {
      // Group consecutive XML doc comment nodes separated only by whitespace/newlines
      const group: FullSyntaxNode[] = [curr];
      let j = i + 1;
      while (j < comments.length) {
        const next = comments[j];
        if (!next.text.trimStart().startsWith('///')) break;
        const gap = source.slice(group[group.length - 1].endIndex, next.startIndex);
        if (gap.trim() !== '') break;
        group.push(next);
        j++;
      }

      const first = group[0];
      const last = group[group.length - 1];

      if (level === 'clean') {
        const condensed = condenseXmlDocBlock(group.map((g) => g.text));
        if (condensed) {
          edits.push({
            start: first.startIndex,
            end: last.endIndex,
            replacement: condensed,
            priority: 20,
            kind: 'replace',
            ruleId: 'T04',
          });
        } else {
          edits.push({
            start: first.startIndex,
            end: expandLineDeletionEnd(source, first.startIndex, last.endIndex),
            replacement: '',
            priority: 20,
            kind: 'delete',
            ruleId: 'T04',
          });
        }
        transformsApplied.add('T04');
      } else {
        // L2 - L4: Strip XML docs completely
        edits.push({
          start: first.startIndex,
          end: expandLineDeletionEnd(source, first.startIndex, last.endIndex),
          replacement: '',
          priority: 20,
          kind: 'delete',
          ruleId: 'T04',
        });
        transformsApplied.add('T04');
      }

      i = j;
      continue;
    }

    // Regular // or /* */ comment
    const shouldKeepTodo =
      options.preserveTodoComments &&
      (level === 'clean' || level === 'compact') &&
      TODO_MARKER_REGEX.test(curr.text);

    if (!shouldKeepTodo) {
      edits.push({
        start: curr.startIndex,
        end: expandLineDeletionEnd(source, curr.startIndex, curr.endIndex),
        replacement: '',
        priority: 15,
        kind: 'delete',
        ruleId: 'T03',
      });
      transformsApplied.add('T03');
    }

    i++;
  }
}
