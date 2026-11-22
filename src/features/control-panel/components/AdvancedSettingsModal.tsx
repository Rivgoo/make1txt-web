import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  IconRestore, IconCode, IconFileZip, IconPlus, IconX, IconBinaryTree, 
  IconLanguage, IconLayoutNavbar, IconLayoutBottombar, IconFilter, IconBrandGit, IconDownload
} from '@tabler/icons-react';
import { Modal } from '@/shared/ui/Modal/Modal';
import { Button } from '@/shared/ui/Button/Button';
import { Select } from '@/shared/ui/Select/Select';
import { useFileStore, DEFAULT_GLOBAL_SETTINGS, DEFAULT_TREE_SYMBOLS } from '@/store/useFileStore';
import { generateTextTree } from '@/core/utils/tree.utils';
import { evaluateFileName } from '@/core/utils/export.utils';
import type { FileNode, FileSystemHandle, FileDelimiterFormat } from '@/core/types/file.types';
import './AdvancedSettingsModal.css';

const fakeHandle = { kind: 'file', name: 'fake' } as FileSystemHandle;

const MOCK_TREE_NODES: Partial<FileNode>[] = [
  { id: 'root', name: 'project-root', isDirectory: true, isIgnored: false, parentId: null, handle: fakeHandle },
  { id: '1', name: 'config.json', isDirectory: false, isIgnored: false, parentId: 'root', handle: fakeHandle },
  { id: '2', name: 'src', isDirectory: true, isIgnored: false, parentId: 'root', handle: fakeHandle },
  { id: '3', name: 'index.ts', isDirectory: false, isIgnored: false, parentId: '2', handle: fakeHandle },
  { id: '4', name: 'components', isDirectory: true, isIgnored: false, parentId: '2', handle: fakeHandle },
  { id: '5', name: 'Button.tsx', isDirectory: false, isIgnored: false, parentId: '4', handle: fakeHandle },
  { id: '6', name: 'utils', isDirectory: true, isIgnored: false, parentId: '4', handle: fakeHandle, outputMode: 'structure-only', outputModeSource: 'direct' },
  { id: '7', name: 'helpers', isDirectory: true, isIgnored: false, parentId: '6', handle: fakeHandle },
  { id: '8', name: 'math.ts', isDirectory: false, isIgnored: false, parentId: '7', handle: fakeHandle },
  { id: '9', name: 'deep', isDirectory: true, isIgnored: false, parentId: '7', handle: fakeHandle },
  { id: '10', name: 'core.ts', isDirectory: false, isIgnored: false, parentId: '9', handle: fakeHandle },
  { id: '11', name: 'styles.css', isDirectory: false, isIgnored: false, parentId: '2', handle: fakeHandle },
  { id: '12', name: 'node_modules', isDirectory: true, isIgnored: true, parentId: 'root', handle: fakeHandle },
  { id: '13', name: 'README.md', isDirectory: false, isIgnored: false, parentId: 'root', handle: fakeHandle },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function AdvancedSettingsModal({ isOpen, onClose }: Props) {
  const { t } = useTranslation();
  const { globalSettings, updateGlobalSettings, resetGlobalSettings } = useFileStore();
  const [local, setLocal] = useState(globalSettings);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  
  const [newExt, setNewExt] = useState('');
  const [newPath, setNewPath] = useState('');

  const TEMPLATES: Record<string, string> = {
    markdown: '### `${{path}}`\n```{{ext}}\n{{content}}\n```\n\n',
    classic: '================================================================\nFile: {{path}}\n================================================================\n\n{{content}}\n\n'
  };

  const TREE_PRESETS = [
    { name: 'ASCII', symbols: DEFAULT_TREE_SYMBOLS },
    { name: 'Simple', symbols: { branch: '|- ', last: '`- ', vertical: '|  ', space: '   ', ignoredSuffix: ' (ignored)', structureOnlySuffix: ' (structure-only)' } },
    { name: 'Indent', symbols: { branch: '  ', last: '  ', vertical: '  ', space: '  ', ignoredSuffix: ' (ignored)', structureOnlySuffix: ' (structure-only)' } }
  ];

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setLocal(globalSettings);
      setNewExt('');
      setNewPath('');
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    const handler = setTimeout(() => {
      if (JSON.stringify(local) !== JSON.stringify(globalSettings)) {
        updateGlobalSettings(local);
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [local, updateGlobalSettings, globalSettings, isOpen]);

  const handleReset = () => {
    if (window.confirm(t('settings.resetConfirm'))) {
      resetGlobalSettings();
      setLocal(DEFAULT_GLOBAL_SETTINGS);
    }
  };

  const handleFormatChange = (val: string) => {
    const format = val as FileDelimiterFormat;
    if (format === 'custom') {
      setLocal({ ...local, fileDelimiterFormat: format });
    } else {
      setLocal({ 
        ...local, 
        fileDelimiterFormat: format,
        outputTemplate: TEMPLATES[format]
      });
    }
  };

  const addExt = () => {
    const val = newExt.trim().toLowerCase();
    if (val && !local.ignoredExtensions.includes(val)) {
      setLocal({ ...local, ignoredExtensions: [...local.ignoredExtensions, val] });
    }
    setNewExt('');
  };

  const removeExt = (extToRemove: string) => {
    setLocal({ ...local, ignoredExtensions: local.ignoredExtensions.filter(e => e !== extToRemove) });
  };

  const addPath = () => {
    const val = newPath.trim();
    if (val && !local.ignoredPaths.includes(val)) {
      setLocal({ ...local, ignoredPaths: [...local.ignoredPaths, val] });
    }
    setNewPath('');
  };

  const removePath = (pathToRemove: string) => {
    setLocal({ ...local, ignoredPaths: local.ignoredPaths.filter(p => p !== pathToRemove) });
  };

  const previewText = (local.outputTemplate || DEFAULT_GLOBAL_SETTINGS.outputTemplate)
    .replace(/{{path}}/g, 'src/main.ts')
    .replace(/{{ext}}/g, 'ts')
    .replace(/{{content}}/g, 'console.log("Hello World");');

  const treePreviewRaw = generateTextTree(MOCK_TREE_NODES as FileNode[], {
    includeIgnored: true,
    symbols: local.treeSymbols || DEFAULT_TREE_SYMBOLS,
    showEmptyFolders: true
  });
  
  const treePreviewText = (local.treeWrapper || DEFAULT_GLOBAL_SETTINGS.treeWrapper).replace('{{tree}}', treePreviewRaw);

  const previewFileNameText = evaluateFileName(local.fileNameTemplate || DEFAULT_GLOBAL_SETTINGS.fileNameTemplate, { 
    folder: 'my-project', 
    filesCount: 42, 
    sizeBytes: 1048576 
  });

  const placementOptions = [
    { value: 'top', label: t('settings.labels.placementTop'), icon: <IconLayoutNavbar size={16}/> },
    { value: 'bottom', label: t('settings.labels.placementBottom'), icon: <IconLayoutBottombar size={16}/> }
  ];

  const languageOptions = [
    { value: 'auto', label: t('settings.langAuto'), icon: <IconLanguage size={16}/> },
    { value: 'en', label: t('settings.langEn'), icon: <IconLanguage size={16}/> },
    { value: 'uk', label: t('settings.langUk'), icon: <IconLanguage size={16}/> }
  ];

  const strategyOptions = [
    { value: 'default', label: t('settings.labels.strategyDefault') },
    { value: 'ask', label: t('settings.labels.strategyAsk') }
  ];

  const formatOptions = [
    { value: 'markdown', label: t('settings.labels.formatMarkdown') },
    { value: 'classic', label: t('settings.labels.formatClassic') },
    { value: 'custom', label: t('settings.labels.formatCustom') }
  ];

  return (
    <Modal isOpen={isOpen} title={t('settings.title')} maxWidth="850px" onClose={onClose}>
      <div className="advanced-settings-body">
        
        <div className="as-section">
          <h4><IconLanguage size={18}/> {t('settings.language')}</h4>
          <div className="as-group" style={{ maxWidth: '300px' }}>
            <Select 
              options={languageOptions}
              value={local.language || 'auto'}
              onChange={(val) => setLocal({ ...local, language: val as 'auto' | 'en' | 'uk' })}
            />
          </div>
        </div>

        <div className="as-section">
          <h4><IconFileZip size={18}/> {t('settings.sections.limits')}</h4>
          <div className="as-grid">
            <div className="as-group">
              <label>{t('settings.labels.globalExts')}</label>
              <div className="as-tag-input-row">
                <input 
                  className="as-input"
                  placeholder=".exe, .dll"
                  value={newExt}
                  onChange={(e) => setNewExt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addExt()}
                />
                <Button variant="secondary" onClick={addExt}><IconPlus size={16}/></Button>
              </div>
              <div className="as-tag-container">
                {(local.ignoredExtensions || []).map(ext => (
                  <span key={ext} className="as-tag-chip">
                    {ext}
                    <button className="as-tag-remove" onClick={() => removeExt(ext)}><IconX size={12}/></button>
                  </span>
                ))}
              </div>
            </div>

            <div className="as-group">
              <label>{t('settings.labels.globalPaths')}</label>
              <div className="as-tag-input-row">
                <input 
                  className="as-input"
                  placeholder="node_modules, .git"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPath()}
                />
                <Button variant="secondary" onClick={addPath}><IconPlus size={16}/></Button>
              </div>
              <div className="as-tag-container">
                {(local.ignoredPaths || []).map(p => (
                  <span key={p} className="as-tag-chip">
                    {p}
                    <button className="as-tag-remove" onClick={() => removePath(p)}><IconX size={12}/></button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="as-group">
            <label>{t('settings.labels.maxFileSize')}</label>
            <input 
              type="number" 
              className="as-input"
              value={local.maxFileSizeKb ?? 10240}
              onChange={(e) => setLocal({ ...local, maxFileSizeKb: Number(e.target.value) })}
            />
          </div>

          <div className="as-grid" style={{ marginTop: 'var(--spacing-md)' }}>
            <label className={`as-checkbox-card ${local.pruneIgnoredOnRead ? 'is-active' : ''}`}>
              <IconFilter size={18} className="as-checkbox-icon" />
              <span className="as-checkbox-label">{t('settings.labels.pruneIgnored')}</span>
              <input 
                type="checkbox" 
                checked={local.pruneIgnoredOnRead ?? true} 
                onChange={(e) => setLocal({ ...local, pruneIgnoredOnRead: e.target.checked })} 
                className="as-checkbox-input"
              />
            </label>

            <label className={`as-checkbox-card ${local.useGitignore ? 'is-active' : ''}`}>
              <IconBrandGit size={18} className="as-checkbox-icon" />
              <span className="as-checkbox-label">{t('settings.labels.useGitignore')}</span>
              <input 
                type="checkbox" 
                checked={local.useGitignore ?? true} 
                onChange={(e) => setLocal({ ...local, useGitignore: e.target.checked })} 
                className="as-checkbox-input"
              />
            </label>
          </div>
        </div>

        <div className="as-section">
          <h4><IconBinaryTree size={18}/> {t('settings.sections.structure')}</h4>
          <div className="as-grid">
            <div className="as-group">
              <label>{t('settings.labels.structurePlacement')}</label>
              <Select 
                options={placementOptions}
                value={local.treePlacement || 'top'}
                onChange={(val) => setLocal({ ...local, treePlacement: val as 'top' | 'bottom' })}
              />

              <div style={{ marginTop: 'var(--spacing-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>{t('settings.labels.configSymbols')}</label>
                  <div className="as-presets-row" style={{ marginBottom: 0 }}>
                    {TREE_PRESETS.map(preset => (
                      <Button 
                        key={preset.name} 
                        variant="secondary" 
                        onClick={() => setLocal({ ...local, treeSymbols: preset.symbols })}
                        style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                      >
                        {preset.name}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="as-tree-symbols-grid">
                  <div className="as-tree-symbol-item">
                    <label>{t('settings.labels.branch')}</label>
                    <input className="as-input" value={local.treeSymbols?.branch || ''} onChange={e => setLocal({...local, treeSymbols: {...local.treeSymbols, branch: e.target.value}})} />
                  </div>
                  <div className="as-tree-symbol-item">
                    <label>{t('settings.labels.last')}</label>
                    <input className="as-input" value={local.treeSymbols?.last || ''} onChange={e => setLocal({...local, treeSymbols: {...local.treeSymbols, last: e.target.value}})} />
                  </div>
                  <div className="as-tree-symbol-item">
                    <label>{t('settings.labels.vertical')}</label>
                    <input className="as-input" value={local.treeSymbols?.vertical || ''} onChange={e => setLocal({...local, treeSymbols: {...local.treeSymbols, vertical: e.target.value}})} />
                  </div>
                  <div className="as-tree-symbol-item">
                    <label>{t('settings.labels.space')}</label>
                    <input className="as-input" value={local.treeSymbols?.space || ''} onChange={e => setLocal({...local, treeSymbols: {...local.treeSymbols, space: e.target.value}})} />
                  </div>
                </div>
                <div className="as-tree-symbols-grid" style={{ marginTop: 'var(--spacing-xs)' }}>
                  <div className="as-tree-symbol-item">
                    <label>{t('settings.labels.ignoredMark')}</label>
                    <input className="as-input" value={local.treeSymbols?.ignoredSuffix || ''} onChange={e => setLocal({...local, treeSymbols: {...local.treeSymbols, ignoredSuffix: e.target.value}})} />
                  </div>
                  <div className="as-tree-symbol-item">
                    <label>{t('settings.labels.structureOnlyMark')}</label>
                    <input className="as-input" value={local.treeSymbols?.structureOnlySuffix ?? ' (structure-only)'} onChange={e => setLocal({...local, treeSymbols: {...local.treeSymbols, structureOnlySuffix: e.target.value}})} />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="as-group">
              <label>{t('settings.labels.structureWrapper')}</label>
              <textarea 
                className="as-textarea"
                style={{ minHeight: '60px' }}
                value={local.treeWrapper || DEFAULT_GLOBAL_SETTINGS.treeWrapper}
                onChange={(e) => setLocal({ ...local, treeWrapper: e.target.value })}
              />
              <div className="as-preview-box" style={{ marginTop: 'var(--spacing-xs)' }}>
                <span className="as-preview-label">{t('settings.labels.previewStructure')}</span>
                <pre>{treePreviewText}</pre>
              </div>
            </div>
          </div>
        </div>

        <div className="as-section">
          <h4><IconCode size={18}/> {t('settings.sections.formatting')}</h4>
          <div className="as-group">
            
            <div style={{ marginBottom: 'var(--spacing-sm)' }}>
               <label>{t('settings.labels.fileDelimiterFormat')}</label>
               <Select 
                 options={formatOptions}
                 value={local.fileDelimiterFormat || 'markdown'}
                 onChange={handleFormatChange}
               />
            </div>

            <label>{t('settings.labels.outputTemplate')}</label>
            <textarea 
              className="as-textarea"
              value={local.outputTemplate || DEFAULT_GLOBAL_SETTINGS.outputTemplate}
              onChange={(e) => setLocal({ ...local, outputTemplate: e.target.value, fileDelimiterFormat: 'custom' })}
            />

            <div className="as-preview-box">
              <span className="as-preview-label">{t('settings.labels.previewOutput')}</span>
              <pre>{previewText}</pre>
            </div>
          </div>
        </div>

        <div className="as-section">
          <h4><IconDownload size={18}/> {t('settings.sections.export')}</h4>
          
          <div className="as-group" style={{ marginBottom: 'var(--spacing-md)', maxWidth: '300px' }}>
            <label>{t('settings.labels.saveStrategy')}</label>
            <Select 
              options={strategyOptions}
              value={local.saveStrategy || 'default'}
              onChange={(val) => setLocal({ ...local, saveStrategy: val as 'default' | 'ask' })}
            />
          </div>

          <div className="as-group">
            <label>{t('settings.labels.fileNameTemplate')}</label>
            <input 
              className="as-input"
              value={local.fileNameTemplate || DEFAULT_GLOBAL_SETTINGS.fileNameTemplate}
              onChange={(e) => setLocal({ ...local, fileNameTemplate: e.target.value })}
            />
            
            <div className="as-variables-grid">
              <div className="as-var-item"><span className="as-var-code">{'{{folder}}'}</span>{t('settings.varsDesc.folder')}</div>
              <div className="as-var-item"><span className="as-var-code">{'{{files}}'}</span>{t('settings.varsDesc.files')}</div>
              <div className="as-var-item"><span className="as-var-code">{'{{size}}'}</span>{t('settings.varsDesc.size')}</div>
              <div className="as-var-item"><span className="as-var-code">{'{{date}}'}</span>{t('settings.varsDesc.date')}</div>
              <div className="as-var-item"><span className="as-var-code">{'{{time}}'}</span>{t('settings.varsDesc.time')}</div>
              <div className="as-var-item"><span className="as-var-code">{'{{timestamp:FORMAT}}'}</span>{t('settings.varsDesc.timestamp')}</div>
            </div>

            <div className="as-preview-box" style={{ marginTop: 'var(--spacing-md)', maxHeight: 'none', overflow: 'hidden' }}>
              <span className="as-preview-label">{t('settings.labels.previewFileName')}</span>
              <pre style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{previewFileNameText}</pre>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--spacing-sm)' }}>
          <Button variant="danger" onClick={handleReset}>
            <IconRestore size={16}/> {t('settings.resetToDefault')}
          </Button>
        </div>

      </div>
    </Modal>
  );
}