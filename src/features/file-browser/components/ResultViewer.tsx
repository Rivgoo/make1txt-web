import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileStore } from '@/store/useFileStore';
import { Button } from '@/shared/ui/Button/Button';
import { 
  IconCopy, IconDownload, IconAlertTriangle, IconEye, 
  IconChevronUp, IconChevronDown, IconSettings, IconFileText, 
  IconFolder, IconWeight, IconCpu, IconLetterCase 
} from '@tabler/icons-react';
import { useToast } from '@/shared/context/useToast';
import { formatFileSize, estimateTokenCount, countWords } from '@/core/utils/stats.utils';
import { evaluateFileName, sanitizeFileName, executeDownload } from '@/core/utils/export.utils';
import './ResultViewer.css';
  
const MAX_PREVIEW_CHARS = 2_000_000;
const TRIGGER_TRUNCATE_CHARS = 3_000_000;

function copyViaTextarea(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyTextReliably(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to legacy path
    }
  }

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = new Blob([text], { type: 'text/plain' });
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return;
    } catch {
      // Fall through to legacy path
    }
  }

  const success = copyViaTextarea(text);
  if (!success) throw new Error('execCommand copy failed');
}

export function ResultViewer() {
  const { t } = useTranslation();
  const { generatedText, globalSettings, sessionFileName, setSessionFileName, rootHandle, getStats } = useFileStore();
  const { showToast } = useToast();
  
  const [showFull, setShowFull] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(() => {
    return localStorage.getItem('make1txt_exportPanelOpen') === 'true';
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isOversized = (generatedText?.length ?? 0) > TRIGGER_TRUNCATE_CHARS;

  const displayText = useMemo(() => {
    if (!generatedText) return '';
    if (isOversized && !showFull) {
      return generatedText.slice(0, MAX_PREVIEW_CHARS) + t('result.truncatedMark');
    }
    return generatedText;
  }, [generatedText, isOversized, showFull, t]);

  const toggleExportPanel = () => {
    const newState = !isExportPanelOpen;
    setIsExportPanelOpen(newState);
    localStorage.setItem('make1txt_exportPanelOpen', String(newState));
  };

  const handleCopy = useCallback(async () => {
    if (!generatedText || isCopying) return;
    setIsCopying(true);
    try {
      const sanitizedText = generatedText.replace(/\0/g, '');
      await copyTextReliably(sanitizedText);
      showToast('success', t('common.copied'), t('generator.copySuccess'));
    } catch {
      textareaRef.current?.select();
      showToast('error', t('common.error'), t('generator.copyError'));
    } finally {
      setIsCopying(false);
    }
  }, [generatedText, isCopying, showToast, t]);

  const baseFileName = useMemo(() => {
    const stats = getStats();
    return evaluateFileName(globalSettings.fileNameTemplate, {
      folder: rootHandle?.name || 'project',
      filesCount: stats.selectedFiles,
      sizeBytes: generatedText ? new Blob([generatedText]).size : 0
    });
  }, [globalSettings.fileNameTemplate, rootHandle?.name, generatedText, getStats]);

  useEffect(() => {
    if (!sessionFileName && generatedText) {
      setSessionFileName(baseFileName);
    }
  }, [baseFileName, sessionFileName, generatedText, setSessionFileName]);

  const finalFileName = sessionFileName || baseFileName;

  const handleDownload = useCallback(async () => {
    if (!generatedText || isDownloading) return;
    setIsDownloading(true);
    
    try {
      await executeDownload(generatedText, finalFileName, globalSettings.saveStrategy);
      showToast('success', t('common.success'), t('generator.downloadSuccess'));
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'CANCELLED') {
        showToast('info', t('common.info'), t('generator.downloadCancelled'));
      } else {
        showToast('error', t('common.error'), t('generator.downloadError'));
      }
    } finally {
      setIsDownloading(false);
    }
  }, [generatedText, finalFileName, globalSettings.saveStrategy, isDownloading, showToast, t]);

  const handleFileNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSessionFileName(e.target.value);
  };

  const handleFileNameBlur = () => {
    if (sessionFileName) {
      const clean = sanitizeFileName(sessionFileName);
      setSessionFileName(clean.endsWith('.txt') ? clean : `${clean}.txt`);
    }
  };

  const stats = useFileStore((s) => s.getStats)();
  const sizeEstimateBytes = generatedText ? new Blob([generatedText]).size : 0;
  const wordCount = generatedText ? countWords(generatedText) : 0;
  const tokenCount = stats.isExactTokens && stats.tokens > 0
    ? stats.tokens
    : estimateTokenCount(sizeEstimateBytes);
  const totalSavedTok = stats.optimizationSavedTokens + stats.structureOnlySavedTokens;

  return (
    <div className="result-wrapper">
      <header className="panel-header result-header" style={{ gap: 'var(--spacing-sm)' }}>
        <Button variant="secondary" onClick={handleCopy} disabled={isCopying}>
          <IconCopy size={18} /> {isCopying ? t('common.wait') : t('common.copy')}
        </Button>
        <div style={{ display: 'flex' }}>
          <Button variant="primary" onClick={handleDownload} disabled={isDownloading} style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}>
            <IconDownload size={18} /> {isDownloading ? t('common.wait') : t('common.downloadTxt')}
          </Button>
          <Button 
            variant="primary" 
            onClick={toggleExportPanel} 
            style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid rgba(255,255,255,0.2)', padding: '0 8px' }}
          >
            {isExportPanelOpen ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
          </Button>
        </div>
      </header>

      <main className="panel-content result-content">
        <div className={`export-panel-wrapper ${isExportPanelOpen ? 'is-open' : ''}`}>
          <div className="export-panel-layout">
            <div className="export-panel-col">
              <span className="export-panel-title">
                <IconSettings size={18} color="var(--accent-primary)" />
                {t('result.exportPanelTitle')}
              </span>
              
              <div className="export-input-group">
                <label>{t('result.finalFileName')}</label>
                <input 
                  className="export-input"
                  value={finalFileName}
                  onChange={handleFileNameChange}
                  onBlur={handleFileNameBlur}
                />
                <p>{t('result.finalFileNameDesc')}</p>
              </div>

              <div className="export-input-group">
                <label>{t('result.saveStrategy')}</label>
                <div className={`export-strategy-badge ${globalSettings.saveStrategy === 'ask' ? 'ask' : ''}`}>
                  {globalSettings.saveStrategy === 'ask' ? <IconFolder size={14} /> : <IconFileText size={14} />}
                  {globalSettings.saveStrategy === 'ask' ? t('result.askStrategy') : t('result.defaultStrategy')}
                </div>
              </div>
            </div>

            <div className="export-panel-col">
              <span className="export-panel-title">
                <IconFileText size={18} color="var(--accent-primary)" />
                {t('result.exportStats')}
              </span>
              
              <div className="export-stats-grid">
                <div className="export-stat-card">
                  <span className="export-stat-label"><IconWeight size={14} /> {t('stats.size')}</span>
                  <span className="export-stat-value">{formatFileSize(sizeEstimateBytes)}</span>
                </div>
                <div className="export-stat-card">
                  <span className="export-stat-label"><IconCpu size={14} /> {t('stats.tokens')}</span>
                  <span className="export-stat-value accent">
                    {!(stats.isExactTokens && stats.tokens > 0) && '~'}{tokenCount.toLocaleString()}
                  </span>
                </div>
                {totalSavedTok > 0 && (
                  <div className="export-stat-card">
                    <span className="export-stat-label">{t('optimization.tokensSaved')}</span>
                    <span className="export-stat-value" style={{ color: 'var(--success)' }}>
                      -{totalSavedTok.toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="export-stat-card">
                  <span className="export-stat-label"><IconLetterCase size={14} /> {t('stats.words')}</span>
                  <span className="export-stat-value">{wordCount.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          className="result-textarea"
          readOnly
          value={displayText}
        />
        
        {isOversized && !showFull && (
          <div className="result-warning-banner">
            <h3>
              <IconAlertTriangle size={20} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
              {t('result.largeWarningTitle')}
            </h3>
            <p>{t('result.largeWarningDesc').replace('{{size}}', formatFileSize(sizeEstimateBytes))}</p>
            <div className="result-warning-actions">
              <Button variant="secondary" onClick={() => setShowFull(true)}>
                <IconEye size={18} /> {t('result.showAll')}
              </Button>
              <Button variant="secondary" onClick={handleCopy} disabled={isCopying}>
                <IconCopy size={18} /> {isCopying ? t('common.wait') : t('common.copy')}
              </Button>
              <Button variant="primary" onClick={handleDownload} disabled={isDownloading}>
                <IconDownload size={18} /> {t('common.downloadTxt')}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}