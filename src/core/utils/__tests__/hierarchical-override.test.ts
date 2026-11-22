import { describe, it, expect } from 'vitest';
import {
  setHierarchicalOverride,
  clearHierarchicalOverride,
  canonicalizeOverrideMap,
  pruneOrphanedOverrides,
  getInheritedValue,
} from '../hierarchical-override.utils';

describe('hierarchical-override.utils', () => {
  it('maintains canonical minimality when setting overrides equal to inherited parent', () => {
    let map: Record<string, string> = {};
    map = setHierarchicalOverride(map, 'Assets/Scripts', 'skeleton', 'compact');
    expect(map).toEqual({ 'Assets/Scripts': 'skeleton' });

    // Setting child to same value as parent ('skeleton') should NOT store a redundant entry
    map = setHierarchicalOverride(map, 'Assets/Scripts/UI', 'skeleton', 'compact');
    expect(map).toEqual({ 'Assets/Scripts': 'skeleton' });

    // Setting child to a different value stores it
    map = setHierarchicalOverride(map, 'Assets/Scripts/UI', 'clean', 'compact');
    expect(map).toEqual({
      'Assets/Scripts': 'skeleton',
      'Assets/Scripts/UI': 'clean',
    });

    // Changing parent to 'clean' prunes the now-redundant child 'Assets/Scripts/UI'
    map = setHierarchicalOverride(map, 'Assets/Scripts', 'clean', 'compact');
    expect(map).toEqual({ 'Assets/Scripts': 'clean' });
  });

  it('clears override and canonicalizes descendants', () => {
    const initial: Record<string, string> = {
      'Assets/Scripts': 'skeleton',
      'Assets/Scripts/Core': 'compact',
    };
    const next = clearHierarchicalOverride(initial, 'Assets/Scripts', 'compact');
    // 'Assets/Scripts/Core' was 'compact' which now equals default 'compact', so it is pruned
    expect(next).toEqual({});
  });

  it('canonicalizes override map when project default changes', () => {
    const initial: Record<string, string> = {
      'Assets/UI': 'skeleton',
      'Assets/Core': 'clean',
      'Assets/Core/Math': 'skeleton',
    };
    const next = canonicalizeOverrideMap(initial, 'skeleton');
    expect(next).toEqual({
      'Assets/Core': 'clean',
      'Assets/Core/Math': 'skeleton',
    });
  });

  it('resolves inherited value from closest ancestor', () => {
    const map = {
      'A': 'clean',
      'A/B': 'skeleton',
    };
    expect(getInheritedValue(map, 'A/B/C/File.cs', 'compact')).toBe('skeleton');
    expect(getInheritedValue(map, 'A/Other/File.cs', 'compact')).toBe('clean');
    expect(getInheritedValue(map, 'Root.cs', 'compact')).toBe('compact');
  });

  it('prunes orphaned overrides', () => {
    const map = { 'A/Keep': 'clean', 'A/Gone': 'skeleton' };
    const next = pruneOrphanedOverrides(map, new Set(['A/Keep']));
    expect(next).toEqual({ 'A/Keep': 'clean' });
  });
});
