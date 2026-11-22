import type { FileNode, OutputMode } from '../types/file.types';

/**
 * Sets or clears an output mode override for `targetPath` and canonicalizes
 * the override map so no redundant self or descendant overrides remain.
 */
export function setOutputModeOverride(
  currentOverrides: Record<string, OutputMode>,
  targetPath: string,
  desiredMode: OutputMode
): Record<string, OutputMode> {
  const next = { ...currentOverrides };

  // 1. Determine inherited mode from closest ancestor strictly above targetPath
  let parentMode: OutputMode = 'full';
  const parts = targetPath.split('/');
  parts.pop();
  while (parts.length > 0) {
    const ancestorPath = parts.join('/');
    if (next[ancestorPath] !== undefined) {
      parentMode = next[ancestorPath];
      break;
    }
    parts.pop();
  }

  // 2. Apply or prune self if redundant with parent
  if (desiredMode === parentMode) {
    delete next[targetPath];
  } else {
    next[targetPath] = desiredMode;
  }

  // 3. Canonicalize descendants: remove any child override now redundant with its new effective parent
  const prefix = `${targetPath}/`;
  const descendantPaths = Object.keys(next)
    .filter((k) => k.startsWith(prefix))
    .sort((a, b) => a.length - b.length); // Top-down order

  for (const descPath of descendantPaths) {
    const descMode = next[descPath];
    let effParent: OutputMode = 'full';
    const dParts = descPath.split('/');
    dParts.pop();
    while (dParts.length > 0) {
      const anc = dParts.join('/');
      if (next[anc] !== undefined) {
        effParent = next[anc];
        break;
      }
      dParts.pop();
    }
    if (descMode === effParent) {
      delete next[descPath];
    }
  }

  return next;
}

/**
 * Removes any outputModeOverrides keys whose relativePath no longer exists in `nodes`.
 */
export function pruneOrphanedOutputOverrides(
  currentOverrides: Record<string, OutputMode>,
  nodes: FileNode[]
): Record<string, OutputMode> {
  const existingPaths = new Set(nodes.map((n) => n.relativePath));
  let changed = false;
  const next: Record<string, OutputMode> = {};

  for (const [path, mode] of Object.entries(currentOverrides)) {
    if (existingPaths.has(path)) {
      next[path] = mode;
    } else {
      changed = true;
    }
  }

  return changed ? next : currentOverrides;
}
