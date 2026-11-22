import { describe, it, expect } from 'vitest';
import { computeFileEffectiveConfigHash } from '../optimization.utils';
import { DEFAULT_CSHARP_COMPRESSION_OPTIONS } from '@/core/constants/csharp-compression.constants';
import { PREDEFINED_OPTIMIZATION_RULES } from '@/core/constants/optimization.constants';

describe('Per-File Effective Config Hashing & Cache Isolation', () => {
  it('isolates hash changes to only affected .cs files and ignores non-.cs files', () => {
    const opts = DEFAULT_CSHARP_COMPRESSION_OPTIONS;
    const rules = PREDEFINED_OPTIMIZATION_RULES;

    const hashA1 = computeFileEffectiveConfigHash('Assets/UI/HUD.cs', false, rules, true, 'compact', opts);
    const hashB1 = computeFileEffectiveConfigHash('Assets/Core/Solver.cs', false, rules, true, 'compact', opts);
    const hashJson1 = computeFileEffectiveConfigHash('Assets/data.json', false, rules, true, 'compact', opts);

    expect(hashJson1).toBe('none');

    // Change only UI/HUD.cs to skeleton
    const hashA2 = computeFileEffectiveConfigHash('Assets/UI/HUD.cs', false, rules, true, 'skeleton', opts);
    const hashB2 = computeFileEffectiveConfigHash('Assets/Core/Solver.cs', false, rules, true, 'compact', opts);

    expect(hashA2).not.toBe(hashA1);
    expect(hashB2).toBe(hashB1); // Unchanged!
  });

  it('invalidates only L3 skeleton files when emitCallGraphStubsInSkeleton changes', () => {
    const opts1 = { ...DEFAULT_CSHARP_COMPRESSION_OPTIONS, emitCallGraphStubsInSkeleton: true };
    const opts2 = { ...DEFAULT_CSHARP_COMPRESSION_OPTIONS, emitCallGraphStubsInSkeleton: false };

    const l2Before = computeFileEffectiveConfigHash('A.cs', false, [], true, 'compact', opts1);
    const l2After = computeFileEffectiveConfigHash('A.cs', false, [], true, 'compact', opts2);
    expect(l2After).toBe(l2Before);

    const l3Before = computeFileEffectiveConfigHash('B.cs', false, [], true, 'skeleton', opts1);
    const l3After = computeFileEffectiveConfigHash('B.cs', false, [], true, 'skeleton', opts2);
    expect(l3After).not.toBe(l3Before);
  });

  it('bypasses predefined C-comment regexes on .cs files when AST compression is active, while keeping custom regexes', () => {
    const opts = DEFAULT_CSHARP_COMPRESSION_OPTIONS;
    const rulesWithPredefined = PREDEFINED_OPTIMIZATION_RULES.map((r) =>
      r.id === 'opt-c-line' ? { ...r, isActive: true } : r
    );
    const rulesWithCustom = [
      ...rulesWithPredefined,
      {
        id: 'custom-1',
        name: 'Strip foo',
        category: 'custom' as const,
        isActive: true,
        isPredefined: false,
        pattern: 'foo',
        flags: 'g',
        replacement: '',
      },
    ];

    const hNoRegex = computeFileEffectiveConfigHash('A.cs', false, [], true, 'compact', opts);
    const hPredefinedOnly = computeFileEffectiveConfigHash('A.cs', true, rulesWithPredefined, true, 'compact', opts);
    const hWithCustom = computeFileEffectiveConfigHash('A.cs', true, rulesWithCustom, true, 'compact', opts);

    expect(hPredefinedOnly).toBe(hNoRegex);
    expect(hWithCustom).not.toBe(hNoRegex);
  });
});
