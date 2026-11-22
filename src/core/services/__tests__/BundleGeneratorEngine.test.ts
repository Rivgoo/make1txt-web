import { describe, it, expect, vi } from 'vitest';
import { runBundleGeneration } from '../BundleGeneratorEngine';
import { treeSitterCSharpRuntime } from '../csharp/TreeSitterCSharpRuntime';
import { DEFAULT_CSHARP_COMPRESSION_OPTIONS } from '@/core/constants/csharp-compression.constants';
import { optimizeText } from '@/core/utils/optimization.utils';
import { PREDEFINED_OPTIMIZATION_RULES } from '@/core/constants/optimization.constants';

describe('BundleGeneratorEngine & Optimization Pipeline', () => {
  it('parses each .cs file exactly ONCE when both CSharpAnalysis and C# AST Compression are active', async () => {
    const parseSpy = vi.spyOn(treeSitterCSharpRuntime, 'parse');

    const csContent = `
using System;
namespace Demo {
  public class Fighter {
    // Strip this comment
    public void Attack(int dmg) {
      int x = dmg * 2;
      Console.WriteLine(x);
    }
  }
}`;

    const res = await runBundleGeneration({
      files: [
        {
          handle: null,
          path: 'Assets/Fighter.cs',
          content: csContent,
          outputMode: 'full',
          csharpCompressionLevel: 'compact',
        },
      ],
      template: '{{path}}\n{{content}}',
      maxFileSizeBytes: 1024 * 1024,
      enableCSharpAnalysis: true,
      isCSharpCompressionEnabled: true,
      csharpCompressionOptions: DEFAULT_CSHARP_COMPRESSION_OPTIONS,
    });

    expect(parseSpy).toHaveBeenCalledTimes(1);
    parseSpy.mockRestore();

    const text = await res.blob.text();
    expect(text).toContain('public class Fighter');
    expect(text).not.toContain('Strip this comment');
    expect(res.metaMap['Assets/Fighter.cs']).toContain('Classes: Fighter');
  });

  it('fixes F1 previewDiff byte-count bug so optimizedBytes matches non-preview optimizedBytes', () => {
    const src = 'int a = 1; // short\nint b = 2;\n';
    const rules = PREDEFINED_OPTIMIZATION_RULES.map((r) =>
      r.id === 'opt-c-line' ? { ...r, isActive: true } : r
    );

    const normal = optimizeText(src, rules, false);
    const preview = optimizeText(src, rules, true);

    expect(preview.optimizedBytes).toBe(normal.optimizedBytes);
    expect(preview.optimizedBytes).toBeLessThan(preview.originalBytes);
    expect(preview.optimizedText).toContain('<span class="diff-removed">// short</span>');
  });
});
