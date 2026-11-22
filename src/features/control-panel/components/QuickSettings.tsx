import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  IconFileCode, IconFilter, 
  IconPlus, IconTrash, IconArrowUp, IconArrowDown, IconEyeOff, IconPencil,
  IconChecks, IconSquareX, IconEye, IconBinaryTree, IconWorld, IconMapPin, IconFolderOff, IconAlertCircle, IconLoader2,
  IconWand, IconChevronDown, IconChevronRight, IconRegex, IconCode, IconCpu
} from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button/Button';
import { useFileStore } from '@/store/useFileStore';
import { isValidGlobOrRegex } from '@/core/services/IgnoreService';
import { useToast } from '@/shared/context/useToast';
import './QuickSettings.css';

export function QuickSettings() {
  const { t } = useTranslation();
  const { 
    nodes, localFilters, updateLocalFilters, toggleExtension, setAllExtensionsState, 
    addCustomPattern, updateCustomPattern, toggleCustomPattern, removeCustomPattern, moveCustomPattern,
    globalSettings, needsManualTokenization, isTokenizing, tokenizationProgress, runTokenization, cancelTokenization, invalidateAllMetrics, getStats,
    toggleOptimization, toggleOptimizationRule, addCustomOptimizationRule, removeCustomOptimizationRule, applyOptimization
  } = useFileStore();
  
  const { showToast } = useToast();
  
  const [newPattern, setNewPattern] = useState('');
  const [editingPatternId, setEditingPatternId] = useState<string | null>(null);
  const [editPatternValue, setEditPatternValue] = useState('');

  const [isOptExpanded, setIsOptExpanded] = useState(false);
  const [newOptPattern, setNewOptPattern] = useState('');
  const [newOptReplace, setNewOptReplace] = useState('');

  const extensions = localFilters?.extensions || {};
  const sortedExtensions = Object.entries(extensions).sort((a, b) => b[1].count - a[1].count);

  const hasCsFiles = nodes.some(n => !n.isDirectory && n.name.toLowerCase().endsWith('.cs'));

  const handleAddPattern = () => {
    if (!newPattern.trim()) return;
    if (!isValidGlobOrRegex(newPattern.trim())) {
      showToast('warning', t('common.warning'), t('quickSettings.invalidPattern'));
      return;
    }
    addCustomPattern(newPattern.trim());
    setNewPattern('');
  };

  const startEditPattern = (id: string, currentVal: string) => {
    setEditingPatternId(id);
    setEditPatternValue(currentVal);
  };

  const saveEditPattern = () => {
    if (!editingPatternId) return;
    if (!editPatternValue.trim()) {
      removeCustomPattern(editingPatternId);
    } else if (isValidGlobOrRegex(editPatternValue.trim())) {
      updateCustomPattern(editingPatternId, editPatternValue.trim());
    } else {
      showToast('warning', t('common.warning'), t('quickSettings.ruleRejected'));
      return;
    }
    setEditingPatternId(null);
  };

  const handleAddOptRule = () => {
    if (!newOptPattern.trim()) return;
    try {
      new RegExp(newOptPattern);
      addCustomOptimizationRule({
        name: newOptPattern,
        category: 'custom',
        isActive: true,
        pattern: newOptPattern,
        flags: 'gm',
        replacement: newOptReplace
      });
      setNewOptPattern('');
      setNewOptReplace('');
    } catch {
      showToast('error', t('common.error'), t('optimization.invalidRegex'));
    }
  };

  const optRules = localFilters?.optimizationRules || [];
  const predefinedRules = optRules.filter(r => r.isPredefined);
  const customRules = optRules.filter(r => !r.isPredefined);
  const customPatterns = localFilters?.customPatterns || [];

  const stats = getStats();
  const structureOnlyFolderCount = Object.values(
    localFilters?.outputModeOverrides ?? {}
  ).filter((m) => m === 'structure-only').length;

  return (
    <div className="quick-settings">

      {isTokenizing ? (
        <div className="qs-section" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'var(--success)' }}>
          <div className="qs-header">
            <span className="qs-title" style={{ color: 'var(--success)' }}>
              <IconLoader2 size={16} className="spin" />
              {t('quickSettings.tokenCalcTitle')} ({tokenizationProgress}%)
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {t('quickSettings.tokenCalcDesc')}
          </p>
          <Button
            variant="danger"
            onClick={cancelTokenization}
            style={{ marginTop: 'var(--spacing-xs)', alignSelf: 'flex-start' }}
          >
            <IconSquareX size={16} />
            {t('common.cancel')}
          </Button>
        </div>
      ) : needsManualTokenization ? (
        <div className="qs-section" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', borderColor: 'var(--warning)' }}>
          <div className="qs-header">
            <span className="qs-title" style={{ color: 'var(--warning)' }}>
              <IconAlertCircle size={16} /> 
              {t('quickSettings.tokenWarningTitle')}
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {t('quickSettings.tokenWarningDesc')}
          </p>
          <Button 
            variant="secondary" 
            onClick={() => runTokenization(true)} 
            style={{ marginTop: 'var(--spacing-xs)', borderColor: 'var(--warning)', color: 'var(--warning)' }}
          >
            {t('quickSettings.calculateExact')}
          </Button>
        </div>
      ) : null}

      {sortedExtensions.length > 0 && (
        <div className="qs-section">
          <div className="qs-header">
            <span className="qs-title"><IconFileCode size={16}/> {t('quickSettings.extensions')}</span>
            <div className="qs-header-actions">
              <Button variant="secondary" onClick={() => setAllExtensionsState(true)}>
                <IconChecks size={14} /> {t('common.all')}
              </Button>
              <Button variant="secondary" onClick={() => setAllExtensionsState(false)}>
                <IconSquareX size={14} /> {t('common.none')}
              </Button>
            </div>
          </div>
          <div className="extensions-container">
            {sortedExtensions.map(([ext, stat]) => (
              <button 
                key={ext}
                className={`ext-chip ${stat.isActive ? '' : 'inactive'}`}
                onClick={() => toggleExtension(ext)}
              >
                {!stat.isActive && <IconEyeOff size={12} />}
                {ext} <span className="ext-count">{stat.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="qs-section">
        <div className="qs-header">
          <span className="qs-title"><IconFilter size={16}/> {t('quickSettings.customRules')}</span>
        </div>
        
        {customPatterns.length > 0 && (
          <div className="patterns-list">
            {customPatterns.map((p) => (
              <div key={p.id} className={`pattern-item ${p.isActive ? '' : 'inactive'}`}>
                {editingPatternId === p.id ? (
                  <input 
                    className="pattern-edit-input"
                    autoFocus
                    value={editPatternValue}
                    onChange={(e) => setEditPatternValue(e.target.value)}
                    onBlur={saveEditPattern}
                    onKeyDown={(e) => e.key === 'Enter' && saveEditPattern()}
                  />
                ) : (
                  <span style={{ cursor: 'pointer', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => toggleCustomPattern(p.id)}>
                    {p.pattern}
                  </span>
                )}
                
                {editingPatternId !== p.id && (
                  <div className="pattern-actions">
                    <button className="pattern-btn" onClick={() => moveCustomPattern(p.id, 'up')}><IconArrowUp size={14}/></button>
                    <button className="pattern-btn" onClick={() => moveCustomPattern(p.id, 'down')}><IconArrowDown size={14}/></button>
                    <button className="pattern-btn" onClick={() => startEditPattern(p.id, p.pattern)}><IconPencil size={14}/></button>
                    <button className="pattern-btn" onClick={() => toggleCustomPattern(p.id)}><IconEyeOff size={14}/></button>
                    <button className="pattern-btn danger" onClick={() => removeCustomPattern(p.id)}><IconTrash size={14}/></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="pattern-input-group">
          <input 
            className="pattern-input" 
            placeholder={t('quickSettings.placeholder')} 
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddPattern()}
          />
          <button className="pattern-btn" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0 8px' }} onClick={handleAddPattern}>
            <IconPlus size={16} color="var(--accent-primary)"/>
          </button>
        </div>
      </div>

      <div className="qs-section">
        <div 
          className={`qs-opt-header ${isOptExpanded ? 'expanded' : ''}`} 
          onClick={() => setIsOptExpanded(!isOptExpanded)}
        >
          <div className="qs-opt-title-group">
            <IconWand size={18} color="var(--accent-primary)" />
            <span>{t('optimization.title')}</span>
          </div>
          {isOptExpanded ? <IconChevronDown size={16} className="opt-expand-icon" /> : <IconChevronRight size={16} className="opt-expand-icon" />}
        </div>

        {isOptExpanded && (
          <div className="qs-opt-body">
            
            {localFilters?.isOptimizationDirty && nodes.length > 0 && (
              <div className="opt-apply-row">
                <span className="opt-apply-text">
                  <IconAlertCircle size={16} /> 
                  {t('optimization.dirtyWarning')}
                </span>
                <Button variant="primary" onClick={applyOptimization} disabled={isTokenizing}>
                  {isTokenizing ? <IconLoader2 size={16} className="spin" /> : <IconWand size={16} />}
                  {t('optimization.apply')}
                </Button>
              </div>
            )}

            <div 
              className={`toggle-row ${localFilters?.isOptimizationEnabled ? 'active' : ''}`}
              onClick={() => toggleOptimization(!localFilters?.isOptimizationEnabled)}
            >
              <span className="qs-title">{t('optimization.enable')}</span>
              <div className="toggle-switch" />
            </div>

            <div className={`opt-rule-group ${!localFilters?.isOptimizationEnabled ? 'disabled' : ''}`} style={{ opacity: localFilters?.isOptimizationEnabled ? 1 : 0.5, pointerEvents: localFilters?.isOptimizationEnabled ? 'auto' : 'none' }}>
              
              <span className="opt-rule-group-title">{t('optimization.predefined')}</span>
              <div className="opt-chips-container">
                {predefinedRules.map(rule => (
                  <button 
                    key={rule.id}
                    className={`opt-chip ${rule.isActive ? 'active' : ''}`}
                    onClick={() => toggleOptimizationRule(rule.id)}
                  >
                    {rule.isActive ? <IconChecks size={14} /> : <IconSquareX size={14} />}
                    {rule.name}
                  </button>
                ))}
              </div>

              <span className="opt-rule-group-title" style={{ marginTop: 'var(--spacing-sm)' }}>{t('optimization.custom')}</span>
              
              {customRules.length > 0 && (
                <div className="opt-custom-list">
                  {customRules.map(rule => (
                    <div key={rule.id} className={`opt-custom-item ${rule.isActive ? '' : 'inactive'}`}>
                      <div style={{ flex: 1, overflow: 'hidden', cursor: 'pointer' }} onClick={() => toggleOptimizationRule(rule.id)}>
                        <IconRegex size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                        <span className="opt-custom-code">{rule.pattern}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>&rarr;</span>
                        <span className="opt-custom-code">{rule.replacement || '""'}</span>
                      </div>
                      <div className="pattern-actions">
                        <button className="pattern-btn" onClick={() => toggleOptimizationRule(rule.id)}><IconEyeOff size={14}/></button>
                        <button className="pattern-btn danger" onClick={() => removeCustomOptimizationRule(rule.id)}><IconTrash size={14}/></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="opt-custom-inputs">
                <input 
                  className="opt-input" 
                  placeholder={t('optimization.patternPlaceholder')}
                  value={newOptPattern}
                  onChange={e => setNewOptPattern(e.target.value)}
                />
                <input 
                  className="opt-input" 
                  placeholder={t('optimization.replacePlaceholder')}
                  value={newOptReplace}
                  onChange={e => setNewOptReplace(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddOptRule()}
                />
                <button className="pattern-btn" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0 8px' }} onClick={handleAddOptRule}>
                  <IconPlus size={16} color="var(--accent-primary)"/>
                </button>
              </div>

            </div>
          </div>
        )}
      </div>

      <div className="qs-section">
        {!globalSettings.pruneIgnoredOnRead && (
          <div 
            className={`toggle-row ${localFilters?.showGloballyIgnored ? 'active' : ''}`}
            onClick={() => updateLocalFilters({ showGloballyIgnored: !localFilters?.showGloballyIgnored })}
          >
            <span className="qs-title"><IconWorld size={16}/> {t('quickSettings.showGloballyIgnored')}</span>
            <div className="toggle-switch" />
          </div>
        )}

        <div 
          className={`toggle-row ${localFilters?.showLocallyIgnored ? 'active' : ''}`}
          onClick={() => updateLocalFilters({ showLocallyIgnored: !localFilters?.showLocallyIgnored })}
        >
          <span className="qs-title"><IconMapPin size={16}/> {t('quickSettings.showLocallyIgnored')}</span>
          <div className="toggle-switch" />
        </div>

        <div 
          className={`toggle-row ${localFilters?.showEmptyFolders ? 'active' : ''}`}
          onClick={() => updateLocalFilters({ showEmptyFolders: !localFilters?.showEmptyFolders })}
        >
          <span className="qs-title"><IconFolderOff size={16}/> {t('quickSettings.showEmptyFolders')}</span>
          <div className="toggle-switch" />
        </div>
      </div>

      <div className="qs-section">
        <div 
          className={`toggle-row ${localFilters?.generateTree ? 'active' : ''}`}
          onClick={() => updateLocalFilters({ generateTree: !localFilters?.generateTree })}
        >
          <span className="qs-title"><IconBinaryTree size={16}/> {t('quickSettings.generateStructure')}</span>
          <div className="toggle-switch" />
        </div>

        <div 
          className={`toggle-row ${!localFilters?.generateTree ? 'disabled' : (localFilters?.treeIncludeIgnored ? 'active' : '')}`}
          onClick={() => localFilters?.generateTree && updateLocalFilters({ treeIncludeIgnored: !localFilters?.treeIncludeIgnored })}
        >
          <span className="qs-title"><IconEye size={16}/> {t('quickSettings.structureIncludeIgnored')}</span>
          <div className="toggle-switch" />
        </div>

        {(structureOnlyFolderCount > 0 || stats.structureOnlyFiles > 0) && (
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--spacing-xs)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--structure-only)' }}>
              <IconBinaryTree size={14} />
              <span>
                {t('structureOnly.activeBanner', {
                  folders: structureOnlyFolderCount,
                  files: stats.structureOnlyFiles,
                })}
              </span>
            </div>
            {!localFilters?.generateTree && (
              <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--warning)', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                  <IconAlertCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                  {t('structureOnly.treeDisabledWarning', { count: stats.structureOnlyFiles })}
                </span>
                <Button
                  variant="secondary"
                  onClick={() => updateLocalFilters({ generateTree: true })}
                  style={{ alignSelf: 'flex-start', padding: '2px 8px', fontSize: '0.72rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}
                >
                  {t('structureOnly.reEnableStructure')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      
      <div className="qs-section">
        <div 
          className={`toggle-row ${!hasCsFiles ? 'disabled' : (localFilters?.enableCSharpAnalysis ? 'active' : '')}`}
          onClick={() => {
            if (!hasCsFiles) return;
            updateLocalFilters({ enableCSharpAnalysis: !localFilters?.enableCSharpAnalysis });
          }}
          data-tooltip={!hasCsFiles ? "No .cs files in project" : undefined}
          data-tooltip-pos="top"
        >
          <span className="qs-title"><IconCode size={16}/> {t('quickSettings.enableCSharpAnalysis')}</span>
          <div className="toggle-switch" />
        </div>
      </div>

      <Button
        variant="secondary"
        isFullWidth
        disabled={stats.fullSelectedFiles === 0}
        onClick={() => {
          if (isTokenizing) {
            cancelTokenization();
            return;
          }
          if (stats.isExactTokens && stats.isBaseExactTokens) {
            invalidateAllMetrics();
          }
          runTokenization(true, true);
        }}
      >
        {isTokenizing ? (
          <>
            <IconSquareX size={16} />
            {t('common.cancel')} ({tokenizationProgress}%)
          </>
        ) : (
          <>
            <IconCpu size={16} />
            {t('quickSettings.calculateExact')}
          </>
        )}
      </Button>

    </div>
  );
}