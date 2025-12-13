/**
 * Encryption key SQLite database type.
 */
type EncryptionKey = {
    Id: string;
    PublicKey: string;
    PrivateKey: string;
    IsPrimary: boolean;
};

/**
 * Settings for password generation stored in SQLite database settings table as string.
 */
type PasswordSettings = {
    /**
     * The length of the password.
     */
    Length: number;
    /**
     * Whether to use lowercase letters.
     */
    UseLowercase: boolean;
    /**
     * Whether to use uppercase letters.
     */
    UseUppercase: boolean;
    /**
     * Whether to use numbers.
     */
    UseNumbers: boolean;
    /**
     * Whether to use special characters.
     */
    UseSpecialChars: boolean;
    /**
     * Whether to use non-ambiguous characters.
     */
    UseNonAmbiguousChars: boolean;
};

/**
 * TotpCode SQLite database type.
 */
type TotpCode = {
    /** The ID of the TOTP code */
    Id: string;
    /** The name of the TOTP code */
    Name: string;
    /** The secret key for the TOTP code */
    SecretKey: string;
    /** The item ID this TOTP code belongs to */
    ItemId: string;
    /** Whether the TOTP code has been deleted (soft delete) */
    IsDeleted?: boolean;
};

/**
 * Credential SQLite database type.
 */
type Credential = {
    Id: string;
    Username?: string;
    Password: string;
    ServiceName: string;
    ServiceUrl?: string;
    Logo?: Uint8Array | number[];
    Notes?: string;
    Alias: Alias;
    /** Indicates if this credential has an associated passkey */
    HasPasskey?: boolean;
    /** The relying party ID (domain) of the associated passkey */
    PasskeyRpId?: string;
    /** The display name of the associated passkey */
    PasskeyDisplayName?: string;
    /** Indicates if this credential has one or more attachments */
    HasAttachment?: boolean;
};
/**
 * Alias SQLite database type.
 */
type Alias = {
    FirstName?: string;
    LastName?: string;
    BirthDate: string;
    Gender?: string;
    Email?: string;
};

/**
 * Attachment SQLite database type.
 */
type Attachment = {
    Id: string;
    Filename: string;
    Blob: Uint8Array | number[];
    ItemId: string;
    CreatedAt: string;
    UpdatedAt: string;
    IsDeleted?: boolean;
};

/**
 * Passkey SQLite database type.
 */
type Passkey = {
    /** The ID of the passkey */
    Id: string;
    /** The item ID foreign key */
    ItemId: string;
    /** The relying party identifier */
    RpId: string;
    /** The user handle (user ID) provided by the relying party - stored as byte array (BLOB) */
    UserHandle?: Uint8Array | number[] | null;
    /** The public key */
    PublicKey: string;
    /** The private key */
    PrivateKey: string;
    /** The PRF encryption key associated with the passkey (optional, only set if PRF was requested by RP) */
    PrfKey?: Uint8Array | number[];
    /** The display name for the passkey */
    DisplayName: string;
    /** Additional data as JSON blob (Base64 encoded) */
    AdditionalData?: string | null;
    /** Created timestamp (epoch milliseconds) */
    CreatedAt: number;
    /** Updated timestamp (epoch milliseconds) */
    UpdatedAt: number;
    /** Soft delete flag (0/1) */
    IsDeleted: number;
};

/**
 * System field keys for the field-based data model.
 * These keys map to FieldDefinition.FieldKey values.
 *
 * System fields use predefined string keys for consistent reference
 * across all platforms. Custom (user-defined) fields have FieldKey = NULL
 * and are identified by their GUID and user-provided Label.
 *
 * Usage:
 * ```typescript
 * // Query by field key
 * WHERE FieldKey = FieldKey.LoginUsername
 *
 * // Insert system field
 * FieldKey = FieldKey.LoginPassword
 *
 * // Custom field
 * FieldKey = null  // User-defined field
 * ```
 */
declare const FieldKey: {
    /**
     * Login username field
     * Type: Text
     */
    readonly LoginUsername: "login.username";
    /**
     * Login password field
     * Type: Password
     */
    readonly LoginPassword: "login.password";
    /**
     * Login notes field
     * Type: Text
     */
    readonly LoginNotes: "login.notes";
    /**
     * Login email field
     * Type: Email
     */
    readonly LoginEmail: "login.email";
    /**
     * Login URL field (multi-value)
     * Type: URL
     */
    readonly LoginUrl: "login.url";
    /**
     * Login recovery codes field (multi-value)
     * Type: Text
     */
    readonly LoginRecoveryCodes: "login.recovery_codes";
    /**
     * Credit card number field
     * Type: Text
     */
    readonly CardNumber: "card.number";
    /**
     * Credit card cardholder name field
     * Type: Text
     */
    readonly CardCardholderName: "card.cardholder_name";
    /**
     * Credit card expiry month field
     * Type: Text
     */
    readonly CardExpiryMonth: "card.expiry_month";
    /**
     * Credit card expiry year field
     * Type: Text
     */
    readonly CardExpiryYear: "card.expiry_year";
    /**
     * Credit card CVV field
     * Type: Password
     */
    readonly CardCvv: "card.cvv";
    /**
     * Credit card PIN field
     * Type: Password
     */
    readonly CardPin: "card.pin";
    /**
     * Identity title field (e.g., Mr., Mrs., Dr.)
     * Type: Text
     */
    readonly IdentityTitle: "identity.title";
    /**
     * Identity first name field
     * Type: Text
     */
    readonly IdentityFirstName: "identity.first_name";
    /**
     * Identity middle name field
     * Type: Text
     */
    readonly IdentityMiddleName: "identity.middle_name";
    /**
     * Identity last name field
     * Type: Text
     */
    readonly IdentityLastName: "identity.last_name";
    /**
     * Identity email field
     * Type: Email
     */
    readonly IdentityEmail: "identity.email";
    /**
     * Identity phone number field (multi-value)
     * Type: Text
     */
    readonly IdentityPhoneNumbers: "identity.phone_numbers";
    /**
     * Identity address line 1 field
     * Type: Text
     */
    readonly IdentityAddressLine1: "identity.address_line1";
    /**
     * Identity address line 2 field
     * Type: Text
     */
    readonly IdentityAddressLine2: "identity.address_line2";
    /**
     * Identity city field
     * Type: Text
     */
    readonly IdentityCity: "identity.city";
    /**
     * Identity state/province field
     * Type: Text
     */
    readonly IdentityState: "identity.state";
    /**
     * Identity postal code field
     * Type: Text
     */
    readonly IdentityPostalCode: "identity.postal_code";
    /**
     * Identity country field
     * Type: Text
     */
    readonly IdentityCountry: "identity.country";
    /**
     * Alias first name field
     * Type: Text
     */
    readonly AliasFirstName: "alias.first_name";
    /**
     * Alias last name field
     * Type: Text
     */
    readonly AliasLastName: "alias.last_name";
    /**
     * Alias gender field
     * Type: Text
     */
    readonly AliasGender: "alias.gender";
    /**
     * Alias birth date field
     * Type: Date
     */
    readonly AliasBirthdate: "alias.birthdate";
};
/**
 * Type representing all valid field key values
 */
type FieldKeyValue = typeof FieldKey[keyof typeof FieldKey];

type Tag = {
    Id: string;
    Name: string;
    Color?: string;
    DisplayOrder: number;
    CreatedAt: string;
    UpdatedAt: string;
    IsDeleted: number;
};

type ItemTag = {
    Id: string;
    ItemId: string;
    TagId: string;
    CreatedAt: string;
    UpdatedAt: string;
    IsDeleted: number;
};

/**
 * Item types supported by the vault.
 */
declare const ItemTypes: {
    readonly Login: "Login";
    readonly Alias: "Alias";
    readonly CreditCard: "CreditCard";
    readonly Note: "Note";
};
/**
 * Item type union derived from ItemTypes constant
 */
type ItemType = typeof ItemTypes[keyof typeof ItemTypes];
/**
 * Item type representing vault entries in the new field-based data model.
 */
type Item = {
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
};
/**
 * Field value within an item
 */
type ItemField = {
    FieldKey: string;
    Label: string;
    FieldType: FieldType;
    Value: string | string[];
    IsHidden: boolean;
    DisplayOrder: number;
};
/**
 * Field types for rendering and validation.
 */
declare const FieldTypes: {
    readonly Text: "Text";
    readonly Password: "Password";
    readonly Hidden: "Hidden";
    readonly Email: "Email";
    readonly URL: "URL";
    readonly Date: "Date";
    readonly Number: "Number";
    readonly Phone: "Phone";
    readonly TextArea: "TextArea";
};
/**
 * Field type union derived from FieldTypes constant
 */
type FieldType = typeof FieldTypes[keyof typeof FieldTypes];
/**
 * Tag reference for display within an item
 */
type ItemTagRef = {
    Id: string;
    Name: string;
    Color?: string;
};

/**
 * Helper functions for working with Item model
 */
/**
 * Get a single field value by FieldKey
 */
declare function getFieldValue(item: Item, fieldKey: string): string | undefined;
/**
 * Get all values for a multi-value field
 */
declare function getFieldValues(item: Item, fieldKey: string): string[];
/**
 * Check if a field exists and has a value
 */
declare function hasField(item: Item, fieldKey: string): boolean;
/**
 * Group fields by a categorization function
 */
declare function groupFields(item: Item, grouper: (field: ItemField) => string): Record<string, ItemField[]>;
/**
 * Group fields by standard categories (Login, Alias, Custom)
 */
declare function groupFieldsByCategory(item: Item): Record<string, ItemField[]>;
/**
 * Convert new Item model to legacy Credential model for backward compatibility.
 * @deprecated Use Item model directly. This is a temporary compatibility layer.
 */
declare function itemToCredential(item: Item): Credential;

/**
 * Per-item-type configuration for a system field.
 * Allows specifying different behavior for each item type the field applies to.
 */
type ItemTypeFieldConfig = {
    /** Whether this field is shown by default in create mode (vs. hidden behind an "add" button) */
    ShowByDefault: boolean;
};
/**
 * Field categories for grouping in UI.
 * Single source of truth - the type is derived from this constant.
 */
declare const FieldCategories: {
    readonly Primary: "Primary";
    readonly Login: "Login";
    readonly Alias: "Alias";
    readonly Card: "Card";
    readonly Metadata: "Metadata";
};
/**
 * Field category type derived from FieldCategories constant
 */
type FieldCategory = typeof FieldCategories[keyof typeof FieldCategories];
/**
 * System field definition with metadata.
 * System fields are predefined fields with immutable keys like 'login.username'.
 * Their metadata (type, etc.) is defined here in code, not in the database.
 */
type SystemFieldDefinition = {
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
declare const SystemFieldRegistry: Record<string, SystemFieldDefinition>;
/**
 * Get system field definition by key.
 * Returns undefined if the field key is not a system field.
 */
declare function getSystemField(fieldKey: string): SystemFieldDefinition | undefined;
/**
 * Check if a field key represents a system field.
 */
declare function isSystemField(fieldKey: string): boolean;
/**
 * Check if a field applies to a specific item type.
 */
declare function fieldAppliesToType(field: SystemFieldDefinition, itemType: ItemType): boolean;
/**
 * Get the per-type configuration for a field and item type.
 * Returns undefined if the field doesn't apply to that item type.
 */
declare function getFieldConfigForType(field: SystemFieldDefinition, itemType: ItemType): ItemTypeFieldConfig | undefined;
/**
 * Check if a field should be shown by default for a specific item type.
 * Returns false if the field doesn't apply to that item type.
 */
declare function isFieldShownByDefault(field: SystemFieldDefinition, itemType: ItemType): boolean;
/**
 * Get all system fields applicable to a specific item type.
 * Results are sorted by DefaultDisplayOrder.
 */
declare function getSystemFieldsForItemType(itemType: ItemType): SystemFieldDefinition[];
/**
 * Get system fields that should be shown by default for a specific item type.
 * Results are sorted by DefaultDisplayOrder.
 */
declare function getDefaultFieldsForItemType(itemType: ItemType): SystemFieldDefinition[];
/**
 * Get system fields that are NOT shown by default for a specific item type.
 * These are the fields that can be added via an "add field" button.
 * Results are sorted by DefaultDisplayOrder.
 */
declare function getOptionalFieldsForItemType(itemType: ItemType): SystemFieldDefinition[];
/**
 * Get all system field keys.
 */
declare function getAllSystemFieldKeys(): string[];
/**
 * Check if a field key matches a known system field prefix.
 * This is useful for validation even before a specific field is registered.
 */
declare function isSystemFieldPrefix(fieldKey: string): boolean;

/**
 * Field history record tracking changes to field values over time.
 * Used for fields that have EnableHistory=true (e.g., passwords).
 */
type FieldHistory = {
    /** Unique identifier for this history record */
    Id: string;
    /** ID of the item this history belongs to */
    ItemId: string;
    /** Field key (e.g., 'login.password') */
    FieldKey: string;
    /** Snapshot of the field value(s) at this point in time */
    ValueSnapshot: string;
    /** When this change occurred */
    ChangedAt: string;
    /** When this history record was created */
    CreatedAt: string;
    /** When this history record was last updated */
    UpdatedAt: string;
};
/**
 * Maximum number of history records to keep per field.
 * Older records beyond this limit should be automatically pruned.
 */
declare const MAX_FIELD_HISTORY_RECORDS = 10;

export { type Alias, type Attachment, type Credential, type EncryptionKey, FieldCategories, type FieldCategory, type FieldHistory, FieldKey, type FieldKeyValue, type FieldType, FieldTypes, type Item, type ItemField, type ItemTag, type ItemTagRef, type ItemType, type ItemTypeFieldConfig, ItemTypes, MAX_FIELD_HISTORY_RECORDS, type Passkey, type PasswordSettings, type SystemFieldDefinition, SystemFieldRegistry, type Tag, type TotpCode, fieldAppliesToType, getAllSystemFieldKeys, getDefaultFieldsForItemType, getFieldConfigForType, getFieldValue, getFieldValues, getOptionalFieldsForItemType, getSystemField, getSystemFieldsForItemType, groupFields, groupFieldsByCategory, hasField, isFieldShownByDefault, isSystemField, isSystemFieldPrefix, itemToCredential };
