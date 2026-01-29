import type { FieldType, ItemType } from './Item';

/**
 * Per-item-type configuration for a system field.
 * Allows specifying different behavior for each item type the field applies to.
 */
export type ItemTypeFieldConfig = {
  /** Whether this field is shown by default in create mode (vs. hidden behind an "add" button) */
  ShowByDefault: boolean;
};

/**
 * Field categories for grouping in UI.
 * Single source of truth - the type is derived from this constant.
 */
export const FieldCategories = {
  Primary: 'Primary',
  Login: 'Login',
  Alias: 'Alias',
  Card: 'Card',
  Custom: 'Custom',
  Notes: 'Notes',
  Metadata: 'Metadata',
} as const;

/**
 * Field category type derived from FieldCategories constant
 */
export type FieldCategory = typeof FieldCategories[keyof typeof FieldCategories];

/**
 * System field definition with metadata.
 * System fields are predefined fields with immutable keys like 'login.username'.
 * Their metadata (type, etc.) is defined here in code, not in the database.
 */
export type SystemFieldDefinition = {
  /** Unique system field key (e.g., 'login.username') */
  FieldKey: string;
  /** Field type for rendering/validation */
  FieldType: FieldType;
  /** Whether field is hidden/masked by default */
  IsHidden: boolean;
  /** Whether field supports multiple values */
  IsMultiValue: boolean;
  /**
   * Item types this field applies to, with per-type configuration.
   * Key is ItemType, value is the configuration for that type.
   */
  ApplicableToTypes: Partial<Record<ItemType, ItemTypeFieldConfig>>;
  /** Whether to track field value history */
  EnableHistory: boolean;
  /** Category for grouping in UI. 'Primary' fields are shown in the name block. */
  Category: FieldCategory;
  /** Default display order within category (lower = first) */
  DefaultDisplayOrder: number;
};

/**
 * Registry of all system-defined fields.
 * These fields are immutable and their metadata is defined in code.
 * DO NOT modify these definitions without careful consideration of backwards compatibility.
 *
 * Item Types:
 * - Login: Username/password credentials (alias fields optional)
 * - Alias: Login with pre-filled alias identity fields shown by default
 * - CreditCard: Payment card information
 */
export const SystemFieldRegistry: Record<string, SystemFieldDefinition> = {
  /* =================== LOGIN FIELDS =================== */
  'login.email': {
    FieldKey: 'login.email',
    FieldType: 'Email',
    IsHidden: false,
    IsMultiValue: false,
    ApplicableToTypes: {
      Login: { ShowByDefault: false },
      Alias: { ShowByDefault: true }
    },
    EnableHistory: true,
    Category: FieldCategories.Login,
    DefaultDisplayOrder: 10
  },
  'login.username': {
    FieldKey: 'login.username',
    FieldType: 'Text',
    IsHidden: false,
    IsMultiValue: false,
    ApplicableToTypes: {
      Login: { ShowByDefault: true },
      Alias: { ShowByDefault: true }
    },
    EnableHistory: true,
    Category: FieldCategories.Login,
    DefaultDisplayOrder: 15
  },
  'login.password': {
    FieldKey: 'login.password',
    FieldType: 'Password',
    IsHidden: true,
    IsMultiValue: false,
    ApplicableToTypes: {
      Login: { ShowByDefault: true },
      Alias: { ShowByDefault: true }
    },
    EnableHistory: true,
    Category: FieldCategories.Login,
    DefaultDisplayOrder: 20
  },
  'login.url': {
    FieldKey: 'login.url',
    FieldType: 'URL',
    IsHidden: false,
    IsMultiValue: true,
    ApplicableToTypes: {
      Login: { ShowByDefault: true },
      Alias: { ShowByDefault: true }
    },
    EnableHistory: false,
    Category: FieldCategories.Primary,
    DefaultDisplayOrder: 5
  },

  /* =================== ALIAS FIELDS =================== */
  'alias.first_name': {
    FieldKey: 'alias.first_name',
    FieldType: 'Text',
    IsHidden: false,
    IsMultiValue: false,
    ApplicableToTypes: {
      Alias: { ShowByDefault: true }
    },
    EnableHistory: false,
    Category: FieldCategories.Alias,
    DefaultDisplayOrder: 20
  },
  'alias.last_name': {
    FieldKey: 'alias.last_name',
    FieldType: 'Text',
    IsHidden: false,
    IsMultiValue: false,
    ApplicableToTypes: {
      Alias: { ShowByDefault: true }
    },
    EnableHistory: false,
    Category: FieldCategories.Alias,
    DefaultDisplayOrder: 30
  },
  'alias.gender': {
    FieldKey: 'alias.gender',
    FieldType: 'Text',
    IsHidden: false,
    IsMultiValue: false,
    ApplicableToTypes: {
      Alias: { ShowByDefault: true }
    },
    EnableHistory: false,
    Category: FieldCategories.Alias,
    DefaultDisplayOrder: 50
  },
  'alias.birthdate': {
    FieldKey: 'alias.birthdate',
    FieldType: 'Date',
    IsHidden: false,
    IsMultiValue: false,
    ApplicableToTypes: {
      Alias: { ShowByDefault: true }
    },
    EnableHistory: false,
    Category: FieldCategories.Alias,
    DefaultDisplayOrder: 60
  },

  /* =================== CREDIT CARD FIELDS =================== */
  'card.cardholder_name': {
    FieldKey: 'card.cardholder_name',
    FieldType: 'Text',
    IsHidden: false,
    IsMultiValue: false,
    ApplicableToTypes: {
      CreditCard: { ShowByDefault: true }
    },
    EnableHistory: false,
    Category: FieldCategories.Card,
    DefaultDisplayOrder: 10
  },
  'card.number': {
    FieldKey: 'card.number',
    FieldType: 'Hidden',
    IsHidden: true,
    IsMultiValue: false,
    ApplicableToTypes: {
      CreditCard: { ShowByDefault: true }
    },
    EnableHistory: false,
    Category: FieldCategories.Card,
    DefaultDisplayOrder: 20
  },
  'card.expiry_month': {
    FieldKey: 'card.expiry_month',
    FieldType: 'Text',
    IsHidden: false,
    IsMultiValue: false,
    ApplicableToTypes: {
      CreditCard: { ShowByDefault: true }
    },
    EnableHistory: false,
    Category: FieldCategories.Card,
    DefaultDisplayOrder: 30
  },
  'card.expiry_year': {
    FieldKey: 'card.expiry_year',
    FieldType: 'Text',
    IsHidden: false,
    IsMultiValue: false,
    ApplicableToTypes: {
      CreditCard: { ShowByDefault: true }
    },
    EnableHistory: false,
    Category: FieldCategories.Card,
    DefaultDisplayOrder: 40
  },
  'card.cvv': {
    FieldKey: 'card.cvv',
    FieldType: 'Hidden',
    IsHidden: true,
    IsMultiValue: false,
    ApplicableToTypes: {
      CreditCard: { ShowByDefault: true }
    },
    EnableHistory: false,
    Category: FieldCategories.Card,
    DefaultDisplayOrder: 50
  },
  'card.pin': {
    FieldKey: 'card.pin',
    FieldType: 'Hidden',
    IsHidden: true,
    IsMultiValue: false,
    ApplicableToTypes: {
      CreditCard: { ShowByDefault: false }
    },
    EnableHistory: false,
    Category: FieldCategories.Card,
    DefaultDisplayOrder: 60
  },

  /* =================== NOTES FIELDS =================== */
  'notes.content': {
    FieldKey: 'notes.content',
    FieldType: 'TextArea',
    IsHidden: false,
    IsMultiValue: false,
    ApplicableToTypes: {
      Login: { ShowByDefault: false },
      Alias: { ShowByDefault: false },
      CreditCard: { ShowByDefault: false },
      Note: { ShowByDefault: true }
    },
    EnableHistory: false,
    Category: FieldCategories.Notes,
    DefaultDisplayOrder: 100
  }
};

/**
 * Get system field definition by key.
 * Returns undefined if the field key is not a system field.
 */
export function getSystemField(fieldKey: string): SystemFieldDefinition | undefined {
  return SystemFieldRegistry[fieldKey];
}

/**
 * Check if a field key represents a system field.
 */
export function isSystemField(fieldKey: string): boolean {
  return fieldKey in SystemFieldRegistry;
}

/**
 * Check if a field applies to a specific item type.
 */
export function fieldAppliesToType(field: SystemFieldDefinition, itemType: ItemType): boolean {
  return itemType in field.ApplicableToTypes;
}

/**
 * Get the per-type configuration for a field and item type.
 * Returns undefined if the field doesn't apply to that item type.
 */
export function getFieldConfigForType(field: SystemFieldDefinition, itemType: ItemType): ItemTypeFieldConfig | undefined {
  return field.ApplicableToTypes[itemType];
}

/**
 * Check if a field should be shown by default for a specific item type.
 * Returns false if the field doesn't apply to that item type.
 */
export function isFieldShownByDefault(field: SystemFieldDefinition, itemType: ItemType): boolean {
  const config = field.ApplicableToTypes[itemType];
  return config?.ShowByDefault ?? false;
}

/**
 * Get all system fields applicable to a specific item type.
 * Results are sorted by DefaultDisplayOrder.
 */
export function getSystemFieldsForItemType(itemType: ItemType): SystemFieldDefinition[] {
  return Object.values(SystemFieldRegistry)
    .filter(field => fieldAppliesToType(field, itemType))
    .sort((a, b) => a.DefaultDisplayOrder - b.DefaultDisplayOrder);
}

/**
 * Get system fields that should be shown by default for a specific item type.
 * Results are sorted by DefaultDisplayOrder.
 */
export function getDefaultFieldsForItemType(itemType: ItemType): SystemFieldDefinition[] {
  return Object.values(SystemFieldRegistry)
    .filter(field => isFieldShownByDefault(field, itemType))
    .sort((a, b) => a.DefaultDisplayOrder - b.DefaultDisplayOrder);
}

/**
 * Get system fields that are NOT shown by default for a specific item type.
 * These are the fields that can be added via an "add field" button.
 * Results are sorted by DefaultDisplayOrder.
 */
export function getOptionalFieldsForItemType(itemType: ItemType): SystemFieldDefinition[] {
  return Object.values(SystemFieldRegistry)
    .filter(field => fieldAppliesToType(field, itemType) && !isFieldShownByDefault(field, itemType))
    .sort((a, b) => a.DefaultDisplayOrder - b.DefaultDisplayOrder);
}

/**
 * Get all system field keys.
 */
export function getAllSystemFieldKeys(): string[] {
  return Object.keys(SystemFieldRegistry);
}

/**
 * Check if a field key matches a known system field prefix.
 * This is useful for validation even before a specific field is registered.
 */
export function isSystemFieldPrefix(fieldKey: string): boolean {
  return fieldKey.startsWith('login.') ||
         fieldKey.startsWith('alias.') ||
         fieldKey.startsWith('card.') ||
         fieldKey.startsWith('notes.');
}
