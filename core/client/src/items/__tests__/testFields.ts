import { FieldTypes } from '@aliasvault/models/vault';

import type { ItemField } from '@aliasvault/models/vault';

/**
 * A system field as the repository reads it and the item form hands it over.
 * @param fieldKey - The system field key
 * @param value - The value or values
 * @param overrides - Overrides of the other properties
 * @returns The field
 */
export function systemField(fieldKey: string, value: string | string[], overrides: Partial<ItemField> = {}): ItemField {
  return { FieldKey: fieldKey, Label: fieldKey, FieldType: FieldTypes.Text, Value: value, IsHidden: false, DisplayOrder: 0, IsCustomField: false, EnableHistory: false, ...overrides };
}

/**
 * A custom field as the repository reads it.
 * @param id - The field definition id
 * @param label - The label
 * @param value - The value
 * @param displayOrder - The display order
 * @param fieldType - The field type
 * @returns The field
 */
export function customField(id: string, label: string, value: string, displayOrder: number, fieldType: ItemField['FieldType'] = FieldTypes.Text): ItemField {
  return { FieldKey: id, Label: label, FieldType: fieldType, Value: value, IsHidden: false, DisplayOrder: displayOrder, IsCustomField: true, EnableHistory: false };
}

/**
 * A section header among the custom fields.
 * @param id - The field definition id
 * @param label - The section title
 * @param displayOrder - The display order
 * @returns The field
 */
export function section(id: string, label: string, displayOrder: number): ItemField {
  return customField(id, label, '', displayOrder, FieldTypes.Section);
}
