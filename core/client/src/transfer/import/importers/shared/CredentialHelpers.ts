import { FieldTypes, ItemTypes, type FieldType, type ItemType } from '@aliasvault/models/vault';

import { isBlank } from '../../../shared/StringUtils';

import type { ImportedCredential } from '../../models/ImportedCredential';

/**
 * Split a URL column that may hold several comma separated URLs.
 * @param url - The URL text
 * @returns The URLs, or null when there are none
 */
export function parseUrls(url: string | null | undefined): string[] | null {
  const urls = (url ?? '').split(',').map(u => u.trim()).filter(u => u.length > 0);
  return urls.length > 0 ? urls : null;
}

/**
 * Map a source's item type name to an item type.
 * @param value - The source's type name
 * @param types - Lower case type names to item types
 * @returns The item type, Login for unknown names, or null when the name is empty
 */
export function mapItemType(value: string | null | undefined, types: Readonly<Record<string, ItemType>>): ItemType | null {
  if (isBlank(value)) {
    return null;
  }
  const key = value.toLowerCase();
  return Object.hasOwn(types, key) ? types[key] : ItemTypes.Login;
}

/**
 * Add a user-defined field to a credential; empty labels or values are skipped.
 * @param credential - The credential
 * @param label - The field label
 * @param value - The field value
 * @param fieldType - The field type, Text by default
 */
export function addCustomField(credential: ImportedCredential, label: string | null | undefined, value: string | null | undefined, fieldType: FieldType = FieldTypes.Text): void {
  if (isBlank(label) || isBlank(value)) {
    return;
  }

  credential.CustomFieldValues ??= [];
  credential.CustomFieldValues.push({
    DefinitionId: crypto.randomUUID(),
    Label: label,
    Value: value,
    FieldType: fieldType,
    IsMultiValue: false,
    IsHidden: fieldType === FieldTypes.Hidden || fieldType === FieldTypes.Password,
    EnableHistory: false,
    Weight: 0,
    ValueWeight: 0,
    ApplicableToTypes: null,
  });
}

/**
 * Add an attachment to a credential.
 * @param credential - The credential
 * @param filename - The file name
 * @param data - The file data
 */
export function addAttachment(credential: ImportedCredential, filename: string, data: Uint8Array): void {
  credential.Attachments ??= [];
  credential.Attachments.push({ Filename: filename, Blob: data });
}

/**
 * Append a block of text to a credential's notes, separated by an empty line.
 * @param credential - The credential
 * @param lines - The lines to append.
 */
export function appendNotes(credential: ImportedCredential, lines: string[]): void {
  if (lines.length === 0) {
    return;
  }
  const block = lines.join('\n');
  credential.Notes = isBlank(credential.Notes) ? block : `${credential.Notes}\n\n${block}`;
}
