import type { FileNode, OutputMode } from '../types/file.types';
import {
  setHierarchicalOverride,
  pruneOrphanedOverrides,
} from './hierarchical-override.utils';

/**
 * Sets or clears an output mode override for `targetPath` and canonicalizes
 * the override map so no redundant self or descendant overrides remain.
 */
export function setOutputModeOverride(
  currentOverrides: Record<string, OutputMode>,
  targetPath: string,
  desiredMode: OutputMode
): Record<string, OutputMode> {
  return setHierarchicalOverride(currentOverrides, targetPath, desiredMode, 'full');
}

/**
 * Removes any outputModeOverrides keys whose relativePath no longer exists in `nodes`.
 */
export function pruneOrphanedOutputOverrides(
  currentOverrides: Record<string, OutputMode>,
  nodes: FileNode[]
): Record<string, OutputMode> {
  const existingPaths = new Set(nodes.map((n) => n.relativePath));
  return pruneOrphanedOverrides(currentOverrides, existingPaths);
}
