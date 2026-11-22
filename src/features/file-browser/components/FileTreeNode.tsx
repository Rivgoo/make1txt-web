import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconChevronRight,
  IconChevronDown,
  IconFolder,
  IconFolderOpen,
  IconFileText,
  IconFileCode,
  IconInfoCircle,
  IconEye,
  IconEyeOff,
  IconMapPin,
  IconMapPinOff,
  IconWand,
  IconArrowRight,
  IconBinaryTree,
} from '@tabler/icons-react';
import type { FileNode } from '@/core/types/file.types';
import type { FolderStat } from '@/store/useFileStore';
import { useFileStore } from '@/store/useFileStore';
import {
  formatFileSize,
  estimateTokenCount,
  isMeaningfullyOptimized,
} from '@/core/utils/stats.utils';
import { useToast } from '@/shared/context/useToast';
import './FileTreeNode.css';

interface FileTreeNodeProps {
  node: FileNode;
  folderStat?: FolderStat;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleStructureOnly?: (node: FileNode) => void;
  isClickToMarkMode?: boolean;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
}

export function FileTreeNode({
  node,
  folderStat,
  onToggleExpand,
  onToggleSelect,
  onToggleStructureOnly,
  isClickToMarkMode = false,
  onContextMenu,
}: FileTreeNodeProps) {
  const { t } = useTranslation();
  const {
    localFilters,
    previewNode,
    setPreviewNode,
    toggleLocalPathIgnore,
    baseMetricsMap,
    optimizedMetricsMap,
    appliedOptimizationHash,
  } = useFileStore();
  const { showToast } = useToast();
  const paddingLeft = node.depth * 16 + 8;
  const checkboxRef = useRef<HTMLInputElement>(null);

  const isEffectivelyEmpty =
    node.isDirectory && folderStat && folderStat.total === 0;
  const isMixed =
    node.isDirectory && folderStat
      ? folderStat.selected > 0 && folderStat.selected < folderStat.total
      : false;
  const isChecked =
    node.isDirectory && folderStat && folderStat.total > 0
      ? folderStat.selected === folderStat.total
      : node.isSelected;

  const isDisabled = node.isIgnored || isEffectivelyEmpty;
  const isIgnoredVisually = node.isIgnored || isEffectivelyEmpty;

  const isUnselected = node.isDirectory
    ? folderStat && folderStat.total > 0 && folderStat.selected === 0
    : !node.isSelected;

  const localPatternCheck = node.relativePath;
  const isLocallyIgnored = localFilters?.customPatterns?.some(
    (p) => p.pattern === localPatternCheck && p.isActive
  );
  const isPreviewing = previewNode?.id === node.id;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = isMixed;
    }
  }, [isMixed]);

  const handleRowClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isClickToMarkMode && node.isDirectory && !node.isIgnored && !isEffectivelyEmpty) {
      onToggleStructureOnly?.(node);
      return;
    }
    if (node.isDirectory) onToggleExpand(node.id);
  };

  const handleExpanderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDirectory) onToggleExpand(node.id);
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    let nextState = e.target.checked;
    if (isMixed) {
      nextState = true;
    }
    onToggleSelect(node.id, nextState);
  };

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(e, node);
  };

  const handleToggleLocalIgnore = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleLocalPathIgnore(node.relativePath);

    if (isLocallyIgnored) {
      showToast(
        'info',
        t('browser.localFilters'),
        t('quickSettings.ruleRemoved').replace('{{pattern}}', localPatternCheck)
      );
    } else {
      showToast(
        'warning',
        t('browser.localFilters'),
        t('quickSettings.ruleAdded').replace('{{pattern}}', localPatternCheck)
      );
    }
  };

  const handleTogglePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPreviewing) {
      setPreviewNode(null);
    } else {
      setPreviewNode(node);
    }
  };

  const handleStructureOnlyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleStructureOnly?.(node);
  };

  // Structure-Only Visual State
  const isDirectMeta =
    node.outputMode === 'structure-only' && node.outputModeSource === 'direct';
  const isInheritedMeta =
    node.outputMode === 'structure-only' &&
    node.outputModeSource === 'inherited';
  const isFullOverride =
    node.outputMode === 'full' && node.outputModeSource === 'direct';

  const lowerName = node.name.toLowerCase();
  const isCSharpOrAsmdef =
    lowerName.endsWith('.cs') || lowerName.endsWith('.asmdef');

  let iconColor = 'inherit';
  if (node.isDirectory && !node.isIgnored && !isDisabled && !isUnselected) {
    if (isDirectMeta) {
      iconColor = 'var(--structure-only)';
    } else if (isInheritedMeta) {
      iconColor = 'var(--structure-only-muted)';
    } else if (isFullOverride) {
      iconColor = 'var(--accent-primary)';
    } else if (isMixed) {
      iconColor = 'var(--warning)';
    } else if (isChecked && node.isExpanded) {
      iconColor = 'var(--accent-primary)';
    }
  } else if (
    !node.isDirectory &&
    !node.isIgnored &&
    node.isSelected &&
    node.outputMode === 'structure-only'
  ) {
    iconColor = 'var(--structure-only-muted)';
  }

  // Dual-Channel Metrics
  const optActive =
    (localFilters?.isOptimizationEnabled ?? false) &&
    appliedOptimizationHash !== 'none';

  const baseEntry = !node.isDirectory ? baseMetricsMap[node.id] : undefined;
  const rawFileBytes = baseEntry?.bytes ?? node.sizeBytes;
  const baseFileExact = baseEntry?.exactTokens ?? null;
  const fileBaseTokens =
    baseFileExact !== null ? baseFileExact : estimateTokenCount(rawFileBytes);

  const optEntry = !node.isDirectory ? optimizedMetricsMap[node.id] : undefined;
  const hasValidOpt =
    optActive &&
    optEntry !== undefined &&
    optEntry.configHash === appliedOptimizationHash;
  const activeFileBytes = hasValidOpt ? optEntry.bytes : rawFileBytes;
  const activeFileExact = hasValidOpt ? optEntry.exactTokens : baseFileExact;
  const fileActiveTokens =
    activeFileExact !== null
      ? activeFileExact
      : estimateTokenCount(activeFileBytes);

  const isFileOptimized =
    !node.isDirectory &&
    node.isSelected &&
    !node.isIgnored &&
    node.outputMode === 'full' &&
    hasValidOpt &&
    isMeaningfullyOptimized(
      rawFileBytes,
      activeFileBytes,
      baseFileExact,
      activeFileExact
    );

  const isDirOptimized =
    optActive &&
    node.isDirectory &&
    folderStat !== undefined &&
    folderStat.optimizedFilesCount > 0;

  const showOptUI = isFileOptimized || isDirOptimized;

  const baseSizeForPercent = node.isDirectory
    ? (folderStat?.selectedBaseBytes ?? 0)
    : rawFileBytes;
  const optSizeForPercent = node.isDirectory
    ? (folderStat?.selectedActiveBytes ?? 0)
    : activeFileBytes;
  const percentSaved =
    showOptUI && baseSizeForPercent > 0
      ? Math.round(
          ((baseSizeForPercent - optSizeForPercent) / baseSizeForPercent) * 100
        )
      : 0;

  // Meta Content (Counts / File Size)
  let metaContent: React.ReactNode = null;
  if (node.isDirectory && folderStat) {
    if (folderStat.absoluteTotal === 0) {
      metaContent = t('browser.emptyFolder');
    } else if (folderStat.total === 0) {
      metaContent = `0 / ${folderStat.absoluteTotal}`;
    } else if (folderStat.selected === folderStat.total) {
      metaContent = `${folderStat.total}`;
    } else if (folderStat.selected === 0) {
      metaContent = `0 / ${folderStat.total}`;
    } else {
      metaContent = (
        <>
          <span className="tree-node-meta-mixed">{folderStat.selected}</span>
          <span> / {folderStat.total}</span>
        </>
      );
    }

    if (folderStat.structureOnlySelected > 0 || isDirOptimized) {
      metaContent = (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>{metaContent}</span>
          {folderStat.structureOnlySelected > 0 && (
            <span
              className="structure-folder-count"
              data-tooltip={t('structureOnly.tokensOmittedTooltip', {
                count: folderStat.structureOnlySavedTokens.toLocaleString(),
              })}
              data-tooltip-pos="top"
            >
              <IconBinaryTree size={12} />
              {folderStat.structureOnlySelected}
            </span>
          )}
          {isDirOptimized && (
            <span
              className="opt-success"
              style={{
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                cursor: 'help',
              }}
              data-tooltip={t('optimization.filesOptimizedTooltip')}
              data-tooltip-pos="top"
            >
              <IconWand size={12} />
              {folderStat.optimizedFilesCount}
            </span>
          )}
        </span>
      );
    }
  } else {
    metaContent = showOptUI ? (
      <>
        <span className="opt-strikethrough">
          {formatFileSize(rawFileBytes)}
        </span>
        <IconArrowRight size={10} className="opt-arrow" />
        <span className="opt-success">{formatFileSize(activeFileBytes)}</span>
        <span className="opt-percent">(-{percentSaved}%)</span>
      </>
    ) : (
      formatFileSize(rawFileBytes)
    );
  }

  // Token Display Values
  const totalEligibleTokens = node.isDirectory
    ? (folderStat?.totalEligibleTokens ?? 0)
    : fileBaseTokens;
  const isTotalExact = node.isDirectory
    ? (folderStat?.isTotalEligibleExact ?? false)
    : baseFileExact !== null;

  const selectedBaseTokens = node.isDirectory
    ? (folderStat?.selectedBaseTokens ?? 0)
    : node.isSelected && !node.isIgnored && node.outputMode === 'full'
      ? fileBaseTokens
      : 0;

  const selectedActiveTokens = node.isDirectory
    ? (folderStat?.selectedActiveTokens ?? 0)
    : node.isSelected && !node.isIgnored && node.outputMode === 'full'
      ? fileActiveTokens
      : 0;

  const isSelectedBaseExact = node.isDirectory
    ? (folderStat?.isSelectedBaseExact ?? false)
    : baseFileExact !== null;
  const isSelectedActiveExact = node.isDirectory
    ? (folderStat?.isSelectedActiveExact ?? false)
    : activeFileExact !== null;

  const isFullySelectedFull = node.isDirectory
    ? folderStat !== undefined &&
      folderStat.total > 0 &&
      folderStat.selected === folderStat.total &&
      folderStat.structureOnlySelected === 0
    : node.isSelected && !node.isIgnored && node.outputMode === 'full';

  const isPureStructureOnly = node.isDirectory
    ? folderStat !== undefined &&
      folderStat.selected > 0 &&
      folderStat.fullSelected === 0 &&
      folderStat.structureOnlySelected > 0
    : node.isSelected &&
      !node.isIgnored &&
      node.outputMode === 'structure-only';

  const structureButtonTooltip = isDirectMeta
    ? t('structureOnly.restoreAction')
    : isInheritedMeta
      ? `${t('structureOnly.inheritedFrom', { path: node.outputModeAnchorPath })} — ${t('structureOnly.overrideFullAction')}`
      : isFullOverride
        ? t('structureOnly.resetOverrideAction')
        : t('structureOnly.setAction');

  const nodeClasses = [
    'tree-node',
    isIgnoredVisually ? 'tree-node--ignored' : '',
    isUnselected && !isIgnoredVisually ? 'tree-node--unselected' : '',
    !isIgnoredVisually && isDirectMeta ? 'tree-node--meta-direct' : '',
    !isIgnoredVisually && isInheritedMeta ? 'tree-node--meta-inherited' : '',
    !isIgnoredVisually && isFullOverride ? 'tree-node--full-override' : '',
    isClickToMarkMode && node.isDirectory && !node.isIgnored && !isEffectivelyEmpty
      ? 'tree-node--click-mark'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={nodeClasses}
      style={{ paddingLeft }}
      onClick={handleRowClick}
      onContextMenu={handleRightClick}
    >
      <div
        className="tree-node-icon tree-node-icon--expander"
        onClick={handleExpanderClick}
      >
        {node.isDirectory &&
          (node.isExpanded ? (
            <IconChevronDown size={14} />
          ) : (
            <IconChevronRight size={14} />
          ))}
      </div>

      <input
        ref={checkboxRef}
        type="checkbox"
        className="tree-node-checkbox"
        checked={isChecked}
        onChange={handleCheckboxChange}
        disabled={isDisabled}
        onClick={(e) => e.stopPropagation()}
      />

      <div className="tree-node-icon" style={{ color: iconColor }}>
        {node.isDirectory ? (
          node.isExpanded ? (
            <IconFolderOpen size={16} />
          ) : (
            <IconFolder size={16} />
          )
        ) : isCSharpOrAsmdef ? (
          <IconFileCode size={16} />
        ) : (
          <IconFileText size={16} />
        )}
      </div>

      <span
        className={`tree-node-name ${
          node.isDirectory ? 'tree-node-name--folder' : 'tree-node-name--file'
        }`}
      >
        {node.name}
      </span>

      {isDirectMeta && (
        <span className="structure-badge structure-badge--meta">
          {t('structureOnly.badgeMeta')}
        </span>
      )}
      {isInheritedMeta && (
        <span className="structure-badge structure-badge--inherited">
          {node.isDirectory
            ? `↳ ${t('structureOnly.badgeMeta').toLowerCase()}`
            : isCSharpOrAsmdef
              ? t('structureOnly.badgeMeta').toLowerCase()
              : t('structureOnly.badgeTree').toLowerCase()}
        </span>
      )}
      {isFullOverride && (
        <span className="structure-badge structure-badge--full">
          {t('structureOnly.badgeFullOverride')}
        </span>
      )}

      <span className="tree-node-meta">{metaContent}</span>

      <div className="tree-node-actions">
        <button
          className="tree-node-action-btn"
          data-tooltip={t('common.info')}
          data-tooltip-pos="top"
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e, node);
          }}
        >
          <IconInfoCircle size={14} />
        </button>

        {!node.isDirectory && (
          <button
            className={`tree-node-action-btn ${isPreviewing ? 'active-preview' : ''}`}
            data-tooltip={
              isPreviewing ? t('browser.closeContent') : t('browser.viewContent')
            }
            data-tooltip-pos="top"
            onClick={handleTogglePreview}
          >
            {isPreviewing ? <IconEyeOff size={14} /> : <IconEye size={14} />}
          </button>
        )}

        {!node.isIgnored && !isEffectivelyEmpty && (
          <button
            className={`tree-node-action-btn ${
              isDirectMeta
                ? 'active-structure-only'
                : isInheritedMeta
                  ? 'inherited-structure-only'
                  : isFullOverride
                    ? 'override-full'
                    : ''
            }`}
            data-tooltip={structureButtonTooltip}
            data-tooltip-pos="top"
            onClick={handleStructureOnlyClick}
          >
            <IconBinaryTree size={14} />
          </button>
        )}

        <div className="tree-node-actions-divider" />

        <button
          className={`tree-node-action-btn ${isLocallyIgnored ? 'active-ignore' : ''}`}
          data-tooltip={
            isLocallyIgnored
              ? node.isDirectory
                ? t('browser.unignoreFolder')
                : t('browser.unignoreFile')
              : node.isDirectory
                ? t('browser.ignoreFolder')
                : t('browser.ignoreFile')
          }
          data-tooltip-pos="top"
          onClick={handleToggleLocalIgnore}
        >
          {isLocallyIgnored ? (
            <IconMapPinOff size={14} />
          ) : (
            <IconMapPin size={14} />
          )}
        </button>
      </div>

      <div className="tree-node-leader" />

      <div
        className="tree-node-tokens"
        data-tooltip={
          isPureStructureOnly
            ? t('structureOnly.tokensOmittedTooltip', {
                count: (node.isDirectory
                  ? folderStat!.structureOnlySavedTokens
                  : fileBaseTokens
                ).toLocaleString(),
              })
            : t('stats.tokens')
        }
        data-tooltip-pos="top"
      >
        {isPureStructureOnly ? (
          <>
            <span className="structure-tokens-strikethrough">
              {!isTotalExact && '~'}
              {(node.isDirectory
                ? folderStat!.structureOnlySavedTokens
                : fileBaseTokens
              ).toLocaleString()}
            </span>
            <span className="structure-tokens-label">
              {node.isDirectory || isCSharpOrAsmdef
                ? t('structureOnly.badgeMeta').toLowerCase()
                : t('structureOnly.badgeTree').toLowerCase()}
            </span>
          </>
        ) : isFullySelectedFull ? (
          <>
            {showOptUI ? (
              <>
                <span
                  className="opt-strikethrough"
                  style={{ fontSize: '0.75rem', marginRight: '2px' }}
                >
                  {!isSelectedBaseExact && '~'}
                  {selectedBaseTokens.toLocaleString()}
                </span>
                <span
                  className={`tree-node-tokens-selected ${
                    selectedActiveTokens <= selectedBaseTokens
                      ? 'opt-success'
                      : 'opt-warning'
                  }`}
                >
                  {!isSelectedActiveExact && '~'}
                  {selectedActiveTokens.toLocaleString()}
                </span>
              </>
            ) : (
              <span className="tree-node-tokens-selected">
                {!isSelectedActiveExact && '~'}
                {selectedActiveTokens.toLocaleString()}
              </span>
            )}
          </>
        ) : (
          <>
            {showOptUI ? (
              <>
                <span
                  className="opt-strikethrough"
                  style={{ fontSize: '0.75rem', marginRight: '2px' }}
                >
                  {!isSelectedBaseExact && '~'}
                  {selectedBaseTokens.toLocaleString()}
                </span>
                <span
                  className={`tree-node-tokens-selected ${
                    selectedActiveTokens <= selectedBaseTokens
                      ? 'opt-success'
                      : 'opt-warning'
                  }`}
                >
                  {!isSelectedActiveExact && '~'}
                  {selectedActiveTokens.toLocaleString()}
                </span>
              </>
            ) : (
              <span className="tree-node-tokens-selected">
                {!isSelectedActiveExact && '~'}
                {selectedActiveTokens.toLocaleString()}
              </span>
            )}
            <span className="tree-node-tokens-total">
              / {!isTotalExact && '~'}
              {totalEligibleTokens.toLocaleString()}
            </span>
          </>
        )}
      </div>

      {showOptUI && (
        <div
          className="opt-wand-icon"
          data-tooltip={t('optimization.optimized')}
          data-tooltip-pos="top"
        >
          <IconWand size={14} />
        </div>
      )}
    </div>
  );
}
