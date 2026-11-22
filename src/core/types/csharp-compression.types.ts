import type { EditKind } from '../services/csharp/EditEngine';

export type CSharpCompressionLevel =
  | 'none'      // L0: Raw C# (0% AST compression)
  | 'clean'     // L1: Lossless hygiene (25-42% reduction, 100% semantics)
  | 'compact'   // L2: Logic-preserving semantic compact (42-62% reduction)
  | 'skeleton'  // L3: Implementation elision + call-graph stubs (68-85% reduction)
  | 'contract'; // L4: Public API contract stubs (82-94% reduction)

export type HierarchicalOverrideSource = 'default' | 'direct' | 'inherited';

export interface CSharpCompressionOptions {
  /** Keep private [SerializeField] / [SerializeReference] fields even in L4 Contract mode (Default: true). */
  preserveUnitySerializedFields: boolean;
  /** Keep Unity lifecycle signatures (Awake/Start/Update/OnEnable/etc.) in L3 (Default: true). */
  preserveUnityLifecycleMethods: boolean;
  /** Keep // TODO, // FIXME, // HACK, // INVARIANT, // SAFETY comments in L1 & L2 (Default: true). */
  preserveTodoComments: boolean;
  /** Strip pure-argument diagnostic logs (Debug.Log, _logger.LogDebug/Info) in L2 (Default: true). */
  stripDiagnosticLogsInCompact: boolean;
  /** Emit semantic call-graph/throws comment stubs in L3 instead of bare '{ ... }' (Default: true). */
  emitCallGraphStubsInSkeleton: boolean;
  /** Preserve non-standard project 'using' directives in L2 & L3 (Default: true). */
  preserveProjectUsings: boolean;
  /** Indentation unit for compressed layout: 0 (flat), 1 (1 space, default optimal), or 2 (2 spaces). */
  indentSpaces: 0 | 1 | 2;
  /** Max statement count to keep inline in L3 Skeleton before eliding body (Default: 2). */
  skeletonInlineStatementLimit: number;
}

export interface CSharpCompressionConfig {
  level: CSharpCompressionLevel;
  options: CSharpCompressionOptions;
}

export interface CSharpCompressionDiffSpan {
  start: number;
  end: number;
  replacement: string;
  kind: EditKind;
}

export interface CSharpCompressionResult {
  compressedText: string;
  originalBytes: number;
  compressedBytes: number;
  appliedLevel: CSharpCompressionLevel;
  hadSyntaxErrors: boolean;
  transformsApplied: string[];
  /** Non-overlapping applied edit spans in original source coordinates (for preview diff). */
  diffSpans?: CSharpCompressionDiffSpan[];
}
