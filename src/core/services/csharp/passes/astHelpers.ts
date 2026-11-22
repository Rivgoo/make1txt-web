import type { FullSyntaxNode } from '../TreeSitterCSharpRuntime';
import {
  TIER_B_HINT_ATTRIBUTES,
  TIER_C_NOISE_ATTRIBUTES,
  UNITY_LIFECYCLE_METHODS,
  UNITY_SERIALIZATION_ATTRIBUTES,
} from '@/core/constants/csharp-compression.constants';

export function findChildByType(node: FullSyntaxNode, type: string): FullSyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) return c;
  }
  return null;
}

export function findChildrenByType(node: FullSyntaxNode, type: string): FullSyntaxNode[] {
  const result: FullSyntaxNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) result.push(c);
  }
  return result;
}

export function getModifiers(node: FullSyntaxNode): FullSyntaxNode[] {
  return findChildrenByType(node, 'modifier');
}

export function getModifierTexts(node: FullSyntaxNode): Set<string> {
  const mods = getModifiers(node);
  return new Set(mods.map((m) => m.text));
}

/**
 * Returns true if the member has private accessibility (explicit `private` without `protected`,
 * or no access modifier at all inside a class/struct/record).
 */
export function isEffectivelyPrivate(node: FullSyntaxNode, parentType: string): boolean {
  const mods = getModifierTexts(node);
  if (mods.has('public') || mods.has('protected') || mods.has('internal') || mods.has('file')) {
    return false;
  }
  if (mods.has('private')) {
    return true;
  }
  // Interface members default to public; class/struct/record members default to private
  return parentType !== 'interface_declaration';
}

export function extractAttributeSimpleName(attrNode: FullSyntaxNode): string {
  const nameNode = attrNode.childForFieldName('name') ?? findChildByType(attrNode, 'identifier') ?? findChildByType(attrNode, 'qualified_name');
  const raw = nameNode ? nameNode.text : attrNode.text.split('(')[0].trim();
  const shortName = raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw;
  return shortName.endsWith('Attribute') && shortName.length > 'Attribute'.length
    ? shortName.slice(0, -'Attribute'.length)
    : shortName;
}

export function isTierCNoiseAttribute(attrNode: FullSyntaxNode): boolean {
  const name = extractAttributeSimpleName(attrNode);
  return TIER_C_NOISE_ATTRIBUTES.has(name);
}

export function isTierBHintAttribute(attrNode: FullSyntaxNode): boolean {
  const name = extractAttributeSimpleName(attrNode);
  const rawName = attrNode.childForFieldName('name')?.text ?? name;
  return TIER_B_HINT_ATTRIBUTES.has(name) || TIER_B_HINT_ATTRIBUTES.has(rawName);
}

export function hasUnitySerializedAttribute(node: FullSyntaxNode): boolean {
  const attrLists = findChildrenByType(node, 'attribute_list');
  for (const list of attrLists) {
    const attrs = findChildrenByType(list, 'attribute');
    for (const attr of attrs) {
      if (UNITY_SERIALIZATION_ATTRIBUTES.has(extractAttributeSimpleName(attr))) {
        return true;
      }
    }
  }
  return false;
}

export function isUnityLifecycleMethod(methodNode: FullSyntaxNode): boolean {
  const nameNode = methodNode.childForFieldName('name') ?? findChildByType(methodNode, 'identifier');
  return nameNode ? UNITY_LIFECYCLE_METHODS.has(nameNode.text) : false;
}

/**
 * Expands [start, end) to include trailing horizontal whitespace and a single newline if the edit
 * occupies an entire line on its own.
 */
export function expandLineDeletionEnd(source: string, start: number, end: number): number {
  let lineStart = start;
  while (lineStart > 0 && (source[lineStart - 1] === ' ' || source[lineStart - 1] === '\t')) {
    lineStart--;
  }
  const atLineStart = lineStart === 0 || source[lineStart - 1] === '\n' || source[lineStart - 1] === '\r';
  if (!atLineStart) return end;

  let cursor = end;
  while (cursor < source.length && (source[cursor] === ' ' || source[cursor] === '\t')) {
    cursor++;
  }
  if (source[cursor] === '\r' && source[cursor + 1] === '\n') {
    return cursor + 2;
  }
  if (source[cursor] === '\n') {
    return cursor + 1;
  }
  return end;
}
