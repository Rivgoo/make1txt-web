export const DEFAULT_IGNORED_DIRECTORIES = [
  // Version control
  '.git', '.svn', '.hg', '.bzr',

  // Node.js / JS / Frontend
  'node_modules', 'bower_components', 'jspm_packages',
  '.npm', '.yarn', '.pnpm-store',

  // Python
  'venv', '.venv', 'env', '.env', '__pycache__', '.pytest_cache',
  '.tox', 'eggs', 'wheels', '.mypy_cache', '.ruff_cache',

  // Java / JVM / Android
  'target', '.gradle', '.m2', 'captures',

  // C# / .NET
  'bin', 'obj', 'TestResults', 'packages', '.nuget',

  // C / C++ / Rust / Go
  'Debug', 'Release', 'x64', 'x86', 'pkg',

  // Ruby / PHP
  'vendor', 'bundle',

  // Mobile (iOS / Android)
  'Pods', 'DerivedData', '.symlinks',

  // Build / Output
  'dist', 'build', 'out', 'output', 'dist-ssr',

  // Frameworks & Cache
  '.next', '.nuxt', '.svelte-kit', '.cache', '.parcel-cache',
  '.vuepress', '.serverless', '.meteor', '.expo',

  // Testing / Coverage
  'coverage', '.nyc_output', 'htmlcov',

  // IDE
  '.idea', '.vscode', '.vs', '.fleet',

  // System / Temp
  'tmp', 'temp', 'logs', 'pids',
];

export const DEFAULT_IGNORED_EXTENSIONS = [
  // Images & Design
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.tiff',
  '.raw', '.heic', '.psd', '.ai', '.xd', '.sketch', '.fig', '.fbx', '.blend', '.stl',

  // Video
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.flv', '.m4v', '.3gp',

  // Audio
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a', '.mid', '.midi',

  // Archives
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz', '.tgz', '.iso', '.cab', '.dmg',

  // Binaries & Executables
  '.exe', '.dll', '.so', '.dylib', '.bin', '.obj', '.o', '.a', '.lib',
  '.pyc', '.pyd', '.class', '.jar', '.war', '.ear',
  '.apk', '.aab', '.ipa', '.app',
  '.sys', '.ko', '.el', '.nupkg', '.msi',

  // Documents / Office
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.rtf', '.odt', '.ods', '.odp', '.pages', '.numbers', '.key',

  // Databases
  '.sqlite', '.sqlite3', '.db', '.mdb', '.accdb', '.mdf', '.ldf', '.bson',

  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',

  // Logs, Cache, Maps, Temp
  '.log', '.lock', '.map', '.pdb', '.ilk', '.suo', '.user',
  '.cache', '.tmp', '.temp', '.bak', '.swp', '.pid', '.seed', '.meta',

  // VM / Containers
  '.vmdk', '.vdi', '.vbox', '.ova',

  // Keys & Certs
  '.keystore', '.jks', '.pfx', '.p12', '.der', '.cer', '.crt',
];

/**
 * Parses a .gitignore file content into a list of compiled RegExp matchers.
 */
export function createIgnoreRegexes(gitignoreContent: string): RegExp[] {
  const regexes: RegExp[] = [];
  for (const rawLine of gitignoreContent.split(/\r?\n/)) {
    // Strip trailing unescaped whitespace
    const line = rawLine.replace(/(?<!\\)\s+$/, '').trimStart();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    try {
      regexes.push(compileGlobToRegex(line));
    } catch {
      // Ignore malformed lines in .gitignore
    }
  }
  return regexes;
}

function escapeRegexChar(ch: string): string {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

export function compileGlobToRegex(pattern: string): RegExp {
  let cleaned = pattern.replace(/(?<!\\)\s+$/, '').trimStart();

  if (cleaned.startsWith('\\#') || cleaned.startsWith('\\!')) {
    cleaned = cleaned.slice(1);
  }

  if (cleaned.endsWith('/') && !cleaned.endsWith('\\/')) {
    cleaned = cleaned.slice(0, -1);
  }

  let isRootAnchored = false;
  if (cleaned.startsWith('/')) {
    isRootAnchored = true;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('**/')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.includes('/')) {
    isRootAnchored = true;
  }

  let regexStr = '';
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (ch === '\\' && i + 1 < cleaned.length) {
      regexStr += escapeRegexChar(cleaned[++i]);
      continue;
    }

    if (ch === '*') {
      if (cleaned[i + 1] === '*') {
        if (cleaned[i + 2] === '/') {
          regexStr += '(?:.+/)?';
          i += 2;
        } else {
          regexStr += '.*';
          i += 1;
        }
      } else {
        regexStr += '[^/]*';
      }
      continue;
    }

    if (ch === '?') {
      regexStr += '[^/]';
      continue;
    }

    if (ch === '[') {
      // Find closing unescaped ']'
      let j = i + 1;
      if (j < cleaned.length && (cleaned[j] === '!' || cleaned[j] === '^')) j++;
      if (j < cleaned.length && cleaned[j] === ']') j++;
      while (j < cleaned.length && cleaned[j] !== ']') {
        if (cleaned[j] === '\\' && j + 1 < cleaned.length) j++;
        j++;
      }
      if (j < cleaned.length && cleaned[j] === ']') {
        let content = cleaned.slice(i + 1, j);
        if (content.startsWith('!')) {
          content = '^' + content.slice(1);
        }
        regexStr += `[${content}]`;
        i = j;
        continue;
      }
      regexStr += '\\[';
      continue;
    }

    regexStr += escapeRegexChar(ch);
  }

  // ^(?:[^/]+/)? skips the injected workspace root folder name (e.g. "uCSS/")
  // while strictly anchoring the pattern to the project root.
  const prefix = isRootAnchored ? '^(?:[^/]+/)?' : '(?:^|/)';

  return new RegExp(`${prefix}${regexStr}(?:/|$)`);
}

export function isValidGlobOrRegex(pattern: string): boolean {
  if (!pattern.trim()) return false;
  try {
    compileGlobToRegex(pattern);
    return true;
  } catch {
    return false;
  }
}

export function isPathGloballyIgnored(
  relativePath: string,
  ignoredDirs: string[] = DEFAULT_IGNORED_DIRECTORIES,
): boolean {
  const parts = relativePath.split('/');
  return ignoredDirs.some(dir => parts.includes(dir));
}