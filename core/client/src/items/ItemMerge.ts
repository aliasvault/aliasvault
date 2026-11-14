import { FieldKey, FieldTypes, ItemTypes, getSystemField } from '@aliasvault/models/vault';

import type { Item, ItemField, ItemType } from '@aliasvault/models/vault';

/*
 * Merging copies a source item into a target item. The target keeps its id, folder and logo; the source goes to the
 * trash as-is, so a merge can be undone by restoring the source.
 *
 * Only single-value fields that both items fill differently are a choice for the user (a conflict). Everything else
 * is combined: URLs are joined, notes appended, and custom fields, 2FA codes, attachments and tags are copied to the
 * target. Passkeys are the exception: they move instead of being copied, because a passkey's id is its WebAuthn
 * credential id and cannot exist twice in one manifest. Two items that both hold passkeys are a conflict too, because
 * one account normally has one. TODO: update vault passkey storage logic to move primary identifier from Id to the new separate CredentialId column.
 */

/**
 * A passkey as the merge reads it.
 */
export type MergePasskey = { Id: string; RpId: string; DisplayName: string };

/**
 * A 2FA code as the merge reads it.
 */
export type MergeTotpCode = { Id: string; SecretKey: string };

/**
 * An attachment as the merge reads it, without its bytes.
 */
export type MergeAttachment = { Id: string; Filename: string; BlobHash: string | null; Size: number | null };

/**
 * One item of a merge with the child rows that can move to the other item.
 */
export type MergeSide = {
  item: Item;
  passkeys: MergePasskey[];
  totpCodes: MergeTotpCode[];
  attachments: MergeAttachment[];
};

/**
 * Which item's value a conflict keeps; `both` only applies to passkeys.
 */
export type MergeChoice = 'target' | 'source' | 'both';

/**
 * The user's choice per conflict key; a missing key takes the conflict's default.
 */
export type MergeChoices = Partial<Record<string, MergeChoice>>;

/**
 * Conflict keys that are not a system field key.
 */
export const MergeConflictKeys = {
  Name: 'name',
  Passkeys: 'passkeys',
} as const;

/**
 * A value both items fill differently.
 */
export type MergeConflict = {
  /** `name`, `passkeys` or the system field key. */
  key: string;
  target: string;
  source: string;
  /** Whether the values are secrets, shown masked. */
  isHidden: boolean;
  /** Whether the merged item can keep both values. */
  allowsBoth: boolean;
};

/**
 * Why two items cannot be merged.
 */
export type MergeBlocker = 'same-item' | 'manifest' | 'type';

/**
 * What merging two items asks of the user.
 */
export type MergePlan = {
  blocker: MergeBlocker | null;
  conflicts: MergeConflict[];
};

/**
 * The merged item and the child rows it takes over.
 */
export type MergeResult = {
  name: string | null;
  itemType: ItemType;
  fields: ItemField[];
  replacedValues: { fieldKey: string; value: string }[];
  passkeysToTarget: string[];
  passkeysToSource: string[];
  totpCodesToCopy: string[];
  attachmentsToCopy: string[];
};

/**
 * The non-empty values of a field, in order.
 * @param field - The field, if the item has it
 * @returns The values
 */
function valuesOf(field: ItemField | undefined): string[] {
  if (!field) {
    return [];
  }
  const values = Array.isArray(field.Value) ? field.Value : [field.Value];
  return values.filter(value => typeof value === 'string' && value.trim() !== '');
}

/**
 * Whether two values of a field are the same for the user. Email addresses ignore case.
 * @param fieldKey - The system field key
 * @param a - One value
 * @param b - The other value
 * @returns True when they are the same
 */
function sameValue(fieldKey: string, a: string, b: string): boolean {
  if (fieldKey === FieldKey.LoginEmail) {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return a.trim() === b.trim();
}

/**
 * A URL in the form two URLs are compared in.
 * @param url - The URL
 * @returns The comparison key
 */
function urlKey(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * A 2FA secret in the form two secrets are compared in.
 * @param secret - The base32 secret
 * @returns The comparison key
 */
function totpKey(secret: string): string {
  return secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
}

/**
 * Whether two attachments are the same file: same name, and the same content hash, or the same size when a hash is missing.
 * @param a - One attachment
 * @param b - The other attachment
 * @returns True for the same file
 */
function sameFile(a: MergeAttachment, b: MergeAttachment): boolean {
  if (a.Filename !== b.Filename) {
    return false;
  }
  return a.BlobHash && b.BlobHash ? a.BlobHash === b.BlobHash : a.Size !== null && a.Size === b.Size;
}

/**
 * The item type of the merged item, or null when the two types do not merge.
 * @param target - The target's type
 * @param source - The source's type
 * @returns The merged type
 */
function mergedType(target: ItemType, source: ItemType): ItemType | null {
  if (target === source || source === ItemTypes.Note) {
    return target;
  }
  if (target === ItemTypes.Note) {
    return source;
  }
  const pair = [target, source];
  return pair.includes(ItemTypes.Login) && pair.includes(ItemTypes.Alias) ? ItemTypes.Alias : null;
}

/**
 * The system fields of an item, keyed by field key.
 * @param item - The item
 * @returns The fields
 */
function systemFields(item: Item): Map<string, ItemField> {
  return new Map(item.Fields.filter(field => !field.IsCustomField).map(field => [field.FieldKey, field]));
}

/**
 * Whether a system field merges by combining values instead of choosing one.
 * @param fieldKey - The system field key
 * @returns True for multi-value fields and notes
 */
function isCombinedField(fieldKey: string): boolean {
  return fieldKey === FieldKey.NotesContent || (getSystemField(fieldKey)?.IsMultiValue ?? false);
}

/**
 * The passkeys of an item as one line, e.g. "github.com".
 * @param passkeys - The passkeys
 * @returns The description
 */
function describePasskeys(passkeys: MergePasskey[]): string {
  return passkeys.map(passkey => passkey.DisplayName ? `${passkey.RpId} (${passkey.DisplayName})` : passkey.RpId).join(', ');
}

/**
 * Why two items cannot be merged, in either direction.
 * @param a - One item
 * @param b - The other item
 * @returns The blocker, or null when they can be merged
 */
export function mergeBlocker(a: Pick<Item, 'Id' | 'ManifestId' | 'ItemType'>, b: Pick<Item, 'Id' | 'ManifestId' | 'ItemType'>): MergeBlocker | null {
  if (a.ManifestId.toLowerCase() !== b.ManifestId.toLowerCase()) {
    return 'manifest';
  }
  if (a.Id === b.Id) {
    return 'same-item';
  }
  return mergedType(a.ItemType, b.ItemType) ? null : 'type';
}

/**
 * Work out what merging `source` into `target` asks of the user.
 * @param target - The item that is kept
 * @param source - The item that is folded into it and trashed
 * @returns The blocker, if any, and the conflicts
 */
export function planMerge(target: MergeSide, source: MergeSide): MergePlan {
  const blocker = mergeBlocker(target.item, source.item);
  if (blocker) {
    return { blocker, conflicts: [] };
  }

  const conflicts: MergeConflict[] = [];
  const targetName = target.item.Name?.trim() ?? '';
  const sourceName = source.item.Name?.trim() ?? '';
  if (targetName && sourceName && targetName.toLowerCase() !== sourceName.toLowerCase()) {
    conflicts.push({ key: MergeConflictKeys.Name, target: targetName, source: sourceName, isHidden: false, allowsBoth: false });
  }

  const targetFields = systemFields(target.item);
  for (const [fieldKey, sourceField] of systemFields(source.item)) {
    if (isCombinedField(fieldKey)) {
      continue;
    }
    const [targetValue] = valuesOf(targetFields.get(fieldKey));
    const [sourceValue] = valuesOf(sourceField);
    if (targetValue && sourceValue && !sameValue(fieldKey, targetValue, sourceValue)) {
      conflicts.push({ key: fieldKey, target: targetValue, source: sourceValue, isHidden: sourceField.IsHidden, allowsBoth: false });
    }
  }

  if (target.passkeys.length > 0 && source.passkeys.length > 0) {
    const [targetPasskeys, sourcePasskeys] = [describePasskeys(target.passkeys), describePasskeys(source.passkeys)];
    conflicts.push({ key: MergeConflictKeys.Passkeys, target: targetPasskeys, source: sourcePasskeys, isHidden: false, allowsBoth: true });
  }

  return { blocker: null, conflicts };
}

/**
 * The choice a conflict takes when the user does not pick one: the target's value, or both passkeys.
 * @param conflict - The conflict
 * @returns The default choice
 */
export function defaultMergeChoice(conflict: MergeConflict): MergeChoice {
  return conflict.allowsBoth ? 'both' : 'target';
}

/**
 * How much an item holds, to suggest which of two items to keep.
 * @param side - The item and its child rows
 * @returns The number of filled fields and child rows
 */
function richness(side: MergeSide): number {
  const filledFields = side.item.Fields.filter(field => valuesOf(field).length > 0).length;
  return filledFields + side.passkeys.length + side.totpCodes.length + side.attachments.length;
}

/**
 * Suggest which of two items to keep: the one that holds more, else the older one (the newer is usually the copy).
 * @param a - One item
 * @param b - The other item
 * @returns The item to keep
 */
export function suggestTarget(a: MergeSide, b: MergeSide): MergeSide {
  const difference = richness(a) - richness(b);
  if (difference !== 0) {
    return difference > 0 ? a : b;
  }
  return (a.item.CreatedAt ?? '') <= (b.item.CreatedAt ?? '') ? a : b;
}

/**
 * Join the URLs of both items, the target's first, without repeating one.
 * @param target - The target's URLs
 * @param source - The source's URLs
 * @returns The URLs
 */
function joinUrls(target: string[], source: string[]): string[] {
  const seen = new Set(target.map(urlKey));
  const joined = [...target];
  for (const url of source) {
    if (!seen.has(urlKey(url))) {
      seen.add(urlKey(url));
      joined.push(url);
    }
  }
  return joined;
}

/**
 * Append the source's notes to the target's, unless the target already holds them.
 * @param target - The target's notes
 * @param source - The source's notes
 * @returns The notes
 */
function joinNotes(target: string | undefined, source: string | undefined): string | undefined {
  if (!target || !source || target.includes(source.trim())) {
    return target || source;
  }
  return `${target.trimEnd()}\n\n${source.trim()}`;
}

/**
 * The identity of a custom field for spotting the same field on both items.
 * @param field - The custom field
 * @returns The comparison key
 */
function customFieldKey(field: ItemField): string {
  return `${field.FieldType}|${field.Label.trim().toLowerCase()}|${valuesOf(field).join('\n')}`;
}

/**
 * Split custom fields, sorted by display order, at the first section: what is shown above every section, and the rest.
 * @param fields - The custom fields
 * @returns The two parts
 */
function splitAtFirstSection(fields: ItemField[]): [ItemField[], ItemField[]] {
  const index = fields.findIndex(field => field.FieldType === FieldTypes.Section);
  return index < 0 ? [fields, []] : [fields.slice(0, index), fields.slice(index)];
}

/**
 * Drop sections that have no field left under them.
 * @param fields - Custom fields in display order
 * @returns The fields without empty sections
 */
function dropEmptySections(fields: ItemField[]): ItemField[] {
  /**
   * Whether a field starts a section.
   */
  const isSection = (field: ItemField | undefined): boolean => field?.FieldType === FieldTypes.Section;
  return fields.filter((field, index) => !isSection(field) || (index + 1 < fields.length && !isSection(fields[index + 1])));
}

/**
 * Combine the custom fields of both items. Section membership is positional, so the source's fields shown above its
 * sections go above the target's sections, and the source's sections go after the target's last field.
 * @param target - The target's custom fields
 * @param source - The source's custom fields
 * @param newId - Creates the definition id of a field taken from the source
 * @returns The custom fields in display order
 */
function joinCustomFields(target: ItemField[], source: ItemField[], newId: () => string): ItemField[] {
  /**
   * Sort by display order.
   */
  const byOrder = (a: ItemField, b: ItemField): number => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0);
  const targetSorted = [...target].sort(byOrder);
  const known = new Set(targetSorted.filter(field => field.FieldType !== FieldTypes.Section).map(customFieldKey));
  const taken = [...source].sort(byOrder)
    .filter(field => field.FieldType === FieldTypes.Section || !known.has(customFieldKey(field)))
    .map(field => ({ ...field, FieldKey: newId() }));

  const [targetTop, targetSections] = splitAtFirstSection(targetSorted);
  const [sourceTop, sourceSections] = splitAtFirstSection(taken);
  const joined = [...targetTop, ...sourceTop, ...targetSections, ...dropEmptySections(sourceSections)];

  const start = targetSorted[0]?.DisplayOrder ?? joined[0]?.DisplayOrder ?? 0;
  return joined.map((field, index) => ({ ...field, DisplayOrder: start + index }));
}

/**
 * Merge `source` into `target`. Call {@link planMerge} first: this assumes the items can be merged.
 * @param target - The item that is kept
 * @param source - The item that is folded into it and trashed
 * @param choices - The user's choice per conflict
 * @param newId - Creates the definition id of a custom field taken from the source
 * @returns The merged item and the child rows that change owner
 */
export function mergeItems(target: MergeSide, source: MergeSide, choices: MergeChoices, newId: () => string): MergeResult {
  /**
   * The user's choice for a conflict, else its default.
   */
  const choiceFor = (key: string): MergeChoice => choices[key] ?? (key === MergeConflictKeys.Passkeys ? 'both' : 'target');

  const targetName = target.item.Name?.trim() ? target.item.Name : null;
  const sourceName = source.item.Name?.trim() ? source.item.Name : null;
  const name = targetName && sourceName && choiceFor(MergeConflictKeys.Name) === 'source' ? sourceName : targetName ?? sourceName;

  // System fields: the target's in its own order, then the ones only the source has.
  const targetFields = systemFields(target.item);
  const sourceFields = systemFields(source.item);
  const fieldKeys = [...targetFields.keys(), ...[...sourceFields.keys()].filter(key => !targetFields.has(key))];
  const fields: ItemField[] = [];
  const replacedValues: MergeResult['replacedValues'] = [];

  for (const fieldKey of fieldKeys) {
    const targetField = targetFields.get(fieldKey);
    const sourceField = sourceFields.get(fieldKey);
    const field = (targetField ?? sourceField)!;
    const targetValues = valuesOf(targetField);
    const sourceValues = valuesOf(sourceField);

    let values: string[];
    if (getSystemField(fieldKey)?.IsMultiValue) {
      values = joinUrls(targetValues, sourceValues);
    } else if (fieldKey === FieldKey.NotesContent) {
      const notes = joinNotes(targetValues[0], sourceValues[0]);
      values = notes ? [notes] : [];
    } else if (!targetValues[0] || !sourceValues[0] || sameValue(fieldKey, targetValues[0], sourceValues[0])) {
      values = [targetValues[0] ?? sourceValues[0]].filter(Boolean);
    } else {
      const keepSource = choiceFor(fieldKey) === 'source';
      values = [keepSource ? sourceValues[0] : targetValues[0]];
      if (field.EnableHistory) {
        replacedValues.push({ fieldKey, value: keepSource ? targetValues[0] : sourceValues[0] });
      }
    }

    if (values.length > 0) {
      fields.push({ ...field, Value: values.length === 1 ? values[0] : values });
    }
  }

  /**
   * The custom fields of an item.
   */
  const customOf = (side: MergeSide): ItemField[] => side.item.Fields.filter(field => field.IsCustomField);
  const customFields = joinCustomFields(customOf(target), customOf(source), newId);

  // A Login that takes over identity fields becomes an Alias, so they stay visible.
  let itemType = mergedType(target.item.ItemType, source.item.ItemType) ?? target.item.ItemType;
  if (itemType === ItemTypes.Alias && target.item.ItemType === ItemTypes.Login && !fields.some(field => field.FieldKey.startsWith('alias.'))) {
    itemType = ItemTypes.Login;
  }

  const passkeyChoice = target.passkeys.length > 0 && source.passkeys.length > 0 ? choiceFor(MergeConflictKeys.Passkeys) : 'both';

  const knownSecrets = new Set(target.totpCodes.map(code => totpKey(code.SecretKey)));
  const totpCodesToCopy: string[] = [];
  for (const code of source.totpCodes) {
    if (!knownSecrets.has(totpKey(code.SecretKey))) {
      knownSecrets.add(totpKey(code.SecretKey));
      totpCodesToCopy.push(code.Id);
    }
  }

  return {
    name,
    itemType,
    fields: [...fields, ...customFields],
    replacedValues,
    passkeysToTarget: passkeyChoice === 'target' ? [] : source.passkeys.map(passkey => passkey.Id),
    passkeysToSource: passkeyChoice === 'source' ? target.passkeys.map(passkey => passkey.Id) : [],
    totpCodesToCopy,
    attachmentsToCopy: source.attachments.filter(attachment => !target.attachments.some(known => sameFile(known, attachment))).map(attachment => attachment.Id),
  };
}
