/**
 * Encryption key SQLite database type.
 */
type EncryptionKey = {
    Id: string;
    ManifestId?: string | null;
    PublicKey: string;
    PrivateKey: string;
    IsPrimary: boolean;
};

/**
 * Which generator a password setting uses.
 */
type PasswordGeneratorType = 'basic' | 'diceware';
/**
 * Capitalization applied to each Diceware word.
 */
type DicewareCapitalization = 'None' | 'TitleCase' | 'Uppercase' | 'Lowercase' | 'Random';
/**
 * Separator placed between Diceware words.
 */
type DicewareSeparator = 'None' | 'Dash' | 'Space' | 'Underscore' | 'Dot';
/**
 * Optional random salt character added to a Diceware passphrase.
 */
type DicewareSalt = 'None' | 'Prefix' | 'Sprinkle' | 'Suffix';
/**
 * Settings for password generation stored in SQLite database settings table as string.
 *
 * The Diceware fields are optional so that older stored blobs (which only contain the
 * basic-password fields) remain valid; defaults are applied when reading the settings.
 */
type PasswordSettings = {
    /**
     * The length of the password (basic generator).
     */
    Length: number;
    /**
     * Whether to use lowercase letters (basic generator).
     */
    UseLowercase: boolean;
    /**
     * Whether to use uppercase letters (basic generator).
     */
    UseUppercase: boolean;
    /**
     * Whether to use numbers (basic generator).
     */
    UseNumbers: boolean;
    /**
     * Whether to use special characters (basic generator).
     */
    UseSpecialChars: boolean;
    /**
     * Whether to use non-ambiguous characters (basic generator).
     */
    UseNonAmbiguousChars: boolean;
    /**
     * Which generator to use. Defaults to 'basic' when absent.
     */
    Type?: PasswordGeneratorType;
    /**
     * Number of words in the passphrase (diceware generator).
     */
    WordCount?: number;
    /**
     * Wordlist language code (diceware generator).
     */
    Language?: string;
    /**
     * Capitalization applied to each word (diceware generator). Defaults to 'Lowercase'.
     */
    Capitalization?: DicewareCapitalization;
    /**
     * Separator between words (diceware generator). Defaults to 'Dash'.
     */
    Separator?: DicewareSeparator;
    /**
     * Optional random salt character (diceware generator). Defaults to 'None'.
     */
    Salt?: DicewareSalt;
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
    /** The HMAC algorithm used to derive the code: SHA1, SHA256 or SHA512 */
    Algorithm: string;
    /** The number of digits in the generated code, typically 6 or 8 */
    Digits: number;
    /** The time step in seconds a code stays valid for, typically 30 or 60 */
    Period: number;
    /** The item ID this TOTP code belongs to */
    ItemId: string;
    /** Whether the TOTP code has been deleted (soft delete) */
    IsDeleted?: boolean;
};
/** The HMAC algorithm RFC 6238 assumes when an otpauth:// URI omits the `algorithm` parameter. */
declare const TOTP_DEFAULT_ALGORITHM = "SHA1";
/** The code length RFC 6238 assumes when an otpauth:// URI omits the `digits` parameter. */
declare const TOTP_DEFAULT_DIGITS = 6;
/** The time step RFC 6238 assumes when an otpauth:// URI omits the `period` parameter. */
declare const TOTP_DEFAULT_PERIOD = 30;
/** The HMAC algorithms the TOTP generators implement. Anything else falls back to {@link TOTP_DEFAULT_ALGORITHM}. */
declare const TOTP_SUPPORTED_ALGORITHMS: readonly ["SHA1", "SHA256", "SHA512"];
/**
 * Normalizes a raw `algorithm` value (from an otpauth:// URI or an older vault row) to one of
 * {@link TOTP_SUPPORTED_ALGORITHMS}, falling back to {@link TOTP_DEFAULT_ALGORITHM}.
 *
 * @param value - Raw algorithm value, e.g. "sha256" or undefined
 * @returns A supported algorithm name in uppercase
 */
declare function normalizeTotpAlgorithm(value: string | null | undefined): string;
/**
 * Normalizes a raw `digits` value to a supported code length, falling back to {@link TOTP_DEFAULT_DIGITS}.
 *
 * The 6-8 range is what the authenticator ecosystem actually issues, and it keeps the modulo below 2^32
 * so the native generators can compute it in a 32-bit integer without overflowing.
 *
 * @param value - Raw digits value, e.g. "8" or undefined
 * @returns A usable digit count
 */
declare function normalizeTotpDigits(value: string | number | null | undefined): number;
/**
 * Normalizes a raw `period` value to a positive time step, falling back to {@link TOTP_DEFAULT_PERIOD}.
 *
 * @param value - Raw period value, e.g. "60" or undefined
 * @returns A usable period in seconds
 */
declare function normalizeTotpPeriod(value: string | number | null | undefined): number;

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
    /** The manifest this passkey belongs to. */
    ManifestId: string;
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
    /**
     * Notes content field
     * Type: TextArea
     */
    readonly NotesContent: "notes.content";
};
/**
 * Type representing all valid field key values
 */
type FieldKeyValue = typeof FieldKey[keyof typeof FieldKey];

/**
 * Known data-bucket categories for the manifest-v1 storage format. Each value is one small,
 * independently-versioned, user-scoped category of encrypted data kept out of the main vault content
 * manifest so it syncs cheaply. Serialized as its string name on the wire.
 */
declare const VaultDataBucketCategory: {
    /**
     * User client settings (sort order, autofill prefs, identity defaults, etc.).
     */
    readonly Settings: "Settings";
    /**
     * Per-item usage statistics (last used, use counts).
     */
    readonly Stats: "Stats";
};
/**
 * Type representing all valid vault data bucket category values.
 */
type VaultDataBucketCategoryValue = typeof VaultDataBucketCategory[keyof typeof VaultDataBucketCategory];
/**
 * Human-readable description per category, emitted into the generated platform variants' doc comments.
 */
declare const VaultDataBucketCategoryDescriptions: Record<VaultDataBucketCategoryValue, string>;

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
    ManifestId: string;
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
};
/**
 * Different kinds of logos an item can have.
 */
declare const LogoKinds: {
    /** Fetched automatically from the item's URL; Source is the domain it came from. */
    readonly Favicon: "favicon";
    /** Picked from the built-in catalog; Source is the AppIconKey and there are no image bytes. */
    readonly Builtin: "builtin";
    /** Uploaded by the user; Source is the sha256 of the image, which is what makes it reusable. */
    readonly Custom: "custom";
};
/**
 * Logo kind union derived from the LogoKinds constant.
 */
type LogoKind = typeof LogoKinds[keyof typeof LogoKinds];
/**
 * The logo an item currently shows, as read from the vault.
 */
type ItemLogo = {
    Id: string;
    Kind: LogoKind;
    /** The natural key within the kind: a domain, a catalog key, or an image hash. */
    Source: string;
    /** Optional user-facing label, set for uploaded logos. */
    Name?: string | null;
};
/**
 * A logo choice being written to an item: pick one from the library or the catalog by (Kind, Source),
 * or upload new bytes. Leave unset to let the item keep resolving its favicon from its URL.
 */
type LogoSelection = {
    Kind: LogoKind;
    /** Required for 'builtin' and when picking an existing logo; derived from Data otherwise. */
    Source?: string;
    /** The image bytes, for a new custom logo. */
    Data?: Uint8Array | number[];
    MimeType?: string;
    Name?: string | null;
};
/**
 * Field value within an item.
 * For system fields: FieldKey is the system field key (e.g., "login.username"), IsCustomField is false.
 * For custom fields: FieldKey is the FieldDefinitionId (UUID), IsCustomField is true.
 */
type ItemField = {
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
 * Group fields by standard categories (Login, Alias, Card, Notes, Custom)
 * Fields within each category are sorted by DisplayOrder.
 */
declare function groupFieldsByCategory(item: Item): Record<string, ItemField[]>;
/**
 * Convert new Item model to legacy Credential model for backward compatibility.
 * @deprecated Use Item model directly. This is a temporary compatibility layer.
 */
declare function itemToCredential(item: Item): Credential;
/**
 * Options for creating a system field.
 * Only `value` is required; metadata is derived from SystemFieldRegistry.
 */
type CreateSystemFieldOptions = {
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
type CreateCustomFieldOptions = {
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
declare function createSystemField(fieldKey: string, options: CreateSystemFieldOptions): ItemField;
/**
 * Create a custom field (ItemField) with sensible defaults.
 *
 * @param options - Custom field options
 * @returns ItemField configured as a custom field
 */
declare function createCustomField(options: CreateCustomFieldOptions): ItemField;

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
    readonly Custom: "Custom";
    readonly Notes: "Notes";
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

/**
 * The client vault datamodel registry: one entry per syncable client vault table, carrying the
 * metadata every platform needs to agree on (primary keys, manifest scoping, merge match keys,
 * bucket layout, blob extraction). This file is the single source of truth; the Rust codec's
 * registry (core/rust/src/vault_model/generated.rs) is generated from it by
 * core/models/scripts/generate-vault-table-registry.cjs.
 */
/**
 * The scope column every stamped table carries: the id of the manifest that owns the row.
 */
declare const VAULT_MANIFEST_ID_COLUMN = "ManifestId";
/**
 * Metadata for one syncable client vault table.
 */
type VaultTableDefinition = {
    /** Table name in the client SQLite database. */
    Name: string;
    /** True when the table's rows are namespaced per manifest. */
    ManifestScoped: boolean;
    /**
     * The columns that name a row within its manifest, excluding ManifestId. Defaults to ['Id'];
     * tables keyed differently (Settings by Key, ItemTags by its natural key) override this.
     */
    PrimaryKey: string[];
    /** True when the table's rows hang off an Item row (re-stamped with their item, cascaded on delete). */
    ItemChild: boolean;
    /**
     * Match columns for the legacy statement merge. When absent, matching falls back to
     * (ManifestId, PrimaryKey).
     */
    LegacyMergeKey?: string[];
    /**
     * Match columns for the canonical merge only, where both sides are first normalized to the
     * manifest shape (see the Rust vault_codec::normalize module). Absent means the canonical merge
     * uses the same rule as the statement merge.
     */
    CanonicalMergeKey?: string[];
    /**
     * The data-bucket category the table syncs in, when it is split out of the manifest into a
     * bucket with its own server revision. Mirrors the server VaultDataBucketCategory.
     */
    BucketCategory?: string;
    /**
     * The column whose contents are extracted into content-addressed blobs rather than kept inline
     * in the manifest. Kind is the label reported to the server on upload (metrics / retention).
     */
    BlobColumn?: {
        Column: string;
        Kind: string;
    };
    /**
     * Rows in other tables that reference this table's rows from inside manifest content. On a
     * manifest split the referenced rows are reference-copied into the destination manifest so each
     * manifest stays self-contained.
     */
    ReferencedBy?: {
        Table: string;
        Column: string;
    }[];
};
/**
 * All syncable client vault tables, in registry order. Order is load-bearing: a merge inserts rows
 * in this order, so child tables must be listed after the table they reference (Items first).
 */
declare const VAULT_TABLES: VaultTableDefinition[];
/**
 * The column names the shared (Rust) vault logic references by name, emitted as named constants so
 * every module spells them identically. The full column set of each table is deliberately not
 * modeled here: it lives in the SQL schema and is passed to the codec at runtime.
 */
declare const VAULT_COLUMN_NAMES: string[];
/**
 * Data-bucket categories in declaration order. This order, not the table order, decides the order
 * buckets are emitted in; every category must be used by at least one VAULT_TABLES entry.
 */
declare const VAULT_BUCKET_CATEGORIES: string[];
/**
 * Tables never serialized into the server-stored manifest: internal SQLite, platform, or EF
 * bookkeeping that only exists at runtime and must not become part of a persisted manifest.
 */
declare const VAULT_SKIP_TABLES: string[];
/**
 * Tables that belong exclusively to the user's own (personal) vault, never to a shared manifest.
 * Empty today; kept as the declaration point for a future personal-only table.
 */
declare const VAULT_PERSONAL_TABLES: string[];
/**
 * System field keys whose field holds multiple values, derived from SystemFieldRegistry
 * (IsMultiValue). A value of such a field owns its row id: two devices each adding a value are
 * adding two different things, so their ids are never derived.
 */
declare const MULTI_VALUE_FIELD_KEYS: string[];
/**
 * The per-manifest delivery-keypair table. Every manifest carries its own asymmetric keypair(s),
 * stamped with that manifest's id.
 */
declare const ENCRYPTION_KEYS_TABLE = "EncryptionKeys";
/**
 * Local bookkeeping table the codec materializes into the vault DB: one row per manifest this
 * vault is materialized from (Id, Name).
 */
declare const MANIFESTS_TABLE = "Manifests";
/**
 * Client-local SQLite table that carries the codec overflow inside the vault database itself:
 * unknown row columns and tables preserved for forward compatibility.
 */
declare const CODEC_OVERFLOW_TABLE = "CodecOverflows";
/**
 * Fixed sentinel primary key of the single CodecOverflows row (deterministic on purpose:
 * materialize output must not depend on a random source).
 */
declare const CODEC_OVERFLOW_ROW_ID = "00000000-0000-0000-0000-00000000c0de";
/**
 * All-zero GUID used for default values which indicate unstamped rows (a ManifestId naming no
 * manifest).
 */
declare const UNSTAMPED_SCOPE_SENTINEL = "00000000-0000-0000-0000-000000000000";
/**
 * Default trash retention in days: how long a trashed item survives before the pruner deletes it.
 */
declare const TRASH_RETENTION_DEFAULT_DAYS = 30;

export { type Alias, type Attachment, CODEC_OVERFLOW_ROW_ID, CODEC_OVERFLOW_TABLE, type CreateCustomFieldOptions, type CreateSystemFieldOptions, type Credential, type DicewareCapitalization, type DicewareSalt, type DicewareSeparator, ENCRYPTION_KEYS_TABLE, type EncryptionKey, FieldCategories, type FieldCategory, type FieldHistory, FieldKey, type FieldKeyValue, type FieldType, FieldTypes, type Item, type ItemField, type ItemLogo, type ItemTag, type ItemTagRef, type ItemType, type ItemTypeFieldConfig, ItemTypes, type LogoKind, LogoKinds, type LogoSelection, MANIFESTS_TABLE, MAX_FIELD_HISTORY_RECORDS, MULTI_VALUE_FIELD_KEYS, type Passkey, type PasswordGeneratorType, type PasswordSettings, type SystemFieldDefinition, SystemFieldRegistry, TOTP_DEFAULT_ALGORITHM, TOTP_DEFAULT_DIGITS, TOTP_DEFAULT_PERIOD, TOTP_SUPPORTED_ALGORITHMS, TRASH_RETENTION_DEFAULT_DAYS, type Tag, type TotpCode, UNSTAMPED_SCOPE_SENTINEL, VAULT_BUCKET_CATEGORIES, VAULT_COLUMN_NAMES, VAULT_MANIFEST_ID_COLUMN, VAULT_PERSONAL_TABLES, VAULT_SKIP_TABLES, VAULT_TABLES, VaultDataBucketCategory, VaultDataBucketCategoryDescriptions, type VaultDataBucketCategoryValue, type VaultTableDefinition, createCustomField, createSystemField, fieldAppliesToType, getAllSystemFieldKeys, getDefaultFieldsForItemType, getFieldConfigForType, getFieldValue, getFieldValues, getOptionalFieldsForItemType, getSystemField, getSystemFieldsForItemType, groupFields, groupFieldsByCategory, hasField, isFieldShownByDefault, isSystemField, isSystemFieldPrefix, itemToCredential, normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod };
