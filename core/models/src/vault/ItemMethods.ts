import type { Item, ItemField, FieldType } from './Item';
import { FieldTypes } from './Item';
import type { Credential } from './Credential';
import { FieldKey } from './FieldKey';
import { FieldCategories, getSystemField } from './SystemFieldRegistry';

/**
 * Helper functions for working with Item model
 */

/**
 * Get a single field value by FieldKey
 */
export function getFieldValue(item: Item, fieldKey: string): string | undefined {
  const field = item.Fields.find(f => f.FieldKey === fieldKey);
  if (!field) {
    return undefined;
  }
  return Array.isArray(field.Value) ? field.Value[0] : field.Value;
}

/**
 * Get all values for a multi-value field
 */
export function getFieldValues(item: Item, fieldKey: string): string[] {
  const field = item.Fields.find(f => f.FieldKey === fieldKey);
  if (!field) {
    return [];
  }
  return Array.isArray(field.Value) ? field.Value : [field.Value];
}

/**
 * Check if a field exists and has a value
 */
export function hasField(item: Item, fieldKey: string): boolean {
  const value = getFieldValue(item, fieldKey);
  return value !== undefined && value !== '';
}

/**
 * Group fields by a categorization function
 */
export function groupFields(
  item: Item,
  grouper: (field: ItemField) => string
): Record<string, ItemField[]> {
  const groups: Record<string, ItemField[]> = {};

  item.Fields.forEach(field => {
    const group = grouper(field);
    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(field);
  });

  return groups;
}

/**
 * Group fields by standard categories (Login, Alias, Card, Notes, Custom)
 */
export function groupFieldsByCategory(item: Item): Record<string, ItemField[]> {
  return groupFields(item, (field) => {
    if (field.FieldKey.startsWith('login.')) {
      return FieldCategories.Login;
    }
    if (field.FieldKey.startsWith('alias.')) {
      return FieldCategories.Alias;
    }
    if (field.FieldKey.startsWith('card.')) {
      return FieldCategories.Card;
    }
    if (field.FieldKey.startsWith('notes.')) {
      return FieldCategories.Notes;
    }
    if (field.FieldKey.startsWith('metadata.')) {
      return FieldCategories.Metadata;
    }
    return FieldCategories.Custom;
  });
}

/**
 * Convert new Item model to legacy Credential model for backward compatibility.
 * @deprecated Use Item model directly. This is a temporary compatibility layer.
 */
export function itemToCredential(item: Item): Credential {
  return {
    Id: item.Id,
    Username: getFieldValue(item, FieldKey.LoginUsername),
    Password: getFieldValue(item, FieldKey.LoginPassword) || '',
    ServiceName: item.Name || '',
    ServiceUrl: getFieldValue(item, FieldKey.LoginUrl),
    Logo: item.Logo,
    Notes: getFieldValue(item, FieldKey.NotesContent),
    Alias: {
      FirstName: getFieldValue(item, FieldKey.AliasFirstName),
      LastName: getFieldValue(item, FieldKey.AliasLastName),
      BirthDate: getFieldValue(item, FieldKey.AliasBirthdate) || '',
      Gender: getFieldValue(item, FieldKey.AliasGender),
      Email: getFieldValue(item, FieldKey.LoginEmail)
    },
    HasPasskey: item.HasPasskey,
    HasAttachment: item.HasAttachment
  };
}

/**
 * Options for creating a system field.
 * Only `value` is required; metadata is derived from SystemFieldRegistry.
 */
export type CreateSystemFieldOptions = {
  /** The value for the field (string or string[] for multi-value) */
  value: string | string[];
  /** Override display order (optional, defaults from registry) */
  displayOrder?: number;
  /** Override label (optional, normally derived from FieldKey for translation) */
  label?: string;
};

/**
 * Options for creating a custom field.
 */
export type CreateCustomFieldOptions = {
  /** Unique identifier for the custom field (UUID) */
  fieldKey: string;
  /** Display label for the field */
  label: string;
  /** The value for the field */
  value: string | string[];
  /** Field type for rendering */
  fieldType?: FieldType;
  /** Whether the field is hidden/masked */
  isHidden?: boolean;
  /** Display order */
  displayOrder?: number;
  /** Whether to track history (defaults to false for custom fields) */
  enableHistory?: boolean;
};

/**
 * Create a system field (ItemField) by FieldKey with metadata derived from SystemFieldRegistry.
 *
 * @param fieldKey - The system field key (e.g., 'login.username', FieldKey.LoginPassword)
 * @param options - Field creation options (value required, displayOrder optional)
 * @returns ItemField with proper metadata from SystemFieldRegistry
 * @throws Error if fieldKey is not found in SystemFieldRegistry
 */
export function createSystemField(fieldKey: string, options: CreateSystemFieldOptions): ItemField {
  const systemField = getSystemField(fieldKey);
  if (!systemField) {
    throw new Error(`Unknown system field: ${fieldKey}. Use createCustomField for custom fields.`);
  }

  return {
    FieldKey: fieldKey,
    Label: options.label ?? fieldKey, // UI layer translates via fieldLabels.*
    FieldType: systemField.FieldType,
    Value: options.value,
    IsHidden: systemField.IsHidden,
    DisplayOrder: options.displayOrder ?? systemField.DefaultDisplayOrder,
    IsCustomField: false,
    EnableHistory: systemField.EnableHistory,
  };
}

/**
 * Create a custom field (ItemField) with sensible defaults.
 *
 * @param options - Custom field options
 * @returns ItemField configured as a custom field
 */
export function createCustomField(options: CreateCustomFieldOptions): ItemField {
  return {
    FieldKey: options.fieldKey,
    Label: options.label,
    FieldType: options.fieldType ?? FieldTypes.Text,
    Value: options.value,
    IsHidden: options.isHidden ?? false,
    DisplayOrder: options.displayOrder ?? 0,
    IsCustomField: true,
    EnableHistory: options.enableHistory ?? false, // Custom fields don't track history by default
  };
}
