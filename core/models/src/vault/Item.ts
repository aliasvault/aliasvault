/**
 * Item types supported by the vault.
 */
export const ItemTypes = {
  Login: 'Login',
  Alias: 'Alias',
  CreditCard: 'CreditCard',
  Note: 'Note',
} as const;

/**
 * Item type union derived from ItemTypes constant
 */
export type ItemType = typeof ItemTypes[keyof typeof ItemTypes];

/**
 * Item type representing vault entries in the new field-based data model.
 */
export type Item = {
    Id: string;
    Name: string | null;
    ItemType: ItemType;
    Logo?: Uint8Array | number[];
    FolderId?: string | null;
    FolderPath?: string | null;
    Tags?: ItemTagRef[];
    Fields: ItemField[];
    HasPasskey?: boolean;
    HasAttachment?: boolean;
    HasTotp?: boolean;
    CreatedAt: string;
    UpdatedAt: string;
}

/**
 * Field value within an item.
 * For system fields: FieldKey is the system field key (e.g., "login.username"), IsCustomField is false.
 * For custom fields: FieldKey is the FieldDefinitionId (UUID), IsCustomField is true.
 */
export type ItemField = {
    FieldKey: string;
    Label: string;
    FieldType: FieldType;
    Value: string | string[];
    IsHidden: boolean;
    DisplayOrder: number;
    /**
     * Whether this is a custom (user-defined) field.
     * Custom fields have their metadata stored in FieldDefinitions table.
     * System fields have their metadata defined in code (SystemFieldRegistry).
     */
    IsCustomField: boolean;
    /**
     * Whether history tracking is enabled for this field.
     * For system fields, this comes from SystemFieldRegistry.
     * For custom fields, this comes from the FieldDefinition record.
     */
    EnableHistory: boolean;
}

/**
 * Field types for rendering and validation.
 */
export const FieldTypes = {
  Text: 'Text',
  Password: 'Password',
  Hidden: 'Hidden',
  Email: 'Email',
  URL: 'URL',
  Date: 'Date',
  Number: 'Number',
  Phone: 'Phone',
  TextArea: 'TextArea',
} as const;

/**
 * Field type union derived from FieldTypes constant
 */
export type FieldType = typeof FieldTypes[keyof typeof FieldTypes];

/**
 * Tag reference for display within an item
 */
export type ItemTagRef = {
    Id: string;
    Name: string;
    Color?: string;
}
