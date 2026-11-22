import type { FullSyntaxNode } from '../TreeSitterCSharpRuntime';
import type { TextEdit } from '../EditEngine';
import type { CSharpCompressionConfig } from '@/core/types/csharp-compression.types';
import {
  expandLineDeletionEnd,
  findChildByType,
  findChildrenByType,
  getModifiers,
  isTierBHintAttribute,
  isTierCNoiseAttribute,
} from './astHelpers';

const TYPE_CONTAINER_NODES = new Set([
  'class_declaration',
  'struct_declaration',
  'record_declaration',
  'record_struct_declaration',
  'interface_declaration',
]);

const MEMBER_NODES = new Set([
  'field_declaration',
  'event_field_declaration',
  'property_declaration',
  'indexer_declaration',
  'method_declaration',
  'constructor_declaration',
  'operator_declaration',
  'conversion_operator_declaration',
  'event_declaration',
  'class_declaration',
  'struct_declaration',
  'interface_declaration',
  'record_declaration',
  'record_struct_declaration',
  'enum_declaration',
  'delegate_declaration',
]);

function processAttributeLists(
  node: FullSyntaxNode,
  source: string,
  config: CSharpCompressionConfig,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  const { level } = config;
  const attrLists = findChildrenByType(node, 'attribute_list');
  if (attrLists.length === 0) return;

  const stripTierB = level !== 'clean';
  const mergeLists = level !== 'clean';

  // Group consecutive attribute lists without attribute_target_specifier
  interface KeptGroup {
    lists: FullSyntaxNode[];
    keptAttrTexts: string[];
  }

  let currentGroup: KeptGroup | null = null;

  const flushGroup = () => {
    if (!currentGroup || currentGroup.lists.length === 0) return;
    const first = currentGroup.lists[0];
    const last = currentGroup.lists[currentGroup.lists.length - 1];

    if (currentGroup.keptAttrTexts.length === 0) {
      edits.push({
        start: first.startIndex,
        end: expandLineDeletionEnd(source, first.startIndex, last.endIndex),
        replacement: '',
        priority: 35,
        kind: 'delete',
        ruleId: 'T07',
      });
      transformsApplied.add('T07');
    } else if (mergeLists && currentGroup.lists.length > 1) {
      edits.push({
        start: first.startIndex,
        end: last.endIndex,
        replacement: `[${currentGroup.keptAttrTexts.join(', ')}]`,
        priority: 34,
        kind: 'replace',
        ruleId: 'T09',
      });
      transformsApplied.add('T09');
    }
    currentGroup = null;
  };

  for (const list of attrLists) {
    if (list.hasError) {
      flushGroup();
      continue;
    }

    const hasTarget = findChildByType(list, 'attribute_target_specifier') !== null;
    const attrs = findChildrenByType(list, 'attribute');
    const keptAttrs: string[] = [];
    let strippedAny = false;

    for (const attr of attrs) {
      if (isTierCNoiseAttribute(attr)) {
        strippedAny = true;
        transformsApplied.add('T07');
        continue;
      }
      if (stripTierB && isTierBHintAttribute(attr)) {
        strippedAny = true;
        transformsApplied.add('T09');
        continue;
      }
      keptAttrs.push(attr.text);
    }

    if (hasTarget) {
      flushGroup();
      if (strippedAny) {
        if (keptAttrs.length === 0) {
          edits.push({
            start: list.startIndex,
            end: expandLineDeletionEnd(source, list.startIndex, list.endIndex),
            replacement: '',
            priority: 35,
            kind: 'delete',
            ruleId: 'T07',
          });
        } else {
          const target = findChildByType(list, 'attribute_target_specifier')!;
          edits.push({
            start: list.startIndex,
            end: list.endIndex,
            replacement: `[${target.text} ${keptAttrs.join(', ')}]`,
            priority: 34,
            kind: 'replace',
            ruleId: 'T07',
          });
        }
      }
      continue;
    }

    if (mergeLists) {
      if (!currentGroup) {
        currentGroup = { lists: [list], keptAttrTexts: [...keptAttrs] };
      } else {
        currentGroup.lists.push(list);
        currentGroup.keptAttrTexts.push(...keptAttrs);
      }
    } else if (strippedAny) {
      if (keptAttrs.length === 0) {
        edits.push({
          start: list.startIndex,
          end: expandLineDeletionEnd(source, list.startIndex, list.endIndex),
          replacement: '',
          priority: 35,
          kind: 'delete',
          ruleId: 'T07',
        });
      } else {
        edits.push({
          start: list.startIndex,
          end: list.endIndex,
          replacement: `[${keptAttrs.join(', ')}]`,
          priority: 34,
          kind: 'replace',
          ruleId: 'T07',
        });
      }
    }
  }

  flushGroup();
}

function processDefaultModifiers(
  node: FullSyntaxNode,
  parentType: string,
  source: string,
  config: CSharpCompressionConfig,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  if (config.level === 'clean' || node.hasError) return;
  if (!MEMBER_NODES.has(node.type)) return;

  const mods = getModifiers(node);
  if (mods.length === 0) return;

  const hasProtected = mods.some((m) => m.text === 'protected');

  if (parentType === 'interface_declaration') {
    const publicMod = mods.find((m) => m.text === 'public');
    if (publicMod) {
      const end = source[publicMod.endIndex] === ' ' ? publicMod.endIndex + 1 : publicMod.endIndex;
      edits.push({
        start: publicMod.startIndex,
        end,
        replacement: '',
        priority: 25,
        kind: 'delete',
        ruleId: 'T11',
      });
      transformsApplied.add('T11');
    }
  } else if (TYPE_CONTAINER_NODES.has(parentType)) {
    // NEVER strip `private` inside `private protected`
    if (hasProtected) return;
    const privateMod = mods.find((m) => m.text === 'private');
    if (privateMod) {
      const end = source[privateMod.endIndex] === ' ' ? privateMod.endIndex + 1 : privateMod.endIndex;
      edits.push({
        start: privateMod.startIndex,
        end,
        replacement: '',
        priority: 25,
        kind: 'delete',
        ruleId: 'T11',
      });
      transformsApplied.add('T11');
    }
  }
}

function walkTypesAndMembers(
  node: FullSyntaxNode,
  parentContainerType: string,
  source: string,
  config: CSharpCompressionConfig,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  processAttributeLists(node, source, config, edits, transformsApplied);
  processDefaultModifiers(node, parentContainerType, source, config, edits, transformsApplied);

  const nextContainer = TYPE_CONTAINER_NODES.has(node.type) ? node.type : parentContainerType;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      walkTypesAndMembers(child, nextContainer, source, config, edits, transformsApplied);
    }
  }
}

/**
 * Pass 1.5 & 1.6: Attribute Classifier/Merger (T07, T09) & Default Modifier Stripper (T11).
 * Note: T05 (block namespace -> file-scoped namespace) is intentionally NOT implemented per user spec.
 */
export function runTypesAndMembersPass(
  root: FullSyntaxNode,
  source: string,
  config: CSharpCompressionConfig,
  edits: TextEdit[],
  transformsApplied: Set<string>
): void {
  if (config.level === 'none') return;
  walkTypesAndMembers(root, '', source, config, edits, transformsApplied);
}
