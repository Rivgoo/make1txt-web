import type { FullSyntaxNode } from '../TreeSitterCSharpRuntime';
import type { TextEdit } from '../EditEngine';
import type { CSharpCompressionConfig } from '@/core/types/csharp-compression.types';
import {
  DIAGNOSTIC_LOG_CALLEES,
  DIAGNOSTIC_LOG_METHOD_NAMES,
  SAFE_LOG_FORMATTER_NAMES,
} from '@/core/constants/csharp-compression.constants';
import {
  expandLineDeletionEnd,
  findChildByType,
  findChildrenByType,
  getModifierTexts,
} from './astHelpers';

const SCOPE_OWNER_TYPES = new Set([
  'method_declaration',
  'constructor_declaration',
  'accessor_declaration',
  'local_function_statement',
  'lambda_expression',
  'anonymous_method_expression',
  'block',
  'for_statement',
  'foreach_statement',
  'catch_clause',
  'switch_section',
  'using_statement',
]);

const UNSAFE_VAR_TYPES = new Set([
  'implicit_type',
  'nullable_type',
  'pointer_type',
  'array_type',
]);

function normalizeTypeText(text: string): string {
  return text.replace(/\s+/g, '');
}

function tryEmitTargetTypedNew(
  varDecl: FullSyntaxNode,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  if (varDecl.hasError) return;

  const declarators = findChildrenByType(varDecl, 'variable_declarator');
  if (declarators.length !== 1) return;

  const declarator = declarators[0];
  const objCreation = findChildByType(declarator, 'object_creation_expression');
  if (!objCreation || objCreation.hasError) return;

  const lhsType = varDecl.childForFieldName('type') ?? varDecl.namedChild(0);
  if (!lhsType || UNSAFE_VAR_TYPES.has(lhsType.type) || lhsType.text === 'var' || lhsType.text === 'dynamic') {
    return;
  }

  const rhsType = objCreation.childForFieldName('type');
  if (!rhsType) return;

  if (normalizeTypeText(lhsType.text) !== normalizeTypeText(rhsType.text)) {
    return;
  }

  // Find the `new` keyword child in object_creation_expression
  let newKeyword: FullSyntaxNode | null = null;
  for (let i = 0; i < objCreation.childCount; i++) {
    const c = objCreation.child(i);
    if (c && c.text === 'new') {
      newKeyword = c;
      break;
    }
  }
  if (!newKeyword) return;

  // Replace `new TypeName(...)` -> `new(...)` by deleting from end of `new` to end of `rhsType`
  edits.push({
    start: newKeyword.endIndex,
    end: rhsType.endIndex,
    replacement: '',
    priority: 22,
    kind: 'delete',
    ruleId: 'T08',
  });
  transformsApplied.add('T08');
}

function collectDeclaredNamesInNode(node: FullSyntaxNode, frame: Set<string>): void {
  if (node.type === 'parameter') {
    const nameNode = node.childForFieldName('name') ?? findChildByType(node, 'identifier');
    if (nameNode) frame.add(nameNode.text);
    return;
  }
  if (node.type === 'variable_declarator') {
    const nameNode = node.childForFieldName('name') ?? findChildByType(node, 'identifier');
    if (nameNode) frame.add(nameNode.text);
    return;
  }
  if (node.type === 'declaration_expression' || node.type === 'catch_declaration') {
    const nameNode = node.childForFieldName('name') ?? findChildByType(node, 'identifier');
    if (nameNode) frame.add(nameNode.text);
    return;
  }
  if (node.type === 'local_function_statement') {
    const nameNode = node.childForFieldName('name') ?? findChildByType(node, 'identifier');
    if (nameNode) frame.add(nameNode.text);
    return;
  }
  if (node.type === 'foreach_statement') {
    const left = node.childForFieldName('left');
    if (left && left.type === 'identifier') frame.add(left.text);
  }
}

function prescanScopeFrame(scopeOwner: FullSyntaxNode): Set<string> {
  const frame = new Set<string>();

  if (scopeOwner.type === 'accessor_declaration') {
    const first = scopeOwner.child(0);
    if (first && (first.text === 'set' || first.text === 'init' || first.text === 'add' || first.text === 'remove')) {
      frame.add('value');
    }
  }

  if (scopeOwner.type === 'lambda_expression') {
    const paramList = findChildByType(scopeOwner, 'parameter_list');
    if (paramList) {
      for (const p of findChildrenByType(paramList, 'parameter')) {
        collectDeclaredNamesInNode(p, frame);
      }
    } else {
      const singleParam = scopeOwner.childForFieldName('parameters') ?? findChildByType(scopeOwner, 'identifier');
      if (singleParam && singleParam.type === 'identifier') {
        frame.add(singleParam.text);
      }
    }
  }

  // Pre-scan direct declarations inside this scope without descending into nested scope owners
  const scanChildren = (n: FullSyntaxNode) => {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (!c) continue;
      collectDeclaredNamesInNode(c, frame);
      if (!SCOPE_OWNER_TYPES.has(c.type)) {
        scanChildren(c);
      }
    }
  };
  scanChildren(scopeOwner);

  return frame;
}

function isNameShadowed(name: string, scopeStack: Set<string>[]): boolean {
  for (let i = scopeStack.length - 1; i >= 0; i--) {
    if (scopeStack[i].has(name)) return true;
  }
  return false;
}

function hasSideEffectsInSubtree(node: FullSyntaxNode): boolean {
  if (
    node.type === 'assignment_expression' ||
    node.type === 'object_creation_expression' ||
    node.type === 'await_expression'
  ) {
    return true;
  }

  if (node.type === 'prefix_unary_expression' || node.type === 'postfix_unary_expression') {
    if (node.text.includes('++') || node.text.includes('--')) {
      return true;
    }
  }

  if (node.type === 'invocation_expression') {
    const fn = node.childForFieldName('function') ?? node.namedChild(0);
    const fnText = fn ? fn.text : '';
    const shortName = fnText.includes('.') ? fnText.slice(fnText.lastIndexOf('.') + 1) : fnText;
    if (!SAFE_LOG_FORMATTER_NAMES.has(shortName)) {
      return true;
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && hasSideEffectsInSubtree(c)) return true;
  }

  return false;
}

function isPureDiagnosticLogStatement(stmt: FullSyntaxNode): boolean {
  if (stmt.type !== 'expression_statement' || stmt.hasError) return false;
  const invocation = findChildByType(stmt, 'invocation_expression');
  if (!invocation) return false;

  const fn = invocation.childForFieldName('function') ?? invocation.namedChild(0);
  if (!fn) return false;

  const calleeText = fn.text.trim();
  const shortMethod = calleeText.includes('.')
    ? calleeText.slice(calleeText.lastIndexOf('.') + 1)
    : calleeText;

  const isLogMatch =
    DIAGNOSTIC_LOG_CALLEES.has(calleeText) ||
    DIAGNOSTIC_LOG_METHOD_NAMES.has(shortMethod);

  if (!isLogMatch) return false;

  const argList = findChildByType(invocation, 'argument_list');
  if (!argList) return true;

  for (const arg of findChildrenByType(argList, 'argument')) {
    if (hasSideEffectsInSubtree(arg)) return false;
  }
  return true;
}

function tryEmitExpressionBody(
  node: FullSyntaxNode,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  if (node.hasError) return;
  if (
    node.type !== 'method_declaration' &&
    node.type !== 'constructor_declaration' &&
    node.type !== 'accessor_declaration'
  ) {
    return;
  }

  const block = findChildByType(node, 'block');
  if (!block || block.hasError) return;

  // Skip if block contains comments
  for (let i = 0; i < block.childCount; i++) {
    const c = block.child(i);
    if (c && c.type === 'comment') return;
  }

  if (block.namedChildCount !== 1) return;
  const stmt = block.namedChild(0);
  if (!stmt) return;

  const openBrace = block.child(0);
  const closeBrace = block.child(block.childCount - 1);
  if (!openBrace || openBrace.text !== '{' || !closeBrace || closeBrace.text !== '}') return;

  if (stmt.text.includes('\n')) return;

  if (stmt.type === 'return_statement') {
    const returnKw = stmt.child(0);
    const expr = stmt.namedChild(0);
    if (!returnKw || returnKw.text !== 'return' || !expr) return;
    // Replace `{ ... return ` with `=> ` and `}` with ``
    edits.push({
      start: openBrace.startIndex,
      end: expr.startIndex,
      replacement: '=> ',
      priority: 18,
      kind: 'replace',
      ruleId: 'T12',
    });
    edits.push({
      start: stmt.endIndex,
      end: closeBrace.endIndex,
      replacement: '',
      priority: 18,
      kind: 'delete',
      ruleId: 'T12',
    });
    transformsApplied.add('T12');
  } else if (stmt.type === 'expression_statement') {
    // Replace `{` (and leading space before stmt) with `=> ` and `}` with ``
    // so inner laminar edits (e.g. `this.` removal) inside `stmt` are preserved!
    edits.push({
      start: openBrace.startIndex,
      end: stmt.startIndex,
      replacement: '=> ',
      priority: 18,
      kind: 'replace',
      ruleId: 'T12',
    });
    edits.push({
      start: stmt.endIndex,
      end: closeBrace.endIndex,
      replacement: '',
      priority: 18,
      kind: 'delete',
      ruleId: 'T12',
    });
    transformsApplied.add('T12');
  }
}

function walkExpressionsAndLogs(
  node: FullSyntaxNode,
  source: string,
  config: CSharpCompressionConfig,
  scopeStack: Set<string>[],
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  const { level, options } = config;
  const isScopeOwner = SCOPE_OWNER_TYPES.has(node.type);

  if (isScopeOwner && level !== 'clean' && level !== 'contract') {
    scopeStack.push(prescanScopeFrame(node));
  }

  // T08: Target-typed `new()` on local & field declarations (L1 - L3)
  if (level !== 'contract' && node.type === 'variable_declaration' && !node.hasError) {
    const parent = node.parent;
    if (parent && (parent.type === 'local_declaration_statement' || parent.type === 'field_declaration')) {
      const mods = getModifierTexts(parent);
      if (!mods.has('const') && !mods.has('ref')) {
        tryEmitTargetTypedNew(node, edits, transformsApplied);
      }
    }
  }

  // T12: Safe `this.` removal (L2 - L3)
  if ((level === 'compact' || level === 'skeleton') && node.type === 'member_access_expression' && !node.hasError) {
    const exprNode = node.childForFieldName('expression');
    const nameNode = node.childForFieldName('name');
    if (exprNode && (exprNode.type === 'this_expression' || exprNode.type === 'this') && nameNode) {
      if (!isNameShadowed(nameNode.text, scopeStack)) {
        // Delete from `this` start up to `name` start (removes `this.`)
        edits.push({
          start: exprNode.startIndex,
          end: nameNode.startIndex,
          replacement: '',
          priority: 24,
          kind: 'delete',
          ruleId: 'T12',
        });
        transformsApplied.add('T12');
      }
    }
  }

  // T12: Single-statement `=>` expression bodies (L2; in L3 skeletonAndContract handles body elision)
  if (level === 'compact') {
    tryEmitExpressionBody(node, edits, transformsApplied);
  }

  // T13: Pure-argument diagnostic log stripping (L2 if enabled, L3 always)
  if (
    ((level === 'compact' && options.stripDiagnosticLogsInCompact) || level === 'skeleton') &&
    node.type === 'expression_statement'
  ) {
    if (isPureDiagnosticLogStatement(node)) {
      edits.push({
        start: node.startIndex,
        end: expandLineDeletionEnd(source, node.startIndex, node.endIndex),
        replacement: '',
        priority: 26,
        kind: 'delete',
        ruleId: 'T13',
      });
      transformsApplied.add('T13');
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      walkExpressionsAndLogs(child, source, config, scopeStack, edits, transformsApplied);
    }
  }

  if (isScopeOwner && level !== 'clean' && level !== 'contract') {
    scopeStack.pop();
  }
}

/**
 * Pass 1.7 - 1.10: Target-typed `new()`, lexical-scope-safe `this.` elimination,
 * single-statement `=>` bodies, and pure-argument diagnostic log stripping (T08, T12, T13).
 */
export function runExpressionsAndLogsPass(
  root: FullSyntaxNode,
  source: string,
  config: CSharpCompressionConfig,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  if (config.level === 'none') return;
  walkExpressionsAndLogs(root, source, config, [], edits, transformsApplied);
}
