import type { FullSyntaxNode } from '../TreeSitterCSharpRuntime';
import type { TextEdit } from '../EditEngine';
import type { CSharpCompressionConfig } from '@/core/types/csharp-compression.types';
import { CALL_GRAPH_NOISE_METHODS } from '@/core/constants/csharp-compression.constants';
import {
  expandLineDeletionEnd,
  findChildByType,
  findChildrenByType,
  getModifierTexts,
  hasUnitySerializedAttribute,
  isEffectivelyPrivate,
  isUnityLifecycleMethod,
} from './astHelpers';

const LITERAL_ELEMENT_TYPES = new Set([
  'integer_literal',
  'real_literal',
  'string_literal',
  'character_literal',
  'boolean_literal',
  'null_literal',
  'prefix_unary_expression',
]);

const TYPE_CONTAINER_NODES = new Set([
  'class_declaration',
  'struct_declaration',
  'record_declaration',
  'record_struct_declaration',
  'interface_declaration',
]);

const PRUNABLE_MEMBER_NODES = new Set([
  'field_declaration',
  'event_field_declaration',
  'property_declaration',
  'indexer_declaration',
  'method_declaration',
  'constructor_declaration',
  'operator_declaration',
  'conversion_operator_declaration',
  'destructor_declaration',
  'event_declaration',
  'class_declaration',
  'struct_declaration',
  'interface_declaration',
  'record_declaration',
  'record_struct_declaration',
  'enum_declaration',
  'delegate_declaration',
]);

interface BodyEffectSummary {
  calls: string[];
  throws: string[];
  awaits: boolean;
  yields: boolean;
  mutatesFields: string[];
}

function extractCalleeName(invocation: FullSyntaxNode): string | null {
  const fn = invocation.childForFieldName('function') ?? invocation.namedChild(0);
  if (!fn) return null;
  let text = fn.text.replace(/\s+/g, '');
  if (text.startsWith('this.')) text = text.slice(5);
  const shortName = text.includes('.') ? text.slice(text.lastIndexOf('.') + 1) : text;
  if (CALL_GRAPH_NOISE_METHODS.has(shortName)) return null;
  return text.length > 40 ? shortName : text;
}

function extractBodyEffectSummary(block: FullSyntaxNode): BodyEffectSummary {
  const callsSet = new Set<string>();
  const throwsSet = new Set<string>();
  const mutatesSet = new Set<string>();
  let awaits = false;
  let yields = false;

  const visit = (n: FullSyntaxNode) => {
    if (n.type === 'invocation_expression') {
      const callee = extractCalleeName(n);
      if (callee && callsSet.size < 6) callsSet.add(callee);
    } else if (n.type === 'throw_statement' || n.type === 'throw_expression') {
      const obj = findChildByType(n, 'object_creation_expression');
      const typeNode = obj?.childForFieldName('type');
      const excName = typeNode ? typeNode.text.trim() : 'Exception';
      if (throwsSet.size < 3) throwsSet.add(excName);
    } else if (n.type === 'await_expression') {
      awaits = true;
    } else if (n.type === 'yield_statement') {
      yields = true;
    } else if (n.type === 'assignment_expression') {
      const left = n.childForFieldName('left') ?? n.namedChild(0);
      if (left) {
        const lt = left.text.trim();
        if ((lt.startsWith('_') || lt.startsWith('this.')) && mutatesSet.size < 4) {
          mutatesSet.add(lt.startsWith('this.') ? lt.slice(5) : lt);
        }
      }
    }

    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) visit(c);
    }
  };

  visit(block);

  return {
    calls: Array.from(callsSet),
    throws: Array.from(throwsSet),
    awaits,
    yields,
    mutatesFields: Array.from(mutatesSet),
  };
}

function formatCallGraphStub(summary: BodyEffectSummary): string {
  const parts: string[] = [];
  if (summary.calls.length > 0) parts.push(`calls: ${summary.calls.join(', ')}`);
  if (summary.mutatesFields.length > 0) parts.push(`mut: ${summary.mutatesFields.join(', ')}`);
  if (summary.throws.length > 0) parts.push(`throws: ${summary.throws.join(', ')}`);
  if (summary.awaits) parts.push('async');
  if (summary.yields) parts.push('yields');

  if (parts.length === 0) return '{ /* ... */ }';
  return `{ /* ${parts.join('; ')} */ }`;
}

function tryTruncateLargeInitializer(
  node: FullSyntaxNode,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  if (node.hasError) return;
  if (node.type !== 'initializer_expression' && node.type !== 'collection_expression') return;

  const elements = node.namedChildren;
  if (elements.length <= 8) return;

  // Verify all elements are simple literals/constants
  for (const el of elements) {
    if (!LITERAL_ELEMENT_TYPES.has(el.type)) return;
  }

  const keepStartEnd = elements[2].endIndex;
  const lastElStart = elements[elements.length - 1].startIndex;
  const omittedCount = elements.length - 4;

  if (keepStartEnd < lastElStart && omittedCount > 0) {
    edits.push({
      start: keepStartEnd,
      end: lastElStart,
      replacement: `, /* +${omittedCount} items */ `,
      priority: 28,
      kind: 'elide',
      ruleId: 'T14',
    });
    transformsApplied.add('T14');
  }
}

function walkSkeletonAndContract(
  node: FullSyntaxNode,
  parentContainerType: string,
  source: string,
  config: CSharpCompressionConfig,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  const { level, options } = config;

  // T14: Truncate large literal initializers (L3 & L4)
  tryTruncateLargeInitializer(node, edits, transformsApplied);

  // T16: L4 Contract — Prune private members (unless Unity [SerializeField] / [SerializeReference])
  if (
    level === 'contract' &&
    TYPE_CONTAINER_NODES.has(parentContainerType) &&
    PRUNABLE_MEMBER_NODES.has(node.type) &&
    !node.hasError
  ) {
    if (isEffectivelyPrivate(node, parentContainerType)) {
      const keepUnityField =
        node.type === 'field_declaration' &&
        options.preserveUnitySerializedFields &&
        hasUnitySerializedAttribute(node);

      if (!keepUnityField) {
        edits.push({
          start: node.startIndex,
          end: expandLineDeletionEnd(source, node.startIndex, node.endIndex),
          replacement: '',
          priority: 50,
          kind: 'delete',
          ruleId: 'T16',
        });
        transformsApplied.add('T16');
        return;
      }
    }
  }

  // L4 Contract: Strip non-const field initializers
  if (level === 'contract' && node.type === 'field_declaration' && !node.hasError) {
    const mods = getModifierTexts(node);
    if (!mods.has('const')) {
      const varDecl = findChildByType(node, 'variable_declaration');
      if (varDecl) {
        for (const decl of findChildrenByType(varDecl, 'variable_declarator')) {
          const idNode = findChildByType(decl, 'identifier');
          if (idNode && idNode.endIndex < decl.endIndex) {
            edits.push({
              start: idNode.endIndex,
              end: decl.endIndex,
              replacement: '',
              priority: 40,
              kind: 'delete',
              ruleId: 'T15',
            });
            transformsApplied.add('T15');
          }
        }
      }
    }
  }

  // T15: Elide method / constructor / operator / destructor bodies
  if (
    (node.type === 'method_declaration' ||
      node.type === 'constructor_declaration' ||
      node.type === 'operator_declaration' ||
      node.type === 'conversion_operator_declaration' ||
      node.type === 'destructor_declaration') &&
    !node.hasError
  ) {
    const block = findChildByType(node, 'block');
    const arrow = findChildByType(node, 'arrow_expression_clause');

    if (level === 'contract') {
      if (block) {
        // Trim preceding horizontal whitespace so `Foo() { ... }` becomes `Foo();`
        let start = block.startIndex;
        while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) {
          start--;
        }
        edits.push({
          start,
          end: block.endIndex,
          replacement: ';',
          priority: 42,
          kind: 'elide',
          ruleId: 'T15',
        });
        transformsApplied.add('T15');
      } else if (arrow) {
        // Sibling `;` already exists after arrow_expression_clause
        let start = arrow.startIndex;
        while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) {
          start--;
        }
        edits.push({
          start,
          end: arrow.endIndex,
          replacement: '',
          priority: 42,
          kind: 'elide',
          ruleId: 'T15',
        });
        transformsApplied.add('T15');
      }
      return;
    }

    // L3 Skeleton
    if (level === 'skeleton' && block && !block.hasError) {
      const stmtCount = block.namedChildCount;
      const isShort = stmtCount <= options.skeletonInlineStatementLimit && block.text.length <= 80;

      // Preserve short bodies (<= limit statements & <= 80 chars) inline
      if (!isShort) {
        // Optionally preserve Unity lifecycle signatures with stub
        const replacement =
          options.emitCallGraphStubsInSkeleton && !isUnityLifecycleMethod(node)
            ? formatCallGraphStub(extractBodyEffectSummary(block))
            : options.emitCallGraphStubsInSkeleton
              ? formatCallGraphStub(extractBodyEffectSummary(block))
              : '{ /* ... */ }';

        edits.push({
          start: block.startIndex,
          end: block.endIndex,
          replacement,
          priority: 42,
          kind: 'elide',
          ruleId: 'T15',
        });
        transformsApplied.add('T15');
      }
      return;
    }
  }

  // T15: Property & Indexer accessors
  if ((node.type === 'property_declaration' || node.type === 'indexer_declaration') && !node.hasError) {
    const arrow = findChildByType(node, 'arrow_expression_clause');
    const accessorList = findChildByType(node, 'accessor_list');
    const eqClause = findChildByType(node, 'equals_value_clause');

    if (level === 'contract') {
      if (arrow) {
        edits.push({
          start: arrow.startIndex,
          end: arrow.endIndex,
          replacement: '{ get; }',
          priority: 42,
          kind: 'elide',
          ruleId: 'T15',
        });
        transformsApplied.add('T15');
      } else if (accessorList) {
        for (const acc of findChildrenByType(accessorList, 'accessor_declaration')) {
          const accBlock = findChildByType(acc, 'block');
          const accArrow = findChildByType(acc, 'arrow_expression_clause');
          const target = accBlock ?? accArrow;
          if (target) {
            edits.push({
              start: target.startIndex,
              end: target.endIndex,
              replacement: ';',
              priority: 42,
              kind: 'elide',
              ruleId: 'T15',
            });
            transformsApplied.add('T15');
          }
        }
      }
      if (eqClause) {
        edits.push({
          start: eqClause.startIndex,
          end: eqClause.endIndex,
          replacement: '',
          priority: 40,
          kind: 'delete',
          ruleId: 'T15',
        });
        transformsApplied.add('T15');
      }
      return;
    }

    if (level === 'skeleton' && accessorList) {
      for (const acc of findChildrenByType(accessorList, 'accessor_declaration')) {
        const accBlock = findChildByType(acc, 'block');
        if (accBlock && (accBlock.namedChildCount > 1 || accBlock.text.length > 60)) {
          edits.push({
            start: accBlock.startIndex,
            end: accBlock.endIndex,
            replacement: ';',
            priority: 42,
            kind: 'elide',
            ruleId: 'T15',
          });
          transformsApplied.add('T15');
        }
      }
      return;
    }
  }

  const nextContainer = TYPE_CONTAINER_NODES.has(node.type) ? node.type : parentContainerType;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      walkSkeletonAndContract(child, nextContainer, source, config, edits, transformsApplied);
    }
  }
}

/**
 * Pass 1.11 & 1.12: Large Literal Truncation (T14), Call-Graph Stubbing (T15),
 * and Private Member Pruning (T16) for L3 Skeleton and L4 Contract.
 */
export function runSkeletonAndContractPass(
  root: FullSyntaxNode,
  source: string,
  config: CSharpCompressionConfig,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  if (config.level !== 'skeleton' && config.level !== 'contract') return;
  walkSkeletonAndContract(root, '', source, config, edits, transformsApplied);
}
