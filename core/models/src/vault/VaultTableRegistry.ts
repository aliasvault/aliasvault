import { SystemFieldRegistry } from './SystemFieldRegistry';

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
export const VAULT_MANIFEST_ID_COLUMN = 'ManifestId';

/**
 * Metadata for one syncable client vault table.
 */
export type VaultTableDefinition = {
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
  BlobColumn?: { Column: string; Kind: string };
  /**
   * Rows in other tables that reference this table's rows from inside manifest content. On a
   * manifest split the referenced rows are reference-copied into the destination manifest so each
   * manifest stays self-contained.
   */
  ReferencedBy?: { Table: string; Column: string }[];
};

/**
 * All syncable client vault tables, in registry order. Order is load-bearing: a merge inserts rows
 * in this order, so child tables must be listed after the table they reference (Items first).
 */
export const VAULT_TABLES: VaultTableDefinition[] = [
  { Name: 'Items', ManifestScoped: true, PrimaryKey: ['Id'], ItemChild: false },
  /*
   * ItemStats is keyed by the item it describes: Id IS the item's id, so recording a use is an
   * upsert and two devices never mint competing rows. Listed after Items so a merge inserts the
   * item first.
   */
  { Name: 'ItemStats', ManifestScoped: true, PrimaryKey: ['Id'], ItemChild: true, BucketCategory: 'Stats' },
  /*
   * FieldValues legacy statement merge: a field value matches on the field it belongs to (FieldKey
   * for system fields, FieldDefinitionId for custom ones; exactly one is set), so independently
   * minted rows of the same field converge. Canonical merge: both sides are normalized first,
   * which strips the derived id of every single-value row, so adding Id to the key makes a
   * single-value row match by its field (id part empty on both sides) while a multi-value row
   * matches by its OWNED id: two devices each adding a login.url are two different rows that must
   * both survive, and the id, unlike ValueIndex, is stable under reordering.
   */
  {
    Name: 'FieldValues',
    ManifestScoped: true,
    PrimaryKey: ['Id'],
    ItemChild: true,
    LegacyMergeKey: ['ManifestId', 'ItemId', 'FieldKey', 'FieldDefinitionId'],
    CanonicalMergeKey: ['ManifestId', 'ItemId', 'FieldKey', 'FieldDefinitionId', 'Id'],
  },
  { Name: 'Folders', ManifestScoped: true, PrimaryKey: ['Id'], ItemChild: false },
  {
    Name: 'Tags',
    ManifestScoped: true,
    PrimaryKey: ['Id'],
    ItemChild: false,
    ReferencedBy: [{ Table: 'ItemTags', Column: 'TagId' }],
  },
  /*
   * ItemTags is a pure join table keyed by its natural key; it carries no surrogate id so two devices tagging the same item converge on one row.
   */
  { Name: 'ItemTags', ManifestScoped: true, PrimaryKey: ['ItemId', 'TagId'], ItemChild: true },
  {
    Name: 'Attachments',
    ManifestScoped: true,
    PrimaryKey: ['Id'],
    ItemChild: true,
    BlobColumn: { Column: 'Blob', Kind: 'attachment' },
  },
  { Name: 'TotpCodes', ManifestScoped: true, PrimaryKey: ['Id'], ItemChild: true },
  { Name: 'Passkeys', ManifestScoped: true, PrimaryKey: ['Id'], ItemChild: true },
  {
    Name: 'FieldDefinitions',
    ManifestScoped: true,
    PrimaryKey: ['Id'],
    ItemChild: false,
    ReferencedBy: [{ Table: 'FieldValues', Column: 'FieldDefinitionId' }, { Table: 'FieldHistories', Column: 'FieldDefinitionId' }],
  },
  /*
   * FieldHistories canonical merge: every history row derives its id from (item, field, ChangedAt),
   * so after normalization the natural key IS the identity: concurrent changes union (distinct
   * ChangedAt), same-millisecond snapshots converge. Legacy statement merge keeps plain
   * (ManifestId, Id).
   */
  {
    Name: 'FieldHistories',
    ManifestScoped: true,
    PrimaryKey: ['Id'],
    ItemChild: true,
    CanonicalMergeKey: ['ManifestId', 'ItemId', 'FieldKey', 'FieldDefinitionId', 'ChangedAt'],
  },
  {
    Name: 'Logos',
    ManifestScoped: true,
    PrimaryKey: ['Id'],
    ItemChild: false,
    BlobColumn: { Column: 'FileData', Kind: 'favicon' },
  },
  { Name: 'EncryptionKeys', ManifestScoped: true, PrimaryKey: ['Id'], ItemChild: false },
  {
    Name: 'Settings',
    ManifestScoped: true,
    PrimaryKey: ['Key'],
    ItemChild: false,
    BucketCategory: 'Settings',
  },
];

/**
 * The column names the shared (Rust) vault logic references by name, emitted as named constants so
 * every module spells them identically. The full column set of each table is deliberately not
 * modeled here: it lives in the SQL schema and is passed to the codec at runtime.
 */
export const VAULT_COLUMN_NAMES: string[] = [
  'Id',
  'ItemId',
  'TagId',
  'FieldKey',
  'FieldDefinitionId',
  'ValueIndex',
  'ChangedAt',
  'IsMultiValue',
  'ParentFolderId',
  'FolderId',
  'LogoId',
  'Kind',
  'Source',
  'FileData',
  'Blob',
  'UpdatedAt',
  'DeletedAt',
  'PublicKey',
  'IsPrimary',
  'IsDeleted',
];

/**
 * Data-bucket categories in declaration order. This order, not the table order, decides the order
 * buckets are emitted in; every category must be used by at least one VAULT_TABLES entry.
 */
export const VAULT_BUCKET_CATEGORIES: string[] = ['Settings', 'Stats'];

/**
 * Tables never serialized into the server-stored manifest: internal SQLite, platform, or EF
 * bookkeeping that only exists at runtime and must not become part of a persisted manifest.
 */
export const VAULT_SKIP_TABLES: string[] = [
  '__EFMigrationsHistory',
  '__EFMigrationsLock',
  'sqlite_sequence',
  'android_metadata',
  'Manifests',
];

/**
 * Tables that belong exclusively to the user's own (personal) vault, never to a shared manifest.
 * Empty today; kept as the declaration point for a future personal-only table.
 */
export const VAULT_PERSONAL_TABLES: string[] = [];

/**
 * System field keys whose field holds multiple values, derived from SystemFieldRegistry
 * (IsMultiValue). A value of such a field owns its row id: two devices each adding a value are
 * adding two different things, so their ids are never derived.
 */
export const MULTI_VALUE_FIELD_KEYS: string[] = Object.values(SystemFieldRegistry)
  .filter((field) => field.IsMultiValue)
  .map((field) => field.FieldKey.toLowerCase());

/**
 * The per-manifest delivery-keypair table. Every manifest carries its own asymmetric keypair(s),
 * stamped with that manifest's id.
 */
export const ENCRYPTION_KEYS_TABLE = 'EncryptionKeys';

/**
 * Local bookkeeping table the codec materializes into the vault DB: one row per manifest this
 * vault is materialized from (Id, Name).
 */
export const MANIFESTS_TABLE = 'Manifests';

/**
 * Client-local SQLite table that carries the codec overflow inside the vault database itself:
 * unknown row columns and tables preserved for forward compatibility.
 */
export const CODEC_OVERFLOW_TABLE = 'CodecOverflows';

/**
 * Fixed sentinel primary key of the single CodecOverflows row (deterministic on purpose:
 * materialize output must not depend on a random source).
 */
export const CODEC_OVERFLOW_ROW_ID = '00000000-0000-0000-0000-00000000c0de';

/**
 * All-zero GUID used for default values which indicate unstamped rows (a ManifestId naming no
 * manifest).
 */
export const UNSTAMPED_SCOPE_SENTINEL = '00000000-0000-0000-0000-000000000000';

/**
 * Default trash retention in days: how long a trashed item survives before the pruner deletes it.
 */
export const TRASH_RETENTION_DEFAULT_DAYS = 30;
