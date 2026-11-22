import type {
  CSharpCompressionLevel,
  CSharpCompressionOptions,
} from '../types/csharp-compression.types';

export const CSHARP_COMPRESSION_LEVELS: readonly CSharpCompressionLevel[] = [
  'none',
  'clean',
  'compact',
  'skeleton',
  'contract',
] as const;

export const CSHARP_LEVEL_SHORT_LABELS: Record<CSharpCompressionLevel, string> = {
  none: 'L0',
  clean: 'L1',
  compact: 'L2',
  skeleton: 'L3',
  contract: 'L4',
};

export const DEFAULT_CSHARP_COMPRESSION_OPTIONS: CSharpCompressionOptions = {
  preserveUnitySerializedFields: true,
  preserveUnityLifecycleMethods: true,
  preserveTodoComments: true,
  stripDiagnosticLogsInCompact: true,
  emitCallGraphStubsInSkeleton: true,
  preserveProjectUsings: true,
  indentSpaces: 1,
  skeletonInlineStatementLimit: 2,
};

/** Tier-C: Purely visual, inspector, debugger, or static-analyzer noise. Safe to strip at L1+. */
export const TIER_C_NOISE_ATTRIBUTES = new Set([
  'Header', 'Tooltip', 'Space', 'Range', 'Min', 'Multiline', 'TextArea',
  'HideInInspector', 'InspectorName', 'ColorUsage', 'GradientUsage',
  'ContextMenu', 'ContextMenuItem', 'HelpURL', 'AddComponentMenu', 'CreateAssetMenu',
  'DebuggerDisplay', 'DebuggerStepThrough', 'DebuggerHidden', 'DebuggerBrowsable',
  'DebuggerNonUserCode', 'ExcludeFromCodeCoverage', 'SuppressMessage',
  'EditorBrowsable', 'Browsable', 'Category', 'Description', 'DisplayName',
  'GeneratedCode', 'CompilerGenerated', 'InternalsVisibleTo',
]);

/** Tier-B: Optimization / compiler hints. Preserved at L1, stripped at L2+. */
export const TIER_B_HINT_ATTRIBUTES = new Set([
  'MethodImpl', 'Pure', 'NotNull', 'CanBeNull', 'JetBrains.Annotations.NotNull',
  'DisallowNull', 'AllowNull', 'MaybeNull', 'DoesNotReturn', 'CallerMemberName',
  'CallerFilePath', 'CallerLineNumber', 'Obsolete', 'Serializable',
]);

/** Tier-A: Domain, DI, Serialization, Routing, Networking, Testing contracts. Preserved through L4! */
export const TIER_A_CONTRACT_ATTRIBUTES = new Set([
  // Unity Serialization & Networking
  'SerializeField', 'SerializeReference', 'SyncVar', 'Command', 'ClientRpc',
  'TargetRpc', 'ServerRpc', 'Rpc', 'RequireComponent', 'ExecuteAlways', 'ExecuteInEditMode',
  // DI & Lifecycle
  'Inject', 'FromServices', 'FromBody', 'FromQuery', 'FromRoute', 'FromHeader',
  // ASP.NET / Web API / Auth
  'ApiController', 'Route', 'HttpGet', 'HttpPost', 'HttpPut', 'HttpDelete', 'HttpPatch',
  'Authorize', 'AllowAnonymous', 'ProducesResponseType', 'Consumes', 'Produces',
  // Serialization & Data Modeling
  'JsonPropertyName', 'JsonProperty', 'JsonIgnore', 'JsonConverter', 'DataContract', 'DataMember',
  'Table', 'Column', 'Key', 'ForeignKey', 'InverseProperty', 'NotMapped', 'Index',
  'Required', 'MaxLength', 'StringLength', 'RegularExpression', 'EmailAddress',
  // Type Semantics & Testing
  'Flags', 'StructLayout', 'FieldOffset', 'DllImport', 'LibraryImport',
  'Fact', 'Theory', 'InlineData', 'Test', 'TestCase', 'SetUp', 'TearDown',
]);

/** Standard BCL / Unity / Microsoft namespaces stripped in L2+ when preserveProjectUsings is true. */
export const STANDARD_SYSTEM_USING_PREFIXES = [
  'System',
  'Microsoft',
  'UnityEngine',
  'UnityEditor',
  'Unity',
  'TMPro',
];

export const UNITY_SERIALIZATION_ATTRIBUTES = new Set([
  'SerializeField',
  'SerializeReference',
]);

export const UNITY_LIFECYCLE_METHODS = new Set([
  'Awake',
  'Start',
  'Update',
  'FixedUpdate',
  'LateUpdate',
  'OnEnable',
  'OnDisable',
  'OnDestroy',
  'OnValidate',
  'Reset',
  'OnGUI',
  'OnApplicationQuit',
  'OnApplicationPause',
  'OnApplicationFocus',
  'OnTriggerEnter',
  'OnTriggerExit',
  'OnTriggerStay',
  'OnTriggerEnter2D',
  'OnTriggerExit2D',
  'OnCollisionEnter',
  'OnCollisionExit',
  'OnCollisionStay',
  'OnCollisionEnter2D',
  'OnCollisionExit2D',
]);

/** Diagnostic logger receiver/method patterns eligible for pure-argument stripping in L2/L3. */
export const DIAGNOSTIC_LOG_CALLEES = new Set([
  'Debug.Log',
  'Debug.LogWarning',
  'Debug.LogAssertion',
  'UnityEngine.Debug.Log',
  'UnityEngine.Debug.LogWarning',
  'Console.WriteLine',
  'Console.Write',
  'Profiler.BeginSample',
  'Profiler.EndSample',
]);

export const DIAGNOSTIC_LOG_METHOD_NAMES = new Set([
  'LogTrace',
  'LogDebug',
  'LogInformation',
  'LogWarning',
]);

/** Pure formatters / metadata helpers allowed inside diagnostic log arguments. */
export const SAFE_LOG_FORMATTER_NAMES = new Set([
  'nameof',
  'ToString',
  'Format',
  'GetType',
]);

/** Noisy methods excluded from L3 Semantic Call-Graph stubs. */
export const CALL_GRAPH_NOISE_METHODS = new Set([
  'ToString',
  'GetType',
  'GetHashCode',
  'Equals',
  'Count',
  'Any',
  'First',
  'FirstOrDefault',
  'Select',
  'Where',
  'ToList',
  'ToArray',
  'Log',
  'LogWarning',
  'LogDebug',
  'LogTrace',
  'LogInformation',
  'WriteLine',
  'BeginSample',
  'EndSample',
]);
