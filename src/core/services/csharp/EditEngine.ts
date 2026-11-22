export type EditKind = 'delete' | 'replace' | 'elide';

export interface TextEdit {
  start: number;          // UTF-16 inclusive start index
  end: number;            // UTF-16 exclusive end index
  replacement: string;
  priority: number;       // Higher wins on identical [start, end)
  kind: EditKind;
  ruleId: string;
}

export interface AppliedEditResult {
  text: string;
  appliedEdits: TextEdit[];
}

/**
 * Resolves and applies a laminar family of CST-derived text edits in O(n + |E| log |E|).
 * Outer containing edits subsume inner edits; ties on identical bounds are broken by priority DESC.
 */
export function applyLaminarEdits(source: string, rawEdits: TextEdit[]): AppliedEditResult {
  if (rawEdits.length === 0) {
    return { text: source, appliedEdits: [] };
  }

  // 1. Sort: start ASC, end DESC (outer before inner), priority DESC
  const sorted = [...rawEdits].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return b.end - a.end;
    return b.priority - a.priority;
  });

  // 2. Single-pass sweep: discard any edit subsumed by or overlapping the last accepted edit
  const accepted: TextEdit[] = [];
  let cursor = -1;

  for (const edit of sorted) {
    const start = Math.max(0, Math.min(edit.start, source.length));
    const end = Math.max(start, Math.min(edit.end, source.length));

    // If start < cursor, this edit is contained inside (or partially collides with) an outer edit -> skip
    if (start < cursor) continue;

    // If two pure insertions (start === end) happen at the same cursor, keep only the highest-priority one
    if (start === end && accepted.length > 0) {
      const prev = accepted[accepted.length - 1];
      if (prev.start === start && prev.end === end) continue;
    }

    accepted.push({ ...edit, start, end });
    cursor = end;
  }

  // 3. Linear-time O(n) string assembly via chunk array
  const parts: string[] = [];
  let pos = 0;

  for (const edit of accepted) {
    if (edit.start > pos) {
      parts.push(source.slice(pos, edit.start));
    }
    if (edit.replacement.length > 0) {
      parts.push(edit.replacement);
    }
    pos = edit.end;
  }

  if (pos < source.length) {
    parts.push(source.slice(pos));
  }

  return { text: parts.join(''), appliedEdits: accepted };
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Builds an HTML diff view directly from applied laminar edits in O(n + |E|).
 * Highlights deleted/elided original spans in `.diff-removed` and replacements in `.diff-added`.
 */
export function buildDiffHtmlFromEdits(
  source: string,
  appliedEdits: Array<Pick<TextEdit, 'start' | 'end' | 'replacement' | 'kind'>>
): string {
  if (appliedEdits.length === 0) {
    return escapeHtml(source);
  }

  const parts: string[] = [];
  let pos = 0;

  for (const edit of appliedEdits) {
    const start = Math.max(pos, Math.min(edit.start, source.length));
    const end = Math.max(start, Math.min(edit.end, source.length));

    if (start > pos) {
      parts.push(escapeHtml(source.slice(pos, start)));
    }

    const removedText = source.slice(start, end);
    if (removedText.length > 0) {
      parts.push(`<span class="diff-removed">${escapeHtml(removedText)}</span>`);
    }
    if (edit.replacement.length > 0) {
      const cls = edit.kind === 'elide' ? 'diff-elided' : 'diff-added';
      parts.push(`<span class="${cls}">${escapeHtml(edit.replacement)}</span>`);
    }

    pos = end;
  }

  if (pos < source.length) {
    parts.push(escapeHtml(source.slice(pos)));
  }

  return parts.join('');
}
