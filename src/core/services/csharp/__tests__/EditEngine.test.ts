import { describe, it, expect } from 'vitest';
import { applyLaminarEdits, buildDiffHtmlFromEdits, type TextEdit } from '../EditEngine';

describe('EditEngine — Laminar Span Edit Algebra', () => {
  it('returns original text when edits array is empty', () => {
    const src = 'public class Foo {}';
    const res = applyLaminarEdits(src, []);
    expect(res.text).toBe(src);
    expect(res.appliedEdits).toEqual([]);
  });

  it('applies disjoint and adjacent edits cleanly', () => {
    const src = 'public class Foo { int x = 1; }';
    const edits: TextEdit[] = [
      { start: 0, end: 7, replacement: '', priority: 1, kind: 'delete', ruleId: 'T11' },
      { start: 19, end: 22, replacement: 'var', priority: 1, kind: 'replace', ruleId: 'T08' },
    ];
    const res = applyLaminarEdits(src, edits);
    expect(res.text).toBe('class Foo { var x = 1; }');
    expect(res.appliedEdits).toHaveLength(2);
  });

  it('subsumes inner edits when outer edit contains them', () => {
    const src = 'void M() { Debug.Log("hi"); return; }';
    const outer: TextEdit = {
      start: 9,
      end: 37,
      replacement: '{ /* ... */ }',
      priority: 10,
      kind: 'elide',
      ruleId: 'T15',
    };
    const inner: TextEdit = {
      start: 11,
      end: 27,
      replacement: '',
      priority: 50,
      kind: 'delete',
      ruleId: 'T13',
    };
    const res = applyLaminarEdits(src, [inner, outer]);
    expect(res.text).toBe('void M() { /* ... */ }');
    expect(res.appliedEdits).toHaveLength(1);
    expect(res.appliedEdits[0].ruleId).toBe('T15');
  });

  it('breaks ties on identical bounds by priority DESC', () => {
    const src = 'private int x;';
    const low: TextEdit = {
      start: 0,
      end: 8,
      replacement: '/*low*/',
      priority: 1,
      kind: 'replace',
      ruleId: 'low',
    };
    const high: TextEdit = {
      start: 0,
      end: 8,
      replacement: '',
      priority: 10,
      kind: 'delete',
      ruleId: 'high',
    };
    const res = applyLaminarEdits(src, [low, high]);
    expect(res.text).toBe('int x;');
    expect(res.appliedEdits).toHaveLength(1);
    expect(res.appliedEdits[0].ruleId).toBe('high');
  });

  it('handles UTF-16 surrogate pairs (emojis) and Cyrillic comments accurately', () => {
    const src = '// Привіт 🔥\npublic class Test { string s = "🔥"; }';
    const commentEnd = src.indexOf('\n') + 1;
    const edits: TextEdit[] = [
      { start: 0, end: commentEnd, replacement: '', priority: 1, kind: 'delete', ruleId: 'T03' },
    ];
    const res = applyLaminarEdits(src, edits);
    expect(res.text).toBe('public class Test { string s = "🔥"; }');
  });

  it('builds diff HTML with escaped HTML and diff classes', () => {
    const src = 'List<int> x = new List<int>();';
    const edits: TextEdit[] = [
      { start: 14, end: 29, replacement: 'new()', priority: 1, kind: 'replace', ruleId: 'T08' },
    ];
    const html = buildDiffHtmlFromEdits(src, edits);
    expect(html).toContain('List&lt;int&gt; x = ');
    expect(html).toContain('<span class="diff-removed">new List&lt;int&gt;()</span>');
    expect(html).toContain('<span class="diff-added">new()</span>');
  });
});
