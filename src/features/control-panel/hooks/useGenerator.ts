import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileStore } from '@/store/useFileStore';
import { useToast } from '@/shared/context/useToast';
import type { WorkerInput, WorkerOutput } from '@/core/types/worker.types';
import { generateTextTree } from '@/core/utils/tree.utils';
import { runBundleGeneration } from '@/core/services/BundleGeneratorEngine';

export function useGenerator() {
  const { t } = useTranslation();
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const {
    nodes,
    globalSettings,
    localFilters,
    isRestoredFromProfile,
    setGeneratedText,
    setActiveTab,
  } = useFileStore();
  const { showToast } = useToast();

  const cancelGeneration = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsGenerating(false);
    setProgress(0);
    showToast('warning', t('common.warning'), t('generator.cancelled'));
  }, [showToast, t]);

  const assembleFinalText = useCallback(
    (fileContentText: string, metaMap?: Record<string, string>): string => {
      if (!localFilters?.generateTree) return fileContentText;

      const rawTree = generateTextTree(nodes, {
        includeIgnored: localFilters.treeIncludeIgnored,
        symbols: globalSettings.treeSymbols,
        showEmptyFolders: localFilters.showEmptyFolders,
        metaMap,
      });

      if (!rawTree) return fileContentText;

      const treeString = globalSettings.treeWrapper.replace('{{tree}}', () => rawTree);

      return globalSettings.treePlacement === 'top'
        ? treeString + fileContentText
        : fileContentText + treeString;
    },
    [localFilters, globalSettings, nodes]
  );

  const startGeneration = useCallback(async () => {
    const selectedFiles = nodes
      .filter((n) => n.isSelected && !n.isIgnored && !n.isDirectory)
      .map((n) => ({
        handle: n.handle as FileSystemFileHandle | null,
        path: n.relativePath,
        content: n.content,
        outputMode: n.outputMode,
        csharpCompressionLevel: n.csharpCompressionLevel,
      }));

    if (selectedFiles.length === 0) {
      showToast('warning', t('common.warning'), t('generator.empty'));
      return;
    }

    setIsGenerating(true);
    setProgress(0);

    const maxFileSizeBytes =
      globalSettings.maxFileSizeKb > 0 ? globalSettings.maxFileSizeKb * 1024 : 0;

    const enableCSharpAnalysis = localFilters?.enableCSharpAnalysis ?? true;

    if (!isRestoredFromProfile) {
      workerRef.current = new Worker(
        new URL('@/core/workers/generator.worker.ts', import.meta.url),
        { type: 'module' }
      );

      workerRef.current.onmessage = async (e: MessageEvent<WorkerOutput>) => {
        const data = e.data;

        if (data.type === 'progress') {
          setProgress(data.progress);
        } else if (data.type === 'done') {
          const fileContentText = await data.blob.text();
          const finalText = assembleFinalText(fileContentText, data.metaMap);
          setGeneratedText(finalText);
          setActiveTab('result');
          setIsGenerating(false);
          setProgress(100);
          showToast('success', t('common.success'), t('generator.done'));
          workerRef.current?.terminate();
          workerRef.current = null;
        } else if (data.type === 'error') {
          setIsGenerating(false);
          showToast('error', t('common.error'), data.error);
          workerRef.current?.terminate();
          workerRef.current = null;
        }
      };

      workerRef.current.onerror = (err) => {
        console.error('Worker error:', err);
        setIsGenerating(false);
        showToast('error', t('common.error'), t('generator.error'));
        workerRef.current?.terminate();
        workerRef.current = null;
      };

      const payload: WorkerInput = {
        files: selectedFiles,
        template: globalSettings.outputTemplate,
        maxFileSizeBytes,
        isOptimizationEnabled: localFilters?.isOptimizationEnabled ?? false,
        optimizationRules: localFilters?.optimizationRules ?? [],
        isCSharpCompressionEnabled: localFilters?.isCSharpCompressionEnabled ?? false,
        csharpCompressionOptions: localFilters?.csharpCompressionOptions,
        enableCSharpAnalysis,
      };
      workerRef.current.postMessage(payload);
    } else {
      // Main-thread fallback for IndexedDB-restored profile handles
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const { blob, metaMap } = await runBundleGeneration({
          files: selectedFiles,
          template: globalSettings.outputTemplate,
          maxFileSizeBytes,
          isOptimizationEnabled: localFilters?.isOptimizationEnabled ?? false,
          optimizationRules: localFilters?.optimizationRules ?? [],
          isCSharpCompressionEnabled: localFilters?.isCSharpCompressionEnabled ?? false,
          csharpCompressionOptions: localFilters?.csharpCompressionOptions,
          enableCSharpAnalysis,
          signal: controller.signal,
          onProgress: (p) => setProgress(p),
          fileErrorTemplate: t('generator.fileError'),
        });

        const fileContentText = await blob.text();
        const finalText = assembleFinalText(fileContentText, metaMap);
        setGeneratedText(finalText);
        setActiveTab('result');
        setProgress(100);
        showToast('success', t('common.success'), t('generator.done'));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('Generation error:', err);
        showToast('error', t('common.error'), t('generator.error'));
      } finally {
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    }
  }, [
    nodes,
    globalSettings,
    localFilters,
    isRestoredFromProfile,
    showToast,
    setGeneratedText,
    setActiveTab,
    assembleFinalText,
    t,
  ]);

  return { isGenerating, progress, startGeneration, cancelGeneration };
}
