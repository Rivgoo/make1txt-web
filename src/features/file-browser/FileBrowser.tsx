import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  IconFolderOpen, IconLoader2, IconSearch, IconFileOff, 
  IconListTree, IconCode, IconChecks, IconSquareX, IconFiles, 
  IconSquareRoundedX, IconArrowsSort, IconAbc, IconWeight, 
  IconCpu, IconBan, IconSortAscendingLetters, IconSortDescendingLetters, 
  IconCodeAsterix, IconFilter, IconFolders, IconBrandGithub, IconRefresh
} from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button/Button';
import { VirtualList } from '@/shared/ui/VirtualList/VirtualList';
import { Select } from '@/shared/ui/Select/Select';
import type { SelectOption } from '@/shared/ui/Select/Select';
import { FileTreeNode } from './components/FileTreeNode';
import type { FolderStat } from '@/store/useFileStore';
import { FileContextMenu } from './components/FileContextMenu';
import { ResultViewer } from './components/ResultViewer';
import { FilePreview } from './components/FilePreview';
import { useFileStore } from '@/store/useFileStore';
import { useToast } from '@/shared/context/useToast';
import type { FileNode } from '@/core/types/file.types';
import { hasMeaningfulOptimization } from '@/core/utils/stats.utils';
import '../layout/Layout.css';
import './FileBrowser.css';

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  node: FileNode | null;
}

export function FileBrowser() {
  const { t } = useTranslation();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [isSortVisible, setIsSortVisible] = useState(false);
  
  const [sortBy, setSortBy] = useState<'none' | 'name' | 'size' | 'tokens'>('tokens');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [sortFolders, setSortFolders] = useState(true);
  const [sortRegex, setSortRegex] = useState('');

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ isOpen: false, x: 0, y: 0, node: null });
  
  const [previewHeight, setPreviewHeight] = useState(400);
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const resizeState = useRef({ startY: 0, startHeight: 0 });
  const isResizingRef = useRef(false);

  const { 
    nodes, isLoading, isResyncing, scannedFilesCount, loadDirectory, resyncWorkspace, cancelDirectoryLoad, toggleExpand, toggleSelection, 
    activeTab, setActiveTab, generatedText, selectAll, deselectAll, previewNode, setPreviewNode, localFilters,
    realTokenMap, optimizedBytesMap
  } = useFileStore();
  
  const { showToast } = useToast();

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      
      const deltaY = resizeState.current.startY - e.clientY;
      let newHeight = resizeState.current.startHeight + deltaY;
      
      if (newHeight < 60) newHeight = 60;
      
      setPreviewHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        setIsResizingPreview(false);
        
        setPreviewHeight((prev) => {
          if (prev <= 60) {
            setPreviewNode(null);
            return 400; 
          }
          return prev;
        });
      }
    };

    if (isResizingPreview) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingPreview, setPreviewNode]);

  const handlePreviewResizeStart = (e: React.MouseEvent) => {
    isResizingRef.current = true;
    setIsResizingPreview(true);
    resizeState.current = { startY: e.clientY, startHeight: previewHeight };
  };

  const handleSelectFolder = async () => {
    try {
      await loadDirectory();
      showToast('success', t('common.success'), t('browser.folderLoaded'));
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'CANCELLED') {
          showToast('warning', t('common.warning'), t('browser.scanCancelled'));
        } else if (error.message === 'ALREADY_LOADING') {
          showToast('warning', t('common.wait'), t('browser.alreadyLoading'));
        } else if (error.message === 'NO_PERMISSION') {
          showToast('error', t('common.error'), t('browser.noPermission'));
        } else {
          showToast('error', t('common.error'), error.message);
        }
      }
    }
  };

  const handleResyncWorkspace = async () => {
    try {
      const stats = await resyncWorkspace();
      const totalChanges = stats.addedCount + stats.updatedCount + stats.deletedCount;
      if (totalChanges > 0) {
        showToast(
          'success',
          t('common.success'),
          t('browser.resyncSuccess', {
            added: stats.addedCount,
            updated: stats.updatedCount,
            deleted: stats.deletedCount,
          })
        );
      } else {
        showToast('info', t('common.info'), t('browser.resyncNoChanges'));
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'ALREADY_LOADING') {
          showToast('warning', t('common.wait'), t('browser.alreadyLoading'));
        } else if (error.message === 'NO_PERMISSION') {
          showToast('error', t('common.error'), t('browser.noPermission'));
        } else if (error.message === 'NO_DIRECTORY_LOADED') {
          showToast('warning', t('common.warning'), t('browser.noDirectoryLoaded'));
        } else {
          showToast('error', t('common.error'), error.message || t('browser.resyncError'));
        }
      }
    }
  };

  const toggleSearch = () => {
    setIsSearchVisible(!isSearchVisible);
    if (isSortVisible) setIsSortVisible(false);
    if (isSearchVisible) setSearchTerm('');
  };

  const toggleSort = () => {
    setIsSortVisible(!isSortVisible);
    if (isSearchVisible) setIsSearchVisible(false);
  };

  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    setContextMenu({ isOpen: true, x: e.clientX, y: e.clientY, node });
  };

  const closeContextMenu = () => {
    setContextMenu(prev => ({ ...prev, isOpen: false }));
  };

  const folderStats = useMemo(() => {
    const stats: Record<string, FolderStat> = {};

    for (const node of nodes) {
      if (node.isDirectory) {
        stats[node.relativePath] = { 
          total: 0, 
          selected: 0, 
          absoluteTotal: 0, 
          sizeBytes: 0, 
          selectedSizeBytes: 0,
          selectedOptimizedBytes: 0,
          exactTokens: 0,
          optimizedFilesCount: 0
        };
      }
    }

    for (const node of nodes) {
      if (!node.isDirectory) {
        const parts = node.relativePath.split('/');
        parts.pop();
        
        let currentPath = '';
        for (const part of parts) {
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          if (stats[currentPath]) {
            stats[currentPath].absoluteTotal += 1;
            stats[currentPath].sizeBytes += node.sizeBytes;
            if (!node.isIgnored) {
              stats[currentPath].total += 1;
              if (node.isSelected) {
                stats[currentPath].selected += 1;
                stats[currentPath].selectedSizeBytes += node.sizeBytes;
                
                const optBytes = (optimizedBytesMap && optimizedBytesMap[node.id]) ?? node.sizeBytes;
                stats[currentPath].selectedOptimizedBytes += optBytes;
                
                if (localFilters?.isOptimizationEnabled && hasMeaningfulOptimization(node.sizeBytes, optBytes)) {
                  stats[currentPath].optimizedFilesCount += 1;
                }
                
                if (stats[currentPath].exactTokens !== undefined) {
                  if (realTokenMap && realTokenMap[node.id] !== undefined) {
                    stats[currentPath].exactTokens! += realTokenMap[node.id];
                  } else {
                    stats[currentPath].exactTokens = undefined;
                  }
                }
              }
            }
          }
        }
      }
    }

    return stats;
  }, [nodes, realTokenMap, optimizedBytesMap, localFilters?.isOptimizationEnabled]);

  const sortedAndFilteredNodes = useMemo(() => {
    const baseFiltered = nodes.filter(n => {
      if (n.isGloballyIgnored && !localFilters?.showGloballyIgnored) return false;
      if (n.isLocallyIgnored && !localFilters?.showLocallyIgnored) return false;
      return true;
    });

    const parentMap = new Map<string, string | null>();
    for (const node of baseFiltered) {
      parentMap.set(node.id, node.parentId);
    }

    let finalNodes = baseFiltered;
    if (searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase();
      const matchedNodes = new Set<string>();

      for (const node of baseFiltered) {
        if (node.name.toLowerCase().includes(lowerSearch)) {
          matchedNodes.add(node.id);
          let currentParent = node.parentId;
          while (currentParent && !matchedNodes.has(currentParent)) {
            matchedNodes.add(currentParent);
            currentParent = parentMap.get(currentParent) || null;
          }
        }
      }
      finalNodes = baseFiltered.filter(node => matchedNodes.has(node.id));
    }

    if (!localFilters?.showEmptyFolders) {
      const dirHasFiles = new Set<string>();
      for (const node of finalNodes) {
        if (!node.isDirectory) {
          let currentParent = node.parentId;
          while (currentParent && !dirHasFiles.has(currentParent)) {
            dirHasFiles.add(currentParent);
            currentParent = parentMap.get(currentParent) || null;
          }
        }
      }
      finalNodes = finalNodes.filter(n => !n.isDirectory || dirHasFiles.has(n.id));
    }

    const childrenMap = new Map<string | null, FileNode[]>();
    for (const node of finalNodes) {
      const pId = node.parentId;
      if (!childrenMap.has(pId)) childrenMap.set(pId, []);
      childrenMap.get(pId)!.push(node);
    }

    let validRegex: RegExp | null = null;
    if (sortRegex.trim()) {
      try { 
        validRegex = new RegExp(sortRegex.trim(), 'i'); 
      } catch {
        validRegex = null;
      }
    }

    for (const children of childrenMap.values()) {
      children.sort((a, b) => {
        if (validRegex) {
          const aMatch = validRegex.test(a.relativePath);
          const bMatch = validRegex.test(b.relativePath);
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
        }

        if (!sortFolders) {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
        }

        if (sortBy === 'none') {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        }

        let result = 0;
        if (sortBy === 'name') {
          result = a.name.localeCompare(b.name);
        } else {
          const valA = a.isDirectory ? (folderStats[a.relativePath]?.sizeBytes || 0) : a.sizeBytes;
          const valB = b.isDirectory ? (folderStats[b.relativePath]?.sizeBytes || 0) : b.sizeBytes;
          result = valA - valB;
          if (result === 0) result = a.name.localeCompare(b.name);
        }

        return sortDir === 'asc' ? result : -result;
      });
    }

    const result: FileNode[] = [];
    const hiddenPaths = new Set<string>();

    function traverse(parentId: string | null) {
      const children = childrenMap.get(parentId) || [];
      for (const child of children) {
        if (child.parentId && hiddenPaths.has(child.parentId)) {
          hiddenPaths.add(child.id);
          continue;
        }
        result.push(child);
        if (child.isDirectory && !child.isExpanded) {
          hiddenPaths.add(child.id);
        }
        traverse(child.id);
      }
    }

    traverse(null);
    return result;

  }, [nodes, searchTerm, localFilters?.showGloballyIgnored, localFilters?.showLocallyIgnored, localFilters?.showEmptyFolders, sortBy, sortDir, sortFolders, sortRegex, folderStats]);

  const sortByOptions: SelectOption[] = [
    { value: 'none', label: t('browser.sortNone'), icon: <IconBan size={16} /> },
    { value: 'name', label: t('browser.sortName'), icon: <IconAbc size={16} /> },
    { value: 'size', label: t('browser.sortSize'), icon: <IconWeight size={16} /> },
    { value: 'tokens', label: t('browser.sortTokens'), icon: <IconCpu size={16} /> },
  ];

  const sortDirOptions: SelectOption[] = [
    { value: 'asc', label: t('browser.sortAsc'), icon: <IconSortAscendingLetters size={16} /> },
    { value: 'desc', label: t('browser.sortDesc'), icon: <IconSortDescendingLetters size={16} /> },
  ];

  return (
    <section className="panel-left" style={{ position: 'relative' }}>
      
      <div className="browser-top-bar">
        <a href="/" className="brand-link">
          <img src="/logo.png" alt="make1txt logo" className="brand-logo" />
          <span>make1txt</span>
        </a>
        
        <div className="browser-tabs">
          <button
            className={`browser-tab ${activeTab === 'tree' ? 'active' : ''}`}
            onClick={() => setActiveTab('tree')}
          >
            <IconListTree size={18} /> {t('browser.tabStructure')}
          </button>
          <button
            className={`browser-tab ${activeTab === 'result' ? 'active' : ''}`}
            onClick={() => setActiveTab('result')}
            disabled={!generatedText}
          >
            <IconCode size={18} /> {t('browser.tabResult')}
          </button>
        </div>
        
        <div className="browser-top-spacer">
          <a 
            href="https://github.com/Rivgoo/make1txt" 
            target="_blank" 
            rel="noreferrer" 
            className="github-link"
            data-tooltip="GitHub"
            data-tooltip-pos="left"
          >
            <IconBrandGithub size={24} />
          </a>
        </div>
      </div>

      {isLoading && (
        <div className="browser-loading-overlay">
          <IconLoader2 size={48} className="spin" color="var(--accent-primary)" />
          <h3>{t('browser.scanning')}</h3>
          <p>{t('browser.processedFiles').replace('{{count}}', scannedFilesCount.toString())}</p>
          <Button variant="danger" onClick={cancelDirectoryLoad} style={{ marginTop: 'var(--spacing-md)' }}>
            <IconSquareRoundedX size={18} /> {t('common.cancel')}
          </Button>
        </div>
      )}

      {activeTab === 'tree' ? (
        <>
          <header className="panel-header" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="browser-title">
                <IconFiles size={24} className="browser-title-icon" /> 
                {t('browser.files')}
              </h2>
              
              {nodes.length > 0 && (
                <div className="browser-header-tools">
                  <Button variant="secondary" onClick={toggleSort} data-tooltip={t('browser.sorting')} data-tooltip-pos="bottom">
                    <IconArrowsSort size={18} color={isSortVisible ? 'var(--accent-primary)' : 'var(--text-primary)'} />
                  </Button>
                  <Button variant="secondary" onClick={toggleSearch} data-tooltip={t('common.search')} data-tooltip-pos="bottom">
                    <IconSearch size={18} color={isSearchVisible ? 'var(--accent-primary)' : 'var(--text-primary)'} />
                  </Button>
                  <Button variant="secondary" onClick={selectAll} data-tooltip={t('browser.selectAll')} data-tooltip-pos="bottom">
                    <IconChecks size={18} />
                  </Button>
                  <Button variant="secondary" onClick={deselectAll} data-tooltip={t('browser.resetSelection')} data-tooltip-pos="bottom">
                    <IconSquareX size={18} />
                  </Button>

                  <div className="browser-tools-divider" />

                  <Button 
                    variant="secondary" 
                    onClick={handleResyncWorkspace} 
                    disabled={isLoading || isResyncing} 
                    data-tooltip={t('browser.resyncWorkspaceTooltip')} 
                    data-tooltip-pos="bottom"
                  >
                    <IconRefresh 
                      size={18} 
                      className={isResyncing ? 'spin' : ''} 
                      color={isResyncing ? 'var(--accent-primary)' : 'var(--text-primary)'} 
                    />
                  </Button>

                  <Button variant="secondary" onClick={handleSelectFolder} disabled={isLoading || isResyncing} data-tooltip={t('browser.changeFolder')} data-tooltip-pos="bottom">
                    {isLoading ? <IconLoader2 className="spin" size={18} /> : <IconFolderOpen size={18} />}
                  </Button>
                </div>
              )}
            </div>
            
            <div className={`tools-panel-slide ${(isSearchVisible || isSortVisible) && nodes.length > 0 ? 'visible' : ''}`}>
              {isSearchVisible && (
                <div className="search-input-wrapper">
                  <IconSearch size={16} className="search-input-icon" color="var(--text-primary)" />
                  <input 
                    className="search-input" 
                    placeholder={t('browser.searchPlaceholder')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              )}
              {isSortVisible && (
                <div className="sort-controls-wrapper">
                  <div className="sort-control-group">
                    <label><IconFilter size={14} /> {t('browser.sortBy')}</label>
                    <Select 
                      options={sortByOptions} 
                      value={sortBy} 
                      onChange={(v) => setSortBy(v as 'none' | 'name' | 'size' | 'tokens')} 
                    />
                  </div>
                  <div className="sort-control-group">
                    <label><IconArrowsSort size={14} /> {t('browser.sortDir')}</label>
                    <Select 
                      options={sortDirOptions} 
                      value={sortDir} 
                      onChange={(v) => setSortDir(v as 'asc' | 'desc')} 
                    />
                  </div>
                  <div className="sort-control-group">
                    <label><IconCodeAsterix size={14} /> {t('browser.sortRegex')}</label>
                    <div className="sort-regex-wrapper">
                      <IconCodeAsterix size={16} className="sort-regex-icon" />
                      <input 
                        className="search-input" 
                        placeholder="^src/.*"
                        value={sortRegex} 
                        onChange={e => setSortRegex(e.target.value)} 
                      />
                    </div>
                  </div>
                  <div className="sort-control-group" style={{ justifyContent: 'flex-end' }}>
                    <label className={`sort-checkbox-card ${sortFolders ? 'is-active' : ''}`}>
                      <IconFolders size={18} className="sort-checkbox-icon" />
                      <span className="sort-checkbox-label">{t('browser.sortFolders')}</span>
                      <input 
                        type="checkbox" 
                        checked={sortFolders} 
                        onChange={e => setSortFolders(e.target.checked)} 
                        className="sort-checkbox-input"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          </header>
          
          <main className="panel-content" style={{ padding: 0 }}>
            {nodes.length === 0 && !isLoading && (
              <div className="empty-state">
                <IconFolderOpen size={64} stroke={1} color="var(--accent-primary)" />
                <h3>{t('browser.emptyStructureTitle')}</h3>
                <p>{t('browser.emptyStructureDesc')}</p>
                <Button variant="primary" onClick={handleSelectFolder} disabled={isLoading || isResyncing}>
                  {isLoading ? <IconLoader2 className="spin" size={18} /> : <IconFolderOpen size={18} />}
                  {t('browser.selectFolder')}
                </Button>
              </div>
            )}

            {nodes.length > 0 && sortedAndFilteredNodes.length === 0 && !isLoading && (
              <div className="empty-state">
                <IconFileOff size={48} stroke={1.5} />
                <p>{t('browser.notFound')}</p>
              </div>
            )}
            
            {sortedAndFilteredNodes.length > 0 && (
              <VirtualList
                items={sortedAndFilteredNodes}
                itemHeight={24}
                renderItem={(node) => (
                  <FileTreeNode
                    key={node.id}
                    node={node}
                    folderStat={node.isDirectory ? folderStats[node.relativePath] : undefined}
                    onToggleExpand={toggleExpand}
                    onToggleSelect={toggleSelection}
                    onContextMenu={handleContextMenu}
                  />
                )}
              />
            )}
          </main>

          {previewNode && (
            <div className={`preview-panel-container ${isResizingPreview ? 'is-resizing' : ''}`} style={{ height: previewHeight }}>
              <div className="horizontal-resizer" onMouseDown={handlePreviewResizeStart} />
              <FilePreview node={previewNode} onClose={() => setPreviewNode(null)} />
            </div>
          )}
        </>
      ) : (
        <ResultViewer />
      )}

      {contextMenu.isOpen && contextMenu.node && (
        <FileContextMenu 
          key={contextMenu.node.id}
          x={contextMenu.x} 
          y={contextMenu.y} 
          node={contextMenu.node} 
          folderStat={contextMenu.node.isDirectory ? folderStats[contextMenu.node.relativePath] : undefined}
          onClose={closeContextMenu} 
        />
      )}
    </section>
  );
}
