/**
 * Generic hierarchical prefix override algebra.
 * Used for both OutputMode overrides and CSharpCompressionLevel overrides.
 */

export function getInheritedValue<T>(
  overrides: Record<string, T>,
  targetPath: string,
  defaultValue: T
): T {
  const parts = targetPath.split('/');
  parts.pop();
  while (parts.length > 0) {
    const ancestorPath = parts.join('/');
    if (overrides[ancestorPath] !== undefined) {
      return overrides[ancestorPath];
    }
    parts.pop();
  }
  return defaultValue;
}

export function canonicalizeDescendants<T>(
  overrides: Record<string, T>,
  targetPath: string,
  defaultValue: T
): Record<string, T> {
  const next = { ...overrides };
  const prefix = `${targetPath}/`;
  const descendantPaths = Object.keys(next)
    .filter((k) => k.startsWith(prefix))
    .sort((a, b) => a.length - b.length); // Top-down order

  for (const descPath of descendantPaths) {
    const descVal = next[descPath];
    const effParent = getInheritedValue(next, descPath, defaultValue);
    if (descVal === effParent) {
      delete next[descPath];
    }
  }
  return next;
}

export function setHierarchicalOverride<T>(
  currentOverrides: Record<string, T>,
  targetPath: string,
  desiredValue: T,
  defaultValue: T
): Record<string, T> {
  const next = { ...currentOverrides };
  const parentVal = getInheritedValue(next, targetPath, defaultValue);

  if (desiredValue === parentVal) {
    delete next[targetPath];
  } else {
    next[targetPath] = desiredValue;
  }

  return canonicalizeDescendants(next, targetPath, defaultValue);
}

export function clearHierarchicalOverride<T>(
  currentOverrides: Record<string, T>,
  targetPath: string,
  defaultValue: T
): Record<string, T> {
  if (currentOverrides[targetPath] === undefined) {
    return currentOverrides;
  }
  const next = { ...currentOverrides };
  delete next[targetPath];
  return canonicalizeDescendants(next, targetPath, defaultValue);
}

export function canonicalizeOverrideMap<T>(
  overrides: Record<string, T>,
  defaultValue: T
): Record<string, T> {
  const next = { ...overrides };
  const sortedPaths = Object.keys(next).sort((a, b) => a.length - b.length);
  for (const path of sortedPaths) {
    if (next[path] === getInheritedValue(next, path, defaultValue)) {
      delete next[path];
    }
  }
  return next;
}

export function pruneOrphanedOverrides<T>(
  currentOverrides: Record<string, T>,
  existingPaths: Set<string>
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};

  for (const [path, val] of Object.entries(currentOverrides)) {
    if (existingPaths.has(path)) {
      next[path] = val;
    } else {
      changed = true;
    }
  }

  return changed ? next : currentOverrides;
}
