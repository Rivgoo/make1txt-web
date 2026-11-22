import type { FileNode, TreeSymbols } from '../types/file.types';

interface TreeOptions {
  includeIgnored: boolean;
  symbols: TreeSymbols;
  showEmptyFolders: boolean;
  metaMap?: Record<string, string>;
}

export function generateTextTree(nodes: FileNode[], options: TreeOptions): string {
  const { includeIgnored, symbols, showEmptyFolders, metaMap } = options;
  
  let validNodes = includeIgnored 
    ? nodes 
    : nodes.filter(n => n.isSelected && !n.isIgnored);
    
  if (validNodes.length === 0) return '';

  if (!showEmptyFolders) {
    const parentMap = new Map<string, string | null>();
    for (const node of validNodes) {
      parentMap.set(node.id, node.parentId);
    }

    const dirHasFiles = new Set<string>();
    for (const node of validNodes) {
      if (!node.isDirectory) {
        let currentParent = node.parentId;
        while (currentParent && !dirHasFiles.has(currentParent)) {
          dirHasFiles.add(currentParent);
          currentParent = parentMap.get(currentParent) || null;
        }
      }
    }

    validNodes = validNodes.filter(n => !n.isDirectory || dirHasFiles.has(n.id));
  }

  if (validNodes.length === 0) return '';

  const childrenMap = new Map<string | null, FileNode[]>();
  
  for (const node of validNodes) {
    const parentId = node.parentId;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId)!.push(node);
  }

  for (const list of childrenMap.values()) {
    list.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name);
      }
      return a.isDirectory ? -1 : 1;
    });
  }

  let output = '';

  function traverse(parentId: string | null, prefix: string, isAbsoluteRoot = false) {
    const children = childrenMap.get(parentId) || [];
    
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const isLast = i === children.length - 1;
      
      const suffix = child.isDirectory ? '/' : '';
      
      const isSkipped = child.isIgnored || !child.isSelected;
      const ignoredMark = isSkipped ? symbols.ignoredSuffix : '';

      const structureOnlyMark =
        child.isDirectory &&
        child.outputMode === 'structure-only' &&
        child.outputModeSource === 'direct' &&
        !isSkipped
          ? (symbols.structureOnlySuffix ?? ' (structure-only)')
          : '';

      const fullOverrideMark =
        child.isDirectory &&
        child.outputMode === 'full' &&
        child.outputModeSource === 'direct' &&
        !isSkipped
          ? ' (full)'
          : '';
      
      // Inject C# metadata into the tree structure if present
      const metaString = (!child.isDirectory && metaMap && metaMap[child.relativePath]) 
        ? metaMap[child.relativePath] 
        : '';
      
      if (isAbsoluteRoot) {
        output += `${child.name}${suffix}${ignoredMark}${structureOnlyMark}${fullOverrideMark}${metaString}\n`;
        if (child.isDirectory) {
          traverse(child.id, prefix);
        }
      } else {
        const pointer = isLast ? symbols.last : symbols.branch;
        output += `${prefix}${pointer}${child.name}${suffix}${ignoredMark}${structureOnlyMark}${fullOverrideMark}${metaString}\n`;
        
        if (child.isDirectory) {
          const extension = isLast ? symbols.space : symbols.vertical;
          traverse(child.id, prefix + extension);
        }
      }
    }
  }

  traverse(null, '', true);
  return output;
}