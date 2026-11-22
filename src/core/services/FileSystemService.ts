import type { FileNode } from '../types/file.types';

const MAX_DEPTH = 100;

export async function requestDirectoryAccess(): Promise<FileSystemDirectoryHandle> {
  try {
    return await window.showDirectoryPicker({ mode: 'read' });
  } catch {
    throw new Error('CANCELLED');
  }
}

export async function verifyDirectoryPermission(
  directoryHandle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const permission = await directoryHandle.queryPermission({ mode: 'read' });
  if (permission === 'granted') return true;

  const result = await directoryHandle.requestPermission({ mode: 'read' });
  return result === 'granted';
}

interface ScanState {
  count: number;
}

type SkipPredicate = (
  name: string,
  relativePath: string,
  isDirectory: boolean,
) => boolean;

export async function readDirectoryRecursively(
  directoryHandle: FileSystemDirectoryHandle,
  onProgress?: (count: number) => void,
  signal?: AbortSignal,
  skipPredicate?: SkipPredicate,
  state: ScanState = { count: 0 },
  currentPath = '',
  depth = 0,
  parentId: string | null = null,
): Promise<FileNode[]> {
  if (depth > MAX_DEPTH) return [];

  const nodes: FileNode[] = [];
  const entries: FileSystemHandle[] = [];

  for await (const entry of directoryHandle.values()) {
    if (signal?.aborted) throw new Error('Scanning cancelled');
    entries.push(entry);
  }

  entries.sort((a, b) => {
    if (a.kind === b.kind) return a.name.localeCompare(b.name);
    return a.kind === 'directory' ? -1 : 1;
  });

  for (const entry of entries) {
    if (signal?.aborted) throw new Error('Scanning cancelled');

    const relativePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    const isDirectory = entry.kind === 'directory';

    if (skipPredicate?.(entry.name, relativePath, isDirectory)) continue;

    state.count++;

    if (state.count % 5 === 0) {
      onProgress?.(state.count);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const nodeId = crypto.randomUUID();

    if (isDirectory) {
      const dirHandle = entry as FileSystemDirectoryHandle;

      nodes.push({
        id: nodeId,
        name: entry.name,
        relativePath,
        isDirectory: true,
        sizeBytes: 0,
        handle: dirHandle,
        depth,
        parentId,
        isSelected: true,
        isIgnored: false,
        isGloballyIgnored: false,
        isLocallyIgnored: false,
        isExpanded: false,
        outputMode: 'full',
        outputModeSource: 'default',
        outputModeAnchorPath: null,
      });

      const children = await readDirectoryRecursively(
        dirHandle,
        onProgress,
        signal,
        skipPredicate,
        state,
        relativePath,
        depth + 1,
        nodeId,
      );
      nodes.push(...children);
    } else {
      const fileHandle = entry as FileSystemFileHandle;
      const file = await fileHandle.getFile();

      nodes.push({
        id: nodeId,
        name: entry.name,
        relativePath,
        isDirectory: false,
        sizeBytes: file.size,
        handle: fileHandle,
        depth,
        parentId,
        isSelected: true,
        isIgnored: false,
        isGloballyIgnored: false,
        isLocallyIgnored: false,
        isExpanded: false,
        outputMode: 'full',
        outputModeSource: 'default',
        outputModeAnchorPath: null,
      });
    }
  }

  return nodes;
}