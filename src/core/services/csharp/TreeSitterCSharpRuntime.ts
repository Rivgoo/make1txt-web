export interface Point {
  row: number;
  column: number;
}

export interface FullSyntaxNode {
  type: string;
  text: string;
  isNamed: boolean;
  hasError: boolean;
  isMissing: boolean;
  startIndex: number;
  endIndex: number;
  startPosition: Point;
  endPosition: Point;
  childCount: number;
  namedChildCount: number;
  children: FullSyntaxNode[];
  namedChildren: FullSyntaxNode[];
  parent: FullSyntaxNode | null;
  nextSibling: FullSyntaxNode | null;
  previousSibling: FullSyntaxNode | null;
  child(index: number): FullSyntaxNode | null;
  namedChild(index: number): FullSyntaxNode | null;
  childForFieldName(fieldName: string): FullSyntaxNode | null;
}

export interface FullSyntaxTree {
  rootNode: FullSyntaxNode;
  delete(): void;
}

class TreeSitterCSharpRuntimeService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parser: any = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  get ready(): boolean {
    return this.isInitialized && this.parser !== null;
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const origin =
          typeof globalThis.location !== 'undefined' && globalThis.location.origin !== 'null'
            ? globalThis.location.origin
            : '';
        const scriptUrl = `${origin}/web-tree-sitter.js`;
        const TreeSitterModule = await import(/* @vite-ignore */ scriptUrl);

        const Parser = TreeSitterModule.Parser;
        const Language = TreeSitterModule.Language;

        if (!Parser || !Language) {
          throw new Error('Failed to extract Parser or Language classes from web-tree-sitter.js');
        }

        await Parser.init({
          locateFile(scriptName: string) {
            return `${origin}/${scriptName.replace(/^\/+/, '')}`;
          },
        });

        this.parser = new Parser();
        const language = await Language.load(`${origin}/tree-sitter-c_sharp.wasm`);
        this.parser.setLanguage(language);
        this.isInitialized = true;
      } catch (err) {
        this.initPromise = null;
        console.warn('[TreeSitterCSharpRuntime] Engine initialization failed:', err);
        throw err;
      }
    })();

    return this.initPromise;
  }

  /**
   * Node.js / Vitest initializer loading web-tree-sitter.cjs and WASM directly from disk.
   */
  async initForNode(publicDir: string): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const modName = 'node:module';
        const pathName = 'node:path';
        const { createRequire } = await import(/* @vite-ignore */ modName);
        const path = await import(/* @vite-ignore */ pathName);
        const require = createRequire(import.meta.url);
        const TreeSitterModule = require(path.join(publicDir, 'web-tree-sitter.cjs'));

        const Parser = TreeSitterModule.Parser ?? TreeSitterModule;
        const Language = TreeSitterModule.Language;

        if (!Parser || !Language) {
          throw new Error('Failed to load Parser or Language from web-tree-sitter.cjs');
        }

        await Parser.init({
          locateFile(scriptName: string) {
            return path.join(publicDir, scriptName.replace(/^\/+/, ''));
          },
        });

        this.parser = new Parser();
        const language = await Language.load(path.join(publicDir, 'tree-sitter-c_sharp.wasm'));
        this.parser.setLanguage(language);
        this.isInitialized = true;
      } catch (err) {
        this.initPromise = null;
        console.warn('[TreeSitterCSharpRuntime] Node initialization failed:', err);
        throw err;
      }
    })();

    return this.initPromise;
  }

  parse(text: string): FullSyntaxTree | null {
    if (!this.parser) return null;
    try {
      return this.parser.parse(text) as FullSyntaxTree | null;
    } catch (err) {
      console.warn('[TreeSitterCSharpRuntime] Parse failed:', err);
      return null;
    }
  }
}

export const treeSitterCSharpRuntime = new TreeSitterCSharpRuntimeService();
