import { FieldTypes, getSystemField } from '@aliasvault/models/vault';

import type { AttachmentEntity, FieldValueEntity, ItemEntity, PasskeyEntity, TotpCodeEntity } from '../../shared/VaultEntities';

/*
 * A re-import that updates an existing items with new data (e.g. applies after AliasVault's import logic has been updated to support new fields).
 */

/**
 * A live field value of a vault item; a custom field has no FieldKey and carries its definition's label and type.
 */
export type ExistingFieldValue = {
  FieldKey: string | null;
  Label: string | null;
  FieldType: string | null;
  Value: string | null;
  Weight: number;
};

/**
 * What a vault item already holds, as far as an enrichment compares it.
 */
export type ExistingItemData = {
  FieldValues: ExistingFieldValue[];
  TotpSecretKeys: string[];
  PasskeyCount: number;
  Attachments: { Filename: string; Size: number }[];
};

/**
 * The rows an import adds to an item the vault already holds.
 */
export type ItemEnrichment = {
  FieldValues: FieldValueEntity[];
  TotpCodes: TotpCodeEntity[];
  Passkeys: PasskeyEntity[];
  Attachments: AttachmentEntity[];
};

/**
 * Whether an enrichment adds nothing.
 * @param enrichment - The enrichment
 * @returns True when it holds no rows
 */
export function isEmptyEnrichment(enrichment: ItemEnrichment): boolean {
  return enrichment.FieldValues.length + enrichment.TotpCodes.length + enrichment.Passkeys.length + enrichment.Attachments.length === 0;
}

/**
 * Determine what an imported item adds to the vault item it matches.
 * @param existing - What the vault item holds
 * @param imported - The imported item
 * @returns The rows the vault item lacks
 */
export function planItemEnrichment(existing: ExistingItemData, imported: ItemEntity): ItemEnrichment {
  const knownTotpSecrets = new Set(existing.TotpSecretKeys.map(normalizeTotpSecret));
  const totpCodes = imported.TotpCodes.filter(code => addIfNew(knownTotpSecrets, normalizeTotpSecret(code.SecretKey)));

  const knownAttachments = new Set(existing.Attachments.map(attachment => attachmentKey(attachment.Filename, attachment.Size)));
  const attachments = imported.Attachments.filter(attachment => addIfNew(knownAttachments, attachmentKey(attachment.Filename, attachment.Blob.length)));

  return {
    FieldValues: [...missingSystemFieldValues(existing, imported), ...missingCustomFieldValues(existing, imported)],
    TotpCodes: totpCodes,
    // An item holds one passkey, so the import only brings one to an item without.
    Passkeys: existing.PasskeyCount === 0 ? imported.Passkeys : [],
    Attachments: attachments,
  };
}

/**
 * The imported system field values the item lacks: every new value of a multi-value field, and the value of a
 * single-value field the item has no value for.
 * @param existing - What the vault item holds
 * @param imported - The imported item
 * @returns The values to add
 */
function missingSystemFieldValues(existing: ExistingItemData, imported: ItemEntity): FieldValueEntity[] {
  const knownValuesByKey = new Map<string, Set<string>>();
  for (const fieldValue of existing.FieldValues) {
    if (fieldValue.FieldKey && fieldValue.Value) {
      const known = knownValuesByKey.get(fieldValue.FieldKey) ?? new Set<string>();
      known.add(normalizeValue(fieldValue.Value));
      knownValuesByKey.set(fieldValue.FieldKey, known);
    }
  }

  const missing: FieldValueEntity[] = [];
  const addedSingleValueKeys = new Set<string>();
  for (const fieldValue of imported.FieldValues) {
    if (!fieldValue.FieldKey || !fieldValue.Value) {
      continue;
    }

    const known = knownValuesByKey.get(fieldValue.FieldKey);
    if (getSystemField(fieldValue.FieldKey)?.IsMultiValue) {
      const values = known ?? new Set<string>();
      knownValuesByKey.set(fieldValue.FieldKey, values);
      if (addIfNew(values, normalizeValue(fieldValue.Value))) {
        missing.push(fieldValue);
      }
    } else if (!known && addIfNew(addedSingleValueKeys, fieldValue.FieldKey)) {
      missing.push(fieldValue);
    }
  }
  return missing;
}

/**
 * The imported custom fields the item lacks, matched by label. An item without custom fields gets them as the file
 * holds them, sections included; otherwise the missing fields are appended and sections are left out, because a
 * section claims every field that follows it.
 * @param existing - What the vault item holds
 * @param imported - The imported item
 * @returns The values to add, each carrying its definition
 */
function missingCustomFieldValues(existing: ExistingItemData, imported: ItemEntity): FieldValueEntity[] {
  const existingCustomFields = existing.FieldValues.filter(fieldValue => !fieldValue.FieldKey);
  const knownLabels = new Set(existingCustomFields.filter(fieldValue => fieldValue.FieldType !== FieldTypes.Section).map(fieldValue => normalizeValue(fieldValue.Label ?? '')));
  const hasCustomFields = existingCustomFields.length > 0;
  let nextWeight = Math.max(-1, ...existingCustomFields.map(fieldValue => fieldValue.Weight)) + 1;

  // Values of one definition stay together and share a weight.
  const appendedWeights = new Map<string, number>();
  const missing: FieldValueEntity[] = [];
  for (const fieldValue of imported.FieldValues) {
    const definition = fieldValue.FieldDefinition;
    if (fieldValue.FieldKey || !definition) {
      continue;
    }

    if (!hasCustomFields) {
      missing.push(fieldValue);
      continue;
    }

    if (definition.FieldType === FieldTypes.Section || knownLabels.has(normalizeValue(definition.Label))) {
      continue;
    }

    let weight = appendedWeights.get(definition.Id);
    if (weight === undefined) {
      weight = nextWeight++;
      appendedWeights.set(definition.Id, weight);
    }
    missing.push({ ...fieldValue, Weight: weight });
  }
  return missing;
}

/**
 * Add a key to a set.
 * @param known - The set
 * @param key - The key
 * @returns True when the key was not in the set yet
 */
function addIfNew(known: Set<string>, key: string): boolean {
  if (known.has(key)) {
    return false;
  }
  known.add(key);
  return true;
}

/**
 * The form two field values or labels are compared in: trimmed, lower case and without trailing slashes.
 * @param value - The value
 * @returns The comparable value
 */
function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * The form two TOTP secrets are compared in: upper case without spaces or padding.
 * @param secretKey - The Base32 secret
 * @returns The comparable secret
 */
function normalizeTotpSecret(secretKey: string): string {
  return secretKey.replace(/[\s=]/g, '').toUpperCase();
}

/**
 * The identity of an attachment: its file name and size.
 * @param filename - The file name
 * @param size - The size in bytes
 * @returns The key
 */
function attachmentKey(filename: string, size: number): string {
  return `${filename.toLowerCase()}:${size}`;
}
