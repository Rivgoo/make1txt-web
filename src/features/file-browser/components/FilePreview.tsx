import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX, IconFileText, IconLoader2, IconWand, IconAlertTriangle, IconCode } from '@tabler/icons-react';
import type { FileNode } from '@/core/types/file.types';
import type { CSharpCompressionLevel, CSharpCompressionResult } from '@/core/types/csharp-compression.types';
import { formatFileSize, estimateTokenCount } from '@/core/utils/stats.utils';
import {
  getEffectiveRegexRulesForFile,
  isCSharpFilePath,
  optimizeText,
} from '@/core/utils/optimization.utils';
import {
  CSHARP_COMPRESSION_LEVELS,
  CSHARP_LEVEL_SHORT_LABELS,
  DEFAULT_CSHARP_COMPRESSION_OPTIONS,
} from '@/core/constants/csharp-compression.constants';
import { treeSitterCSharpRuntime } from '@/core/services/csharp/TreeSitterCSharpRuntime';
import { csharpCompressor } from '@/core/services/csharp/CSharpCompressor';
import { buildDiffHtmlFromEdits } from '@/core/services/csharp/EditEngine';
import { useFileStore } from '@/store/useFileStore';
import './FilePreview.css';

const MAX_PREVIEW_SIZE = 1024 * 1024;

interface FilePreviewProps {
  node: FileNode;
  onClose: () => void;
}

interface MetaInfo {
  size: number;
  modified: string;
  type: string;
}

export function FilePreview({ node, onClose }: FilePreviewProps) {
  const { t } = useTranslation();
  const { localFilters, setNodeCSharpCompressionLevel } = useFileStore();
  const [originalText, setOriginalText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isTruncated, setIsTruncated] = useState(false);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [viewMode, setViewMode] = useState<'original' | 'optimized' | 'diff'>('original');

  const isCsFile = isCSharpFilePath(node.relativePath);
  const [sandboxOverride, setSandboxOverride] = useState<CSharpCompressionLevel | null>(null);
  const sandboxLevel: CSharpCompressionLevel =
    sandboxOverride ?? (node.csharpCompressionLevel !== 'none' ? node.csharpCompressionLevel : 'compact');
  const [csResultState, setCsResultState] = useState<CSharpCompressionResult | null>(null);
  const [isCompressingCs, setIsCompressingCs] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadContent = async () => {
      try {
        if (node.content !== undefined) {
          if (isMounted) {
            setMeta({
              size: node.sizeBytes,
              modified: t('browser.notAvailable'),
              type: 'text/plain',
            });
          }

          if (node.sizeBytes > MAX_PREVIEW_SIZE) {
            if (isMounted) {
              setOriginalText(node.content.slice(0, MAX_PREVIEW_SIZE) + t('result.truncatedMark'));
              setIsTruncated(true);
            }
          } else {
            if (isMounted) setOriginalText(node.content || '(Empty)');
          }
        } else if (node.handle) {
          const file = await (node.handle as FileSystemFileHandle).getFile();

          if (isMounted) {
            setMeta({
              size: file.size,
              modified: new Date(file.lastModified).toLocaleString(),
              type: file.type || 'unknown',
            });
          }

          if (file.size > MAX_PREVIEW_SIZE) {
            const slice = file.slice(0, MAX_PREVIEW_SIZE);
            const text = await slice.text();
            if (isMounted) {
              setOriginalText(text + t('result.truncatedMark'));
              setIsTruncated(true);
            }
          } else {
            const text = await file.text();
            if (isMounted) setOriginalText(text || '(Empty)');
          }
        } else {
          if (isMounted) setOriginalText(t('browser.notAvailable'));
        }
      } catch {
        if (isMounted) setOriginalText(t('browser.notAvailable'));
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadContent();
    return () => {
      isMounted = false;
    };
  }, [node, t]);

  // Asynchronous cancellation-safe C# AST compression sandbox
  useEffect(() => {
    if (!isCsFile || !originalText || isLoading) {
      return;
    }

    let cancelled = false;

    void (async () => {
      setIsCompressingCs(true);
      try {
        if (!treeSitterCSharpRuntime.ready) {
          await treeSitterCSharpRuntime.init();
        }
        if (cancelled) return;

        const csOptions =
          localFilters?.csharpCompressionOptions ?? DEFAULT_CSHARP_COMPRESSION_OPTIONS;
        const result = csharpCompressor.compress(
          originalText,
          { level: sandboxLevel, options: csOptions },
          true
        );

        const effRules = getEffectiveRegexRulesForFile(
          node.relativePath,
          localFilters?.isOptimizationEnabled ?? false,
          localFilters?.optimizationRules ?? [],
          true,
          sandboxLevel
        );

        if (effRules.length > 0 && sandboxLevel !== 'none') {
          const regexRes = optimizeText(result.compressedText, effRules, false);
          result.compressedText = regexRes.optimizedText;
          result.compressedBytes = regexRes.optimizedBytes;
        }

        if (!cancelled) {
          setCsResultState(result);
        }
      } catch (err) {
        console.warn('[FilePreview] C# compression failed:', err);
        if (!cancelled) setCsResultState(null);
      } finally {
        if (!cancelled) setIsCompressingCs(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isCsFile,
    originalText,
    isLoading,
    sandboxLevel,
    localFilters?.csharpCompressionOptions,
    localFilters?.isOptimizationEnabled,
    localFilters?.optimizationRules,
    node.relativePath,
  ]);

  const csResult = isCsFile && originalText && !isLoading ? csResultState : null;

  const isOptEnabled = localFilters?.isOptimizationEnabled ?? false;
  const optRules = localFilters?.optimizationRules;
  const regexOptResult = useMemo(() => {
    if (isCsFile || !isOptEnabled || !originalText) return null;
    return optimizeText(originalText, optRules || [], true);
  }, [isCsFile, originalText, isOptEnabled, optRules]);

  const diffHtml = useMemo(() => {
    if (isCsFile && csResult?.diffSpans) {
      return buildDiffHtmlFromEdits(originalText, csResult.diffSpans);
    }
    if (!isCsFile && regexOptResult) {
      return regexOptResult.optimizedText;
    }
    return '';
  }, [isCsFile, csResult, originalText, regexOptResult]);

  const isOptimizedAvailable = isCsFile
    ? csResult !== null && sandboxLevel !== 'none' && csResult.compressedBytes < csResult.originalBytes
    : regexOptResult !== null && regexOptResult.optimizedBytes < regexOptResult.originalBytes;

  const activeSize =
    viewMode !== 'original'
      ? isCsFile && csResult
        ? csResult.compressedBytes
        : regexOptResult
          ? regexOptResult.optimizedBytes
          : meta?.size || 0
      : meta?.size || 0;

  const savedBytes = isCsFile && csResult
    ? csResult.originalBytes - csResult.compressedBytes
    : regexOptResult
      ? regexOptResult.originalBytes - regexOptResult.optimizedBytes
      : 0;

  return (
    <>
      <div className="preview-header">
        <div className="preview-header-main">
          <div className="preview-title">
            {isCsFile ? <IconCode size={16} color="var(--comp-l2)" /> : <IconFileText size={16} color="var(--accent-primary)" />}
            <span>{node.name}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
            {isCsFile && (
              <div className="preview-cs-sandbox">
                <span className="preview-cs-label">{t('optimization.csharpTestLevel')}:</span>
                {CSHARP_COMPRESSION_LEVELS.map((lvl) => {
                  const lbl = CSHARP_LEVEL_SHORT_LABELS[lvl];
                  return (
                    <button
                      key={lvl}
                      type="button"
                      className={`preview-cs-btn level-${lbl.toLowerCase()} ${sandboxLevel === lvl ? 'active' : ''}`}
                      onClick={() => {
                        setSandboxOverride(lvl);
                        if (lvl !== 'none' && viewMode === 'original') {
                          setViewMode('optimized');
                        }
                      }}
                    >
                      {lbl}
                    </button>
                  );
                })}
                {(sandboxLevel !== node.csharpCompressionLevel || node.csharpCompressionSource !== 'direct') && (
                  <button
                    type="button"
                    className="preview-cs-apply-btn"
                    onClick={() => setNodeCSharpCompressionLevel(node.relativePath, sandboxLevel)}
                  >
                    {t('optimization.csharpApplyToFile')}
                  </button>
                )}
              </div>
            )}

            {(isOptimizedAvailable || (isCsFile && sandboxLevel !== 'none')) && (
              <div className="preview-tabs">
                <button
                  className={`preview-tab ${viewMode === 'original' ? 'active' : ''}`}
                  onClick={() => setViewMode('original')}
                >
                  {t('preview.original', 'Original')}
                </button>
                <button
                  className={`preview-tab ${viewMode === 'optimized' ? 'active success' : ''}`}
                  onClick={() => setViewMode('optimized')}
                >
                  <IconWand size={14} />
                  {t('preview.optimized', 'Compressed')}
                  {savedBytes > 0 && (
                    <span style={{ opacity: 0.8 }}>(-{formatFileSize(savedBytes)})</span>
                  )}
                </button>
                {(isCsFile && csResult?.diffSpans) || (!isCsFile && regexOptResult) ? (
                  <button
                    className={`preview-tab ${viewMode === 'diff' ? 'active' : ''}`}
                    onClick={() => setViewMode('diff')}
                  >
                    Diff
                  </button>
                ) : null}
              </div>
            )}

            <button className="context-menu-close-btn" onClick={onClose}>
              <IconX size={16} />
            </button>
          </div>
        </div>

        {meta && (
          <div className="preview-meta-bar">
            <span>
              {t('browser.path')}: <strong>{node.relativePath}</strong>
            </span>
            <span>
              {t('browser.size')}: <strong style={{ color: viewMode !== 'original' ? 'var(--success)' : 'inherit' }}>{formatFileSize(activeSize)}</strong>
            </span>
            <span>
              {t('stats.tokens')}: <strong style={{ color: viewMode !== 'original' ? 'var(--success)' : 'inherit' }}>~{estimateTokenCount(activeSize).toLocaleString()}</strong>
            </span>
            {isCsFile && csResult && (
              <span>
                AST: <strong style={{ color: csResult.hadSyntaxErrors ? 'var(--warning)' : 'var(--success)' }}>
                  {csResult.hadSyntaxErrors ? t('optimization.csharpParseErrors') : t('optimization.csharpParseClean')}
                </strong>
              </span>
            )}
            <span>
              {t('browser.modified')}: <strong>{meta.modified}</strong>
            </span>
          </div>
        )}

        {isTruncated && (
          <div className="preview-truncate-warning">
            <IconAlertTriangle size={14} />
            {t('result.largeWarningTitle')}
          </div>
        )}
      </div>

      <div className="preview-body">
        {isLoading || (isCsFile && isCompressingCs && viewMode !== 'original') ? (
          <div className="preview-loading">
            <IconLoader2 size={24} className="spin" />
            <span>{t('common.loading')}</span>
          </div>
        ) : viewMode === 'optimized' ? (
          isCsFile && csResult ? (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{csResult.compressedText}</pre>
          ) : regexOptResult ? (
            <div dangerouslySetInnerHTML={{ __html: regexOptResult.optimizedText }} />
          ) : (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{originalText}</pre>
          )
        ) : viewMode === 'diff' && diffHtml ? (
          <div dangerouslySetInnerHTML={{ __html: diffHtml }} />
        ) : (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{originalText}</pre>
        )}
      </div>
    </>
  );
}
