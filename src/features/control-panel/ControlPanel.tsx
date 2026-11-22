import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  IconDeviceFloppy, IconSquareX, IconSettings, 
  IconChevronDown, IconChevronRight, IconFiles, 
  IconWeight, IconLetterCase, IconCpu, IconSparkles,
  IconAdjustments, IconWand, IconFolderOpen
} from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button/Button';
import { useFileStore } from '@/store/useFileStore';
import { formatFileSize, isMeaningfullyOptimized } from '@/core/utils/stats.utils';
import { useToast } from '@/shared/context/useToast';
import { QuickSettings } from './components/QuickSettings';
import { AdvancedSettingsModal } from './components/AdvancedSettingsModal';
import { ProfilesModal } from './components/ProfilesModal';
import { useGenerator } from './hooks/useGenerator';
import { useHotkey } from './hooks/useHotkey';
import '../layout/Layout.css';
import './ControlPanel.css';
import './components/ProgressBar.css';

export function ControlPanel() {
  const { t } = useTranslation();
  const [isProfilesOpen, setIsProfilesOpen] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  
  const [isStatsExpanded, setIsStatsExpanded] = useState(() => {
    const cached = localStorage.getItem('make1txt_statsExpanded');
    return cached !== 'false';
  });

  const { isGenerating, progress, startGeneration, cancelGeneration } = useGenerator();
  const { 
    fetchProfiles, getStats, isLoading, isTokenizing, tokenizationProgress, 
    localFilters, globalSettings, nodes, loadDirectory, checkProfileChanges, 
    hasUnsavedProfileChanges, saveActiveProfileChanges, appliedOptimizationHash
  } = useFileStore();
  
  const { showToast } = useToast();
  const stats = getStats();

  useEffect(() => {
    if (!isLoading && !isTokenizing) {
      checkProfileChanges();
    }
  }, [globalSettings, localFilters, isLoading, isTokenizing, checkProfileChanges]);

  useHotkey('enter', true, () => {
    if (!isGenerating && stats.selectedFiles > 0 && !isLoading) {
      startGeneration();
    }
  });

  const toggleStats = () => {
    const newVal = !isStatsExpanded;
    setIsStatsExpanded(newVal);
    localStorage.setItem('make1txt_statsExpanded', newVal.toString());
  };

  const handleOpenProfiles = async () => {
    try {
      await fetchProfiles();
      setIsProfilesOpen(true);
    } catch {
      showToast('error', t('common.error'), t('profiles.saveError'));
    }
  };

  const handleSaveActiveProfile = async () => {
    try {
      await saveActiveProfileChanges();
      showToast('success', t('common.success'), t('profiles.changesSaved'));
    } catch {
      showToast('error', t('common.error'), t('profiles.saveError'));
    }
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

  const optActive =
    ((localFilters?.isOptimizationEnabled ?? false) &&
      appliedOptimizationHash !== 'none') ||
    ((localFilters?.isCSharpCompressionEnabled ?? false) &&
      stats.compressedCSharpFiles > 0);
  const hasSavings =
    optActive &&
    isMeaningfullyOptimized(
      stats.totalSizeBytes,
      stats.totalOptimizedBytes,
      stats.baseTokens,
      stats.tokens
    );
  const hasStructureSavings = stats.structureOnlyFiles > 0;
  const savedTokens = stats.baseTokens - stats.tokens;
  const totalSelectedCs =
    stats.csharpLevelCounts.none +
    stats.csharpLevelCounts.clean +
    stats.csharpLevelCounts.compact +
    stats.csharpLevelCounts.skeleton +
    stats.csharpLevelCounts.contract;

  // Don't show save button while scanning/tokenizing
  const shouldShowSaveButton = hasUnsavedProfileChanges && !isLoading && !isTokenizing;

  if (nodes.length === 0 && !isLoading) {
    return (
      <aside className="panel-right">
        <div className="cp-empty-state">
           <IconAdjustments size={48} color="var(--text-muted)" stroke={1.5} />
           <div className="cp-empty-text">
             <h3>{t('panel.emptyStateTitle')}</h3>
             <p>{t('panel.emptyStateDesc')}</p>
           </div>
           <div className="cp-empty-actions">
             <Button variant="primary" onClick={handleSelectFolder} isFullWidth>
               <IconFolderOpen size={20} /> {t('browser.selectFolder')}
             </Button>
             <Button variant="secondary" onClick={() => setIsAdvancedOpen(true)} isFullWidth>
               <IconSettings size={20} /> {t('panel.settings')}
             </Button>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
               {shouldShowSaveButton && (
                 <Button variant="primary" onClick={handleSaveActiveProfile} title={t('profiles.saveChanges')} isFullWidth>
                   <IconDeviceFloppy size={20} /> {t('profiles.saveChanges')}
                 </Button>
               )}
               <Button variant="secondary" onClick={handleOpenProfiles} isFullWidth>
                 <IconDeviceFloppy size={20} /> {t('panel.profiles')}
               </Button>
             </div>
           </div>
        </div>
        <ProfilesModal isOpen={isProfilesOpen} onClose={() => setIsProfilesOpen(false)} />
        <AdvancedSettingsModal isOpen={isAdvancedOpen} onClose={() => setIsAdvancedOpen(false)} />
      </aside>
    );
  }

  return (
    <aside className="panel-right">
      <header className="panel-header" style={{ gap: 'var(--spacing-xs)', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1.25rem', flex: 1, display: 'flex', alignItems: 'center', gap: '8px', minWidth: '150px' }}>
          <IconAdjustments size={24} color="var(--accent-primary)" />
          {t('panel.settings')}
        </h2>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setIsAdvancedOpen(true)}>
            <IconSettings size={18} />
          </Button>
          {shouldShowSaveButton && (
            <Button variant="primary" onClick={handleSaveActiveProfile} title={t('profiles.saveChanges')}>
              <IconDeviceFloppy size={18} /> {t('profiles.saveChanges')}
            </Button>
          )}
          <Button variant="secondary" onClick={handleOpenProfiles} disabled={isGenerating || isLoading}>
            <IconDeviceFloppy size={18} /> {t('panel.profiles')}
          </Button>
        </div>
      </header>
      
      <main className="panel-content">
        <QuickSettings />

        <div>
          <div className="stats-header" onClick={toggleStats}>
            <div className="stats-header-title">
              {isStatsExpanded ? <IconChevronDown size={18}/> : <IconChevronRight size={18}/>}
              {t('stats.title')}
            </div>
          </div>
          
          {isStatsExpanded && (
            <div className="stats-grid">
              <div className="stat-box">
                <span className="stat-label"><IconFiles size={14}/> {t('stats.selected')}</span>
                <span className="stat-value">{stats.selectedFiles} <small>/ {stats.totalFiles}</small></span>
                {hasStructureSavings && (
                  <span className="stat-subtext">
                    ({stats.fullSelectedFiles} full · <span className="stat-cyan">{stats.structureOnlyFiles} meta</span>)
                  </span>
                )}
              </div>
              <div className="stat-box">
                <span className="stat-label"><IconWeight size={14}/> {t('stats.size')}</span>
                <span className="stat-value">{formatFileSize(stats.totalOptimizedBytes)}</span>
                {hasStructureSavings && (
                  <span className="stat-subtext stat-cyan">
                    -{formatFileSize(stats.structureOnlySavedBytes)} meta-only
                  </span>
                )}
              </div>
              
              {hasSavings && (
                <div className="stat-box">
                  <span className="stat-label"><IconWand size={14}/> {t('optimization.saved')}</span>
                  <span className="stat-value success">
                    -{formatFileSize(stats.totalSizeBytes - stats.totalOptimizedBytes)}
                  </span>
                </div>
              )}
              
              <div className="stat-box">
                <span className="stat-label"><IconLetterCase size={14}/> {t('stats.words')}</span>
                <span className="stat-value">{stats.totalWords.toLocaleString()}</span>
              </div>

              <div className="stat-box">
                <span className="stat-label" data-tooltip={stats.isExactTokens ? t('stats.exact') : t('stats.estimated')} data-tooltip-pos="top">
                  <IconCpu size={14}/> {t('stats.tokens')} {isTokenizing && `(${tokenizationProgress}%)`}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="stat-value accent">
                    {!stats.isExactTokens && '~'}{stats.tokens.toLocaleString()}
                  </span>
                  {hasSavings && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                      {!stats.isBaseExactTokens && '~'}{stats.baseTokens.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>

              {(hasSavings || hasStructureSavings) && (
                <div className="stat-box">
                  <span className="stat-label"><IconWand size={14}/> {t('optimization.tokensSaved')}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {hasSavings && (
                      <span className={`stat-value ${savedTokens >= 0 ? 'success' : 'warning'}`}>
                        {savedTokens > 0
                          ? `-${savedTokens.toLocaleString()}`
                          : savedTokens < 0
                            ? `+${Math.abs(savedTokens).toLocaleString()}`
                            : '0'}
                      </span>
                    )}
                    {hasStructureSavings && (
                      <span className="stat-subtext stat-cyan" style={{ fontWeight: 600 }}>
                        -{stats.structureOnlySavedTokens.toLocaleString()} (meta-only)
                      </span>
                    )}
                  </div>
                </div>
              )}

              {(localFilters?.isCSharpCompressionEnabled ?? false) && totalSelectedCs > 0 && (
                <div className="stat-box stat-box-wide">
                  <span className="stat-label">
                    {t('optimization.csharpMixTitle', { count: totalSelectedCs })}
                  </span>
                  <div className="cs-mix-bar">
                    {(
                      [
                        ['none', 'L0'],
                        ['clean', 'L1'],
                        ['compact', 'L2'],
                        ['skeleton', 'L3'],
                        ['contract', 'L4'],
                      ] as const
                    ).map(([lvl, label]) => (
                      <span
                        key={lvl}
                        className={`cs-mix-pill level-${label.toLowerCase()}`}
                      >
                        {label}: {stats.csharpLevelCounts[lvl]}
                      </span>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </main>

      <footer className="panel-footer">
        {isGenerating ? (
          <div className="progress-container">
            <div className="progress-info">
              <span>{t('panel.generating')}</span>
              <span>{t('panel.progress').replace('{{percent}}', progress.toString())}</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <Button variant="danger" isFullWidth onClick={cancelGeneration}>
              <IconSquareX size={18} /> {t('panel.cancelGeneration')}
            </Button>
          </div>
        ) : (
          <button 
            className="generate-btn"
            disabled={stats.selectedFiles === 0 || isLoading}
            onClick={startGeneration}
            title="Ctrl+Enter"
          >
            <IconSparkles size={20} />
            {t('panel.generateResult')}
          </button>
        )}
      </footer>

      <ProfilesModal isOpen={isProfilesOpen} onClose={() => setIsProfilesOpen(false)} />
      <AdvancedSettingsModal isOpen={isAdvancedOpen} onClose={() => setIsAdvancedOpen(false)} />
    </aside>
  );
}