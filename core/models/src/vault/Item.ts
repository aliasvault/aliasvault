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
    LogoInfo?: ItemLogo;
    FolderId?: string | null;
    FolderPath?: string[];
    Tags?: ItemTagRef[];
    Fields: ItemField[];
    HasPasskey?: boolean;
    HasAttachment?: boolean;
    HasTotp?: boolean;
    CreatedAt: string;
    UpdatedAt: string;
}

/**
 * Different kinds of logos an item can have.
 */
export const LogoKinds = {
  /** Fetched automatically from the item's URL; Source is the domain it came from. */
  Favicon: 'favicon',
  /** Picked from the built-in catalog; Source is the AppIconKey and there are no image bytes. */
  Builtin: 'builtin',
  /** Uploaded by the user; Source is the sha256 of the image, which is what makes it reusable. */
  Custom: 'custom',
} as const;

/**
 * Logo kind union derived from the LogoKinds constant.
 */
export type LogoKind = typeof LogoKinds[keyof typeof LogoKinds];

/**
 * The logo an item currently shows, as read from the vault.
 */
export type ItemLogo = {
    Id: string;
    Kind: LogoKind;
    /** The natural key within the kind: a domain, a catalog key, or an image hash. */
    Source: string;
    /** Optional user-facing label, set for uploaded logos. */
    Name?: string | null;
}

/**
 * A logo choice being written to an item: pick one from the library or the catalog by (Kind, Source),
 * or upload new bytes. Leave unset to let the item keep resolving its favicon from its URL.
 */
export type LogoSelection = {
    Kind: LogoKind;
    /** Required for 'builtin' and when picking an existing logo; derived from Data otherwise. */
    Source?: string;
    /** The image bytes, for a new custom logo. */
    Data?: Uint8Array | number[];
    MimeType?: string;
    Name?: string | null;
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
