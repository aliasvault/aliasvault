import { manifestForItemIn } from '@aliasvault/client/database/ItemRef';
import { FieldCategories, FieldTypes, getSystemField, type Attachment, type FieldCategory, type Item, type ItemField, type ItemType, ItemTypes, type Passkey, type TotpCode } from '@aliasvault/models/vault';

import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

/**
 * A field on the item form. Custom fields carry their definition id as FieldKey.
 */
export type FieldEdit = {
  FieldKey: string;
  Label: string;
  FieldType: string;
  Value: string;
  Values: string[];
  IsCustomField: boolean;
  IsHidden: boolean;
  EnableHistory: boolean;
  DisplayOrder: number;
  Category: FieldCategory;
  IsMultiValue: boolean;
};

/**
 * The item form state.
 */
export type ItemEdit = {
  Id: string;
  ManifestId: string;
  ItemType: ItemType;
  ServiceName: string;
  FolderId: string | null;
  CreatedAt: string;
  Fields: FieldEdit[];
  Attachments: Attachment[];
  TotpCodes: TotpCode[];
  Passkeys: Passkey[];
};

/** The URL placeholder of a new item. */
export const DEFAULT_SERVICE_URL = 'https://';

/**
 * A field edit for a system field with a value.
 */
const newSystemFieldEdit = (fieldKey: string, value: string): FieldEdit | null => {
  const systemField = getSystemField(fieldKey);
  if (!systemField) {
    return null;
  }
  return {
    FieldKey: fieldKey,
    Label: fieldKey,
    FieldType: systemField.FieldType,
    Value: value,
    Values: systemField.IsMultiValue ? [value] : [],
    IsCustomField: false,
    IsHidden: systemField.IsHidden,
    EnableHistory: systemField.EnableHistory,
    DisplayOrder: systemField.DefaultDisplayOrder,
    Category: systemField.Category,
    IsMultiValue: systemField.IsMultiValue,
  };
};

/**
 * An empty form for a new item in a folder, or outside any folder.
 * @param folder - The folder the item is created in, or null for none
 * @param personalManifestId - The user's personal manifest id
 */
export function createNewItemEdit(folder: FolderRef | null, personalManifestId: string | null): ItemEdit {
  const now = new Date().toISOString();
  let edit: ItemEdit = { Id: crypto.randomUUID(), ManifestId: manifestForItemIn(folder, personalManifestId), ItemType: ItemTypes.Login, ServiceName: '', FolderId: folder?.Id ?? null, CreatedAt: now, Fields: [], Attachments: [], TotpCodes: [], Passkeys: [] };
  edit = setFieldValue(edit, 'alias.birthdate', '');
  edit = setFieldValue(edit, 'login.url', DEFAULT_SERVICE_URL);
  return edit;
}

/**
 * The form for an existing item.
 */
export function itemEditFromItem(item: Item, totpCodes: TotpCode[], attachments: Attachment[], passkeys: Passkey[]): ItemEdit {
  const fields: FieldEdit[] = item.Fields.map((field: ItemField) => {
    const systemField = field.IsCustomField ? undefined : getSystemField(field.FieldKey);
    const isMultiValue = systemField?.IsMultiValue ?? false;
    const values = Array.isArray(field.Value) ? field.Value : [field.Value];
    return {
      FieldKey: field.FieldKey,
      Label: field.IsCustomField ? field.Label : field.FieldKey,
      FieldType: field.FieldType ?? FieldTypes.Text,
      Value: values[0] ?? '',
      Values: values,
      IsCustomField: field.IsCustomField,
      IsHidden: field.IsHidden,
      EnableHistory: field.EnableHistory,
      DisplayOrder: systemField?.DefaultDisplayOrder ?? field.DisplayOrder,
      Category: field.IsCustomField ? FieldCategories.Custom : systemField?.Category ?? FieldCategories.Custom,
      IsMultiValue: isMultiValue,
    };
  });

  return {
    Id: item.Id,
    ManifestId: item.ManifestId,
    ItemType: item.ItemType,
    ServiceName: item.Name ?? '',
    FolderId: item.FolderId ?? null,
    CreatedAt: item.CreatedAt,
    Fields: fields,
    Attachments: attachments.filter(a => !a.IsDeleted),
    TotpCodes: totpCodes.filter(t => !t.IsDeleted),
    Passkeys: passkeys,
  };
}

/**
 * Move the form to another folder, or out of any folder; the item's manifest follows the folder.
 * @param edit - The form
 * @param folder - The new folder, or null for none
 * @param personalManifestId - The user's personal manifest id
 */
export function setFolder(edit: ItemEdit, folder: FolderRef | null, personalManifestId: string | null): ItemEdit {
  return { ...edit, FolderId: folder?.Id ?? null, ManifestId: manifestForItemIn(folder, personalManifestId) };
}

/**
 * The field with a key, or null.
 */
export function getField(edit: ItemEdit, fieldKey: string): FieldEdit | null {
  return edit.Fields.find(f => f.FieldKey === fieldKey) ?? null;
}

/**
 * The value of a field, empty when absent.
 */
export function getFieldValue(edit: ItemEdit, fieldKey: string): string {
  return getField(edit, fieldKey)?.Value ?? '';
}

/**
 * The values of a multi-value field, at least one (possibly empty) entry.
 */
export function getFieldValues(edit: ItemEdit, fieldKey: string): string[] {
  const field = getField(edit, fieldKey);
  if (!field) {
    return [''];
  }
  if (field.Values.length > 0) {
    return field.Values;
  }
  return field.Value.length > 0 ? [field.Value] : [''];
}

/**
 * Set the value of a system field, adding the field when absent.
 */
export function setFieldValue(edit: ItemEdit, fieldKey: string, value: string): ItemEdit {
  const existing = getField(edit, fieldKey);
  if (existing) {
    const updated: FieldEdit = { ...existing, Value: value, Values: existing.IsMultiValue ? [value] : existing.Values };
    return { ...edit, Fields: edit.Fields.map(f => f === existing ? updated : f) };
  }
  const created = newSystemFieldEdit(fieldKey, value);
  return created ? { ...edit, Fields: [...edit.Fields, created] } : edit;
}

/**
 * Set the values of a multi-value system field.
 */
export function setFieldValues(edit: ItemEdit, fieldKey: string, values: string[]): ItemEdit {
  const withField = getField(edit, fieldKey) ? edit : setFieldValue(edit, fieldKey, '');
  return { ...withField, Fields: withField.Fields.map(f => f.FieldKey === fieldKey ? { ...f, Values: values, Value: values[0] ?? '' } : f) };
}

/**
 * Whether a field has a non-empty value.
 */
export function hasFieldValue(edit: ItemEdit, fieldKey: string): boolean {
  const field = getField(edit, fieldKey);
  if (!field) {
    return false;
  }
  return field.IsMultiValue ? field.Values.some(v => v.length > 0) : field.Value.length > 0;
}

/**
 * The custom fields in display order.
 */
export function getCustomFields(edit: ItemEdit): FieldEdit[] {
  return edit.Fields.filter(f => f.IsCustomField).sort((a, b) => a.DisplayOrder - b.DisplayOrder);
}

/**
 * Add a custom field. Its key is the id of the field definition that will be created on save.
 */
export function addCustomField(edit: ItemEdit, label: string, fieldType: string): ItemEdit {
  const field: FieldEdit = {
    FieldKey: crypto.randomUUID(),
    Label: label,
    FieldType: fieldType,
    Value: '',
    Values: [],
    IsCustomField: true,
    IsHidden: fieldType === FieldTypes.Hidden || fieldType === FieldTypes.Password,
    EnableHistory: false,
    DisplayOrder: edit.Fields.length,
    Category: FieldCategories.Custom,
    IsMultiValue: false,
  };
  return { ...edit, Fields: [...edit.Fields, field] };
}

/**
 * Remove a custom field.
 */
export function removeCustomField(edit: ItemEdit, fieldKey: string): ItemEdit {
  return { ...edit, Fields: edit.Fields.filter(f => !(f.IsCustomField && f.FieldKey === fieldKey)) };
}

/**
 * Change the label and type of a custom field.
 */
export function updateCustomField(edit: ItemEdit, fieldKey: string, label: string, fieldType: string): ItemEdit {
  const hidden = fieldType === FieldTypes.Hidden || fieldType === FieldTypes.Password;
  return { ...edit, Fields: edit.Fields.map(f => f.IsCustomField && f.FieldKey === fieldKey ? { ...f, Label: label, FieldType: fieldType, IsHidden: hidden } : f) };
}

/**
 * Replace the custom fields with a reordered list, renumbering their display order.
 */
export function reorderCustomFields(edit: ItemEdit, reordered: FieldEdit[]): ItemEdit {
  const renumbered = reordered.map((f, index) => ({ ...f, DisplayOrder: index }));
  return { ...edit, Fields: [...edit.Fields.filter(f => !f.IsCustomField), ...renumbered] };
}

/**
 * Whether any alias identity field is filled in.
 */
export function hasAliasValues(edit: ItemEdit): boolean {
  return ['alias.first_name', 'alias.last_name', 'alias.gender', 'alias.birthdate'].some(key => getFieldValue(edit, key).trim().length > 0);
}

/**
 * The item to store: system fields
 * without a value are dropped, as are an email that is only a domain and the URL placeholder; custom fields are
 * always kept, they only go when explicitly removed.
 */
export function itemEditToItem(edit: ItemEdit): Item {
  const fields: ItemField[] = [];
  for (const field of edit.Fields) {
    if (field.IsCustomField) {
      fields.push({ FieldKey: field.FieldKey, Label: field.Label, FieldType: field.FieldType as ItemField['FieldType'], Value: field.Value, IsHidden: field.IsHidden, DisplayOrder: field.DisplayOrder, IsCustomField: true, EnableHistory: false });
      continue;
    }

    let value: string | string[] = field.IsMultiValue ? field.Values.filter(v => v.length > 0) : field.Value;
    if (field.FieldKey === 'login.email' && typeof value === 'string' && value.startsWith('@')) {
      value = '';
    }
    if (field.FieldKey === 'login.url') {
      value = (Array.isArray(value) ? value : [value]).filter(v => v !== DEFAULT_SERVICE_URL && v.trim().length > 0);
    }
    const hasValue = Array.isArray(value) ? value.length > 0 : value.length > 0;
    if (!hasValue) {
      continue;
    }
    fields.push({ FieldKey: field.FieldKey, Label: field.FieldKey, FieldType: field.FieldType as ItemField['FieldType'], Value: value, IsHidden: field.IsHidden, DisplayOrder: field.DisplayOrder, IsCustomField: false, EnableHistory: field.EnableHistory });
  }

  return {
    Id: edit.Id,
    ManifestId: edit.ManifestId,
    Name: edit.ServiceName,
    ItemType: edit.ItemType,
    FolderId: edit.FolderId,
    Fields: fields,
    CreatedAt: edit.CreatedAt,
    UpdatedAt: new Date().toISOString(),
  };
}
