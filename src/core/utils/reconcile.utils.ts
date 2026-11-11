import type {
  FileNode,
  ReconcileOptions,
  ReconciledTreeOutput,
} from '@/core/types/file.types';
import { getFileExtension } from '@/core/utils/stats.utils';

export function reconcileFileTree(options: ReconcileOptions): ReconciledTreeOutput {
  const { oldNodes, newScannedNodes, targetSubtreeRootPath, localFilters } = options;

  const oldNodeMap = new Map<string, FileNode>();
  for (const node of oldNodes) {
    oldNodeMap.set(node.relativePath, node);
  }

  const newNodeMap = new Map<string, FileNode>();
  for (const node of newScannedNodes) {
    newNodeMap.set(node.relativePath, node);
  }

  const dirtyNodeIds = new Set<string>();
  const deletedNodeIds = new Set<string>();

  let addedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let affectedBytes = 0;

  // 1. Виявлення видалених файлів/папок у межах цільової області
  for (const [path, oldNode] of oldNodeMap.entries()) {
    if (targetSubtreeRootPath) {
      const isInSubtree = path === targetSubtreeRootPath || path.startsWith(`${targetSubtreeRootPath}/`);
      if (!isInSubtree) continue;
    }

    if (!newNodeMap.has(path)) {
      deletedNodeIds.add(oldNode.id);
      deletedCount++;
      affectedBytes += oldNode.sizeBytes;
    }
  }

  // 2. Побудова глобальної карти Path -> ID для детермінованого зв'язування батьків та дітей
  const pathToIdMap = new Map<string, string>();

  // Заповнюємо старими ID, щоб локальна синхронізація підпапки могла посилатися на незмінні батьківські папки
  for (const node of oldNodes) {
    pathToIdMap.set(node.relativePath, node.id);
  }

  // Для всіх відсканованих вузлів визначаємо їх фінальний стабільний ID
  for (const freshNode of newScannedNodes) {
    const existingNode = oldNodeMap.get(freshNode.relativePath);
    if (existingNode) {
      pathToIdMap.set(freshNode.relativePath, existingNode.id);
    } else {
      pathToIdMap.set(freshNode.relativePath, freshNode.id);
    }
  }

  // 3. Узгодження вузлів зі збереженням налаштувань, вибору користувача та точних parentId
  const reconciledSubtree: FileNode[] = [];

  for (const freshNode of newScannedNodes) {
    const existingNode = oldNodeMap.get(freshNode.relativePath);
    const finalId = pathToIdMap.get(freshNode.relativePath)!;

    // Детерміновано обчислюємо parentId за канонічним шляхом батька
    let finalParentId: string | null = null;
    if (freshNode.depth > 0) {
      const lastSlash = freshNode.relativePath.lastIndexOf('/');
      if (lastSlash !== -1) {
        const parentPath = freshNode.relativePath.slice(0, lastSlash);
        finalParentId = pathToIdMap.get(parentPath) ?? null;
      }
    }

    if (existingNode) {
      // Вузол існував раніше: зберігаємо вибір користувача, стан розкриття папки та ID
      const isContentChanged = !freshNode.isDirectory && freshNode.sizeBytes !== existingNode.sizeBytes;

      if (isContentChanged) {
        dirtyNodeIds.add(existingNode.id);
        updatedCount++;
        affectedBytes += Math.abs(freshNode.sizeBytes - existingNode.sizeBytes);
      }

      reconciledSubtree.push({
        ...freshNode,
        id: finalId,
        parentId: finalParentId,
        isExpanded: freshNode.isDirectory ? existingNode.isExpanded : false,
        isSelected: existingNode.isSelected, // Зберігаємо ручний вибір користувача
        isGloballyIgnored: existingNode.isGloballyIgnored,
        isLocallyIgnored: existingNode.isLocallyIgnored,
        isIgnored: existingNode.isIgnored,
      });
    } else {
      // Новий файл чи папка, додана на диску
      addedCount++;
      affectedBytes += freshNode.sizeBytes;
      dirtyNodeIds.add(finalId);

      // Успадкування вибору: якщо хоча б одна батьківська папка була вимкнена, новий файл також вимкнено
      let inheritedSelection = true;
      const parts = freshNode.relativePath.split('/');
      parts.pop();
      while (parts.length > 0) {
        const ancestorPath = parts.join('/');
        const ancestorOld = oldNodeMap.get(ancestorPath);
        if (ancestorOld && !ancestorOld.isSelected) {
          inheritedSelection = false;
          break;
        }
        parts.pop();
      }

      // Якщо розширення вимкнено у фільтрах, знімаємо виділення
      if (!freshNode.isDirectory && inheritedSelection) {
        const ext = getFileExtension(freshNode.name);
        if (localFilters.extensions[ext]?.isActive === false) {
          inheritedSelection = false;
        }
      }

      reconciledSubtree.push({
        ...freshNode,
        id: finalId,
        parentId: finalParentId,
        isSelected: inheritedSelection,
      });
    }
  }

  // 4. Формування фінального масиву зі збереженням чистої топологічної структури DFS
  let finalNodes: FileNode[] = [];

  if (targetSubtreeRootPath) {
    const isSubtreeNode = (n: FileNode) =>
      n.relativePath === targetSubtreeRootPath || n.relativePath.startsWith(`${targetSubtreeRootPath}/`);

    const firstIndex = oldNodes.findIndex(isSubtreeNode);
    if (firstIndex !== -1) {
      const before = oldNodes.slice(0, firstIndex).filter(n => !isSubtreeNode(n));
      const after = oldNodes.slice(firstIndex).filter(n => !isSubtreeNode(n));
      finalNodes = [...before, ...reconciledSubtree, ...after];
    } else {
      finalNodes = [...oldNodes.filter(n => !isSubtreeNode(n)), ...reconciledSubtree];
    }
  } else {
    // При повному скануванні newScannedNodes вже має ідеальний DFS-порядок від readDirectoryRecursively
    finalNodes = reconciledSubtree;
  }

  return {
    reconciledNodes: finalNodes,
    dirtyNodeIds,
    deletedNodeIds,
    stats: {
      addedCount,
      updatedCount,
      deletedCount,
      affectedBytes,
    },
  };
}