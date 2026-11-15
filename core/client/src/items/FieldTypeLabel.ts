import { FieldTypes, type FieldType } from '@aliasvault/models/vault';

import type { TranslationKey } from '@aliasvault/i18n';

const FIELD_TYPE_KEYS: Record<FieldType, TranslationKey> = {
  [FieldTypes.Text]: 'itemTypes.fieldTypes.text',
  [FieldTypes.Password]: 'itemTypes.fieldTypes.password',
  [FieldTypes.Hidden]: 'itemTypes.fieldTypes.hidden',
  [FieldTypes.Email]: 'itemTypes.fieldTypes.email',
  [FieldTypes.URL]: 'itemTypes.fieldTypes.url',
  [FieldTypes.Date]: 'itemTypes.fieldTypes.date',
  [FieldTypes.Number]: 'itemTypes.fieldTypes.number',
  [FieldTypes.Phone]: 'itemTypes.fieldTypes.phone',
  [FieldTypes.TextArea]: 'itemTypes.fieldTypes.textArea',
  [FieldTypes.Section]: 'itemTypes.fieldTypes.text',
};

/**
 * The translation key of a field type's name, e.g. "URL".
 */
export function fieldTypeLabelKey(type: FieldType): TranslationKey {
  return FIELD_TYPE_KEYS[type];
}
