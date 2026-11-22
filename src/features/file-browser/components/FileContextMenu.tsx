import { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  IconFolder, IconFileText, IconCircleCheck, IconCircleDashed, 
  IconWeight, IconClock, IconRoute, IconFiles, IconLoader2, IconX, 
  IconEye, IconEyeOff, IconWorld, IconMapPin, IconMapPinOff, IconCopy, IconCpu, IconWand, IconRefresh,
  IconChecks, IconSquareX, IconBinaryTree, IconArrowBackUp
} from '@tabler/icons-react';
import type { FileNode } from '@/core/types/file.types';
import type { FolderStat } from '@/store/useFileStore';
import { useFileStore } from '@/store/useFileStore';
import { useToast } from '@/shared/context/useToast';
import { formatFileSize, getFileExtension, estimateTokenCount, isMeaningfullyOptimized } from '@/core/utils/stats.utils';
import './FileContextMenu.css';

interface FileContextMenuProps {
  x: number;
  y: number;
  node: FileNode;
  folderStat?: FolderStat;
  onClose: () => void;
}

interface MetaData {
  modified?: string;
  folderSize?: number;
}

export function FileContextMenu({ x, y, node, folderStat, onClose }: FileContextMenuProps) {
  const { t } = useTranslation();
  const { 
    toggleSelection, setDirectChildrenSelection, nodes, previewNode, setPreviewNode, globalSettings, updateGlobalSettings, 
    localFilters, toggleExtension, toggleLocalPathIgnore, baseMetricsMap, optimizedMetricsMap, appliedOptimizationHash,
    setNodeOutputMode, clearNodeOutputModeOverride,
    resyncSubtree, isResyncing
  } = useFileStore();
  
  const { showToast } = useToast();
  
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  const ext = !node.isDirectory ? getFileExtension(node.name) : '';
  const isGlobalExtIgnored = !node.isDirectory && globalSettings?.ignoredExtensions?.includes(ext);
  const isLocalExtIgnored = !node.isDirectory && localFilters?.extensions?.[ext]?.isActive === false;
  const isGlobalFolderIgnored = node.isDirectory && globalSettings?.ignoredPaths?.includes(node.name);

  const localPatternCheck = node.relativePath;
  const isLocallyIgnored = localFilters?.customPatterns?.some(p => p.pattern === localPatternCheck && p.isActive);
  const isPreviewing = previewNode?.id === node.id;

  const directFiles = node.isDirectory
    ? nodes.filter(n => n.parentId === node.id && !n.isDirectory && !n.isIgnored)
    : [];
  const allDirectSelected = directFiles.length > 0 && directFiles.every(f => f.isSelected);
  const noneDirectSelected = directFiles.length > 0 && directFiles.every(f => !f.isSelected);

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    let newTop = y;
    let newLeft = x;
    
    if (x + rect.width > vw) newLeft = vw - rect.width - 8;
    if (y + rect.height > vh) newTop = vh - rect.height - 8;
    
    menuRef.current.style.top = `${newTop}px`;
    menuRef.current.style.left = `${newLeft}px`;
    menuRef.current.style.visibility = 'visible';
  }, [x, y]);

  useEffect(() => {
    let isMounted = true;

    const fetchMeta = async () => {
      if (node.isDirectory) {
        const prefix = node.relativePath + '/';
        const descendants = nodes.filter(n => !n.isDirectory && n.relativePath.startsWith(prefix));
        const size = descendants.reduce((acc, curr) => acc + curr.sizeBytes, 0);
        
        if (isMounted) {
          setMeta({ folderSize: size });
          setIsLoadingMeta(false);
        }
      } else if (node.content !== undefined) {
        if (isMounted) {
          setMeta({ modified: 'IDE Sync' });
          setIsLoadingMeta(false);
        }
      } else if (node.handle) {
        try {
          const file = await (node.handle as FileSystemFileHandle).getFile();
          if (isMounted) {
            setMeta({ modified: new Date(file.lastModified).toLocaleString() });
            setIsLoadingMeta(false);
          }
        } catch {
          if (isMounted) {
            setMeta({ modified: t('browser.notAvailable') });
            setIsLoadingMeta(false);
          }
        }
      } else {
        if (isMounted) {
          setMeta({ modified: t('browser.notAvailable') });
          setIsLoadingMeta(false);
        }
      }
    };

    fetchMeta();
    return () => { isMounted = false; };
  }, [node, nodes, t]);

  const handleCopyPath = () => {
    navigator.clipboard.writeText(node.relativePath).then(() => {
      showToast('success', t('common.copied'), t('browser.pathCopied'));
    }).catch(() => {
      showToast('error', t('common.error'), t('browser.pathCopyFailed'));
    });
    onClose();
  };

  const handleResyncFolder = async () => {
    onClose();
    try {
      const stats = await resyncSubtree(node.id);
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
        } else {
          showToast('error', t('common.error'), error.message || t('browser.resyncError'));
        }
      }
    }
  };

  const handleToggleSelection = () => {
    toggleSelection(node.id, !node.isSelected);
    onClose();
  };

  const handleSelectFirstLevel = () => {
    setDirectChildrenSelection(node.id, true);
    onClose();
  };

  const handleDeselectFirstLevel = () => {
    setDirectChildrenSelection(node.id, false);
    onClose();
  };

  const handleTogglePreview = () => {
    if (isPreviewing) {
      setPreviewNode(null);
    } else {
      setPreviewNode(node);
    }
    onClose();
  };

  const handleToggleLocalPath = () => {
    toggleLocalPathIgnore(node.relativePath);
    if (isLocallyIgnored) {
      showToast('info', t('browser.localFilters'), t('quickSettings.ruleRemoved').replace('{{pattern}}', localPatternCheck));
    } else {
      showToast('warning', t('browser.localFilters'), t('quickSettings.ruleAdded').replace('{{pattern}}', localPatternCheck));
    }
    onClose();
  };

  const handleToggleGlobalExt = () => {
    if (isGlobalExtIgnored) {
      updateGlobalSettings({ ignoredExtensions: globalSettings.ignoredExtensions.filter(e => e !== ext) });
    } else {
      updateGlobalSettings({ ignoredExtensions: [...globalSettings.ignoredExtensions, ext] });
    }
    onClose();
  };

  const handleToggleLocalExt = () => {
    toggleExtension(ext);
    onClose();
  };

  const handleToggleGlobalFolder = () => {
    if (isGlobalFolderIgnored) {
      updateGlobalSettings({ ignoredPaths: globalSettings.ignoredPaths.filter(p => p !== node.name) });
    } else {
      updateGlobalSettings({ ignoredPaths: [...globalSettings.ignoredPaths, node.name] });
    }
    onClose();
  };

  const handleSetOutputMode = (targetPath: string, mode: 'full' | 'structure-only') => {
    const wasTreeDisabled = !localFilters?.generateTree;
    setNodeOutputMode(targetPath, mode);
    if (mode === 'structure-only' && wasTreeDisabled) {
      showToast('info', t('common.info'), t('structureOnly.autoEnabledTree'));
    }
    onClose();
  };

  const handleClearOverride = (targetPath: string) => {
    clearNodeOutputModeOverride(targetPath);
    onClose();
  };

  const optActive =
    (localFilters?.isOptimizationEnabled ?? false) &&
    appliedOptimizationHash !== 'none';

  const baseEntry = !node.isDirectory ? baseMetricsMap[node.id] : undefined;
  const rawFileBytes = baseEntry?.bytes ?? node.sizeBytes;
  const baseFileExact = baseEntry?.exactTokens ?? null;
  const optEntry = !node.isDirectory ? optimizedMetricsMap[node.id] : undefined;
  const hasValidOpt =
    optActive &&
    optEntry !== undefined &&
    optEntry.configHash === appliedOptimizationHash;

  const isExactTotal = node.isDirectory
    ? (folderStat?.isSelectedActiveExact ?? false)
    : (hasValidOpt ? optEntry.exactTokens !== null : baseFileExact !== null);

  const tokensVal = node.isDirectory
    ? (folderStat?.selectedActiveTokens ?? 0)
    : (hasValidOpt
        ? (optEntry.exactTokens ?? estimateTokenCount(optEntry.bytes))
        : (baseFileExact ?? estimateTokenCount(rawFileBytes)));

  const baseSize = node.isDirectory
    ? (folderStat?.eligibleSizeBytes ?? meta?.folderSize ?? 0)
    : rawFileBytes;

  const selectedBaseSize = node.isDirectory
    ? (folderStat?.selectedBaseBytes ?? 0)
    : rawFileBytes;

  const optSize = node.isDirectory
    ? (folderStat?.selectedActiveBytes ?? 0)
    : (hasValidOpt ? optEntry.bytes : rawFileBytes);

  const isOptimized = node.isDirectory
    ? (optActive && (folderStat?.optimizedFilesCount ?? 0) > 0 && optSize < selectedBaseSize)
    : (hasValidOpt && isMeaningfullyOptimized(rawFileBytes, optSize, baseFileExact, optEntry?.exactTokens));

  return (
    <div className="context-menu-overlay" onContextMenu={(e) => { e.preventDefault(); onClose(); }} onClick={onClose}>
      <div 
        ref={menuRef}
        className="context-menu" 
        style={{ visibility: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="context-menu-header">
          <div className="context-menu-header-info">
            {node.isDirectory ? <IconFolder size={20} className="context-menu-header-icon" /> : <IconFileText size={20} className="context-menu-header-icon" />}
            <span className="context-menu-header-title" title={node.name}>{node.name}</span>
          </div>
          <button className="context-menu-close-btn" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        <div className="context-menu-layout">
          <div className="context-menu-actions-col">
            <div className="context-menu-section-title">{t('browser.actions')}</div>

            {node.isDirectory && (
              <button 
                className="context-menu-action" 
                onClick={handleResyncFolder}
                disabled={isResyncing}
              >
                <IconRefresh size={18} className={isResyncing ? 'spin' : ''} />
                {t('browser.resyncFolder')}
              </button>
            )}
            
            {!node.isDirectory && (
              <button className="context-menu-action" onClick={handleTogglePreview}>
                {isPreviewing ? <IconEyeOff size={18} /> : <IconEye size={18} />} 
                {isPreviewing ? t('browser.closeContent') : t('browser.viewContent')}
              </button>
            )}

            <button className="context-menu-action" onClick={handleCopyPath}>
              <IconCopy size={18} /> {t('browser.copyPath')}
            </button>

            {!node.isIgnored && (
              <button 
                className={`context-menu-action ${node.isSelected ? 'action-exclude' : 'action-include'}`}
                onClick={handleToggleSelection}
              >
                {node.isSelected ? <IconCircleDashed size={18} /> : <IconCircleCheck size={18} />}
                {node.isSelected ? t('browser.deselect') : t('browser.select')}
              </button>
            )}

            {node.isDirectory && !node.isIgnored && (
              <>
                <button
                  className="context-menu-action action-include"
                  onClick={handleSelectFirstLevel}
                  disabled={directFiles.length === 0 || allDirectSelected}
                >
                  <IconChecks size={18} />
                  {t('browser.selectFirstLevel')}
                </button>
                <button
                  className="context-menu-action action-exclude"
                  onClick={handleDeselectFirstLevel}
                  disabled={directFiles.length === 0 || noneDirectSelected}
                >
                  <IconSquareX size={18} />
                  {t('browser.deselectFirstLevel')}
                </button>
              </>
            )}

            {!node.isIgnored && (
              <>
                <div className="context-menu-divider" />
                <div className="context-menu-section-title">{t('structureOnly.outputModeLabel')}</div>

                {node.outputMode === 'full' ? (
                  node.outputModeSource === 'direct' ? (
                    <button
                      className="context-menu-action action-structure-only"
                      onClick={() => handleClearOverride(node.relativePath)}
                    >
                      <IconArrowBackUp size={18} />
                      {t('structureOnly.resetOverrideAction')}
                    </button>
                  ) : (
                    <button
                      className="context-menu-action action-structure-only"
                      onClick={() => handleSetOutputMode(node.relativePath, 'structure-only')}
                    >
                      <IconBinaryTree size={18} />
                      {t('structureOnly.setAction')}
                    </button>
                  )
                ) : node.outputModeSource === 'direct' ? (
                  <button
                    className="context-menu-action action-full-override"
                    onClick={() => handleSetOutputMode(node.relativePath, 'full')}
                  >
                    <IconBinaryTree size={18} />
                    {t('structureOnly.restoreAction')}
                  </button>
                ) : (
                  <>
                    <button
                      className="context-menu-action action-full-override"
                      onClick={() => handleSetOutputMode(node.relativePath, 'full')}
                    >
                      <IconBinaryTree size={18} />
                      {t('structureOnly.overrideFullAction')}
                    </button>
                    {node.outputModeAnchorPath && (
                      <button
                        className="context-menu-action"
                        onClick={() => handleSetOutputMode(node.outputModeAnchorPath!, 'full')}
                      >
                        <IconArrowBackUp size={18} />
                        {t('structureOnly.restoreAction')} ({node.outputModeAnchorPath.split('/').pop()})
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            <div className="context-menu-divider" />
            <div className="context-menu-section-title">{t('browser.localFilters')}</div>

            <button 
              className={`context-menu-action ${isLocallyIgnored ? 'action-include' : 'action-exclude'}`} 
              onClick={handleToggleLocalPath}
            >
              {isLocallyIgnored ? <IconMapPinOff size={18} /> : <IconMapPin size={18} />}
              {isLocallyIgnored 
                ? (node.isDirectory ? t('browser.unignoreFolder') : t('browser.unignoreFile'))
                : (node.isDirectory ? t('browser.ignoreFolder') : t('browser.ignoreFile'))}
            </button>

            {!node.isDirectory && !isGlobalExtIgnored && ext !== 'no-extension' && (
              <button className={`context-menu-action ${isLocalExtIgnored ? 'action-include' : 'action-exclude'}`} onClick={handleToggleLocalExt}>
                <IconMapPin size={18} /> 
                {isLocalExtIgnored ? t('browser.includeExt') : t('browser.ignoreExt')}
                <span className="context-menu-action-desc">{ext}</span>
              </button>
            )}

            <div className="context-menu-divider" />
            <div className="context-menu-section-title">{t('browser.globalRules')}</div>

            {node.isDirectory ? (
              <button className={`context-menu-action ${isGlobalFolderIgnored ? 'action-include' : 'action-exclude'}`} onClick={handleToggleGlobalFolder}>
                <IconWorld size={18} /> 
                {isGlobalFolderIgnored ? t('browser.globalIncludeFolder') : t('browser.globalIgnoreFolder')}
                <span className="context-menu-action-desc">{node.name}</span>
              </button>
            ) : (
              ext !== 'no-extension' && (
                <button className={`context-menu-action ${isGlobalExtIgnored ? 'action-include' : 'action-exclude'}`} onClick={handleToggleGlobalExt}>
                  <IconWorld size={18} /> 
                  {isGlobalExtIgnored ? t('browser.globalIncludeExt') : t('browser.globalIgnoreExt')}
                  <span className="context-menu-action-desc">{ext}</span>
                </button>
              )
            )}
          </div>

          <div className="context-menu-meta-col">
            <div className="meta-row">
              <IconRoute size={16} className="meta-icon" />
              <div className="meta-details">
                <span className="meta-label">{t('browser.path')}</span>
                <span className="meta-value">{node.relativePath}</span>
              </div>
            </div>

            <div className="meta-row">
              <IconWeight size={16} className="meta-icon" />
              <div className="meta-details">
                <span className="meta-label">{t('browser.size')}</span>
                <span className="meta-value">
                  {node.isDirectory && isLoadingMeta ? <IconLoader2 size={12} className="spin" /> : formatFileSize(baseSize)}
                </span>
              </div>
            </div>

            <div className="meta-row">
              <IconBinaryTree
                size={16}
                className="meta-icon"
                style={{
                  color:
                    node.outputMode === 'structure-only'
                      ? 'var(--structure-only)'
                      : node.outputModeSource === 'direct'
                        ? 'var(--accent-primary)'
                        : undefined,
                }}
              />
              <div className="meta-details">
                <span className="meta-label">{t('structureOnly.outputModeLabel')}</span>
                <span
                  className="meta-value"
                  style={{
                    color:
                      node.outputMode === 'structure-only'
                        ? 'var(--structure-only)'
                        : undefined,
                    fontWeight: node.outputMode === 'structure-only' ? 600 : undefined,
                  }}
                >
                  {node.outputMode === 'structure-only'
                    ? node.outputModeSource === 'direct'
                      ? t('structureOnly.modeMetaDirect')
                      : `${t('structureOnly.modeMetaInherited')} (${node.outputModeAnchorPath})`
                    : t('structureOnly.modeFull')}
                </span>
              </div>
            </div>

            {isOptimized && (
              <div className="meta-row">
                <IconWand size={16} className="meta-icon" style={{ color: 'var(--success)' }} />
                <div className="meta-details">
                  <span className="meta-label" style={{ color: 'var(--success)' }}>{t('optimization.optimized', 'Optimized Size')}</span>
                  <span className="meta-value" style={{ color: 'var(--success)', fontWeight: 600 }}>
                    {formatFileSize(optSize)} (-{formatFileSize(selectedBaseSize - optSize)})
                  </span>
                </div>
              </div>
            )}

            <div className="meta-row">
              <IconCpu size={16} className="meta-icon" />
              <div className="meta-details">
                <span className="meta-label">{t('stats.tokens')}</span>
                <span className="meta-value">
                  {node.isDirectory && isLoadingMeta ? (
                    <IconLoader2 size={12} className="spin" />
                  ) : node.outputMode === 'structure-only' ? (
                    `0 body (~${(node.isDirectory ? (folderStat?.structureOnlySavedTokens ?? 0) : estimateTokenCount(rawFileBytes)).toLocaleString()} ${t('structureOnly.omittedFromBody')})`
                  ) : (
                    `${!isExactTotal ? '~' : ''}${tokensVal.toLocaleString()}`
                  )}
                </span>
              </div>
            </div>

            {node.isDirectory ? (
              <div className="meta-row">
                <IconFiles size={16} className="meta-icon" />
                <div className="meta-details">
                  <span className="meta-label">{t('browser.files')}</span>
                  <span className="meta-value">
                    {folderStat
                      ? folderStat.structureOnlySelected > 0
                        ? `${folderStat.selected} / ${folderStat.total} (${folderStat.structureOnlySelected} meta-only)`
                        : `${folderStat.selected} / ${folderStat.total}`
                      : '...'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="meta-row">
                <IconClock size={16} className="meta-icon" />
                <div className="meta-details">
                  <span className="meta-label">{t('browser.modified')}</span>
                  <span className="meta-value">
                    {isLoadingMeta ? <IconLoader2 size={12} className="spin" /> : meta?.modified}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
