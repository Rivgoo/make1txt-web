const BYTES_IN_KILOBYTE = 1024;

const CHARS_PER_TOKEN = 4;

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(BYTES_IN_KILOBYTE)),
    units.length - 1,
  );
  const size = bytes / Math.pow(BYTES_IN_KILOBYTE, unitIndex);
  const formatted = size >= 10 ? Math.round(size) : +size.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

export function estimateTokenCount(charOrByteLength: number): number {
  return Math.ceil(charOrByteLength / CHARS_PER_TOKEN);
}

const WORD_REGEX = /\b\w+\b/g;

export function countWords(text: string): number {
  return (text.match(WORD_REGEX) ?? []).length;
}

export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0 || idx === filename.length - 1) return 'no-extension';
  return filename.slice(idx).toLowerCase();
}

/**
 * Checks if the optimization resulted in a meaningful reduction.
 * Threshold is set to 1% (> 0.01).
 */
export function hasMeaningfulOptimization(original: number, optimized: number): boolean {
  if (original <= 0 || optimized >= original) return false;
  const saved = original - optimized;
  return (saved / original) > 0.01;
}

/**
 * Checks if optimization produced a meaningful reduction in either bytes (>1%) or tokens (>=10).
 */
export function isMeaningfullyOptimized(
  baseBytes: number,
  optBytes: number,
  baseTokens?: number | null,
  optTokens?: number | null
): boolean {
  const byteSaved = baseBytes > 0 && (baseBytes - optBytes) / baseBytes > 0.01;
  const tokenSaved =
    baseTokens != null &&
    optTokens != null &&
    baseTokens - optTokens >= 10;
  return byteSaved || tokenSaved;
}