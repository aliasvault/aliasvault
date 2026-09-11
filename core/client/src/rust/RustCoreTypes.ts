/**
 * Types shared by the Rust core binding and the typed wrappers in RustCore.ts.
 */

export enum AutofillMatchingMode {
  DEFAULT = 'default',
  URL_EXACT = 'url_exact',
  URL_SUBDOMAIN = 'url_subdomain'
}

/**
 * The URL a favicon is fetched from, paired with the `Logos.Source` key it is stored under.
 */
export type FaviconTarget = {
  url: string;
  source: string;
};

/**
 * Request for identity generation. All fields except `language` are optional.
 */
export type IdentityRequest = {
  /** Dictionary language code (e.g. 'en'); unknown codes fall back to English. */
  language: string;
  /** Gender preference: 'male', 'female' or 'random' (default). */
  gender?: string;
  /** Age range preference as stored in settings (e.g. '21-25' or 'random'). */
  ageRange?: string;
};

/**
 * Name and birth date input for identity-based username/email prefix generation.
 */
export type IdentityNameInput = {
  firstName: string;
  lastName: string;
  /** Birth date; only the leading yyyy year part is used. */
  birthDate: string;
};

/**
 * A single attachment of a parsed email message. Metadata only: fetch the bytes with
 * `extractEmailAttachment` using this attachment's index in {@link ParsedEmail.attachments}.
 */
export type ParsedEmailAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  detached: boolean;
  partIndex: number | null;
};

/** Result of parsing a raw RFC 822 email source. Body fields are null when the message has no such part. */
export type ParsedEmail = {
  htmlBody: string | null;
  textBody: string | null;
  attachments: ParsedEmailAttachment[];
};

/** Credential filter input for autofill matching, as the Rust matcher expects it. */
export type FilterCredentialsInput = {
  credentials: Array<{ Id: string; ItemName: string; ItemUrls: string[] }>;
  current_url: string;
  page_title: string;
  matching_mode: AutofillMatchingMode;
};

/** Credential filter output: the matched item ids. */
export type FilterCredentialsOutput = { matched_ids: string[] };

/** SRP ephemeral key pair (uppercase hex). */
export type SrpEphemeral = {
  public: string;
  secret: string;
};

/** SRP client session: proof (M1) and shared key (K), uppercase hex. */
export type SrpSession = {
  proof: string;
  key: string;
};

/** One table's rows as the trash pruner reads them. */
export type RustTableData = { name: string; records: Array<Record<string, unknown>> };

/** One SQL statement the pruner emits, with `{ __b64 }` byte params. */
export type RustSqlStatement = { sql: string; params: Array<string | number | null | { __b64: string }> };

/** Input of the trash pruner. */
export type PruneVaultInput = { tables: RustTableData[]; retention_days: number; current_time: string };

/** Output of the trash pruner. */
export type PruneVaultOutput = { success: boolean; statements: RustSqlStatement[] };

/** One per-table SELECT the pruner reads its input with. */
export type PruneTableQuery = { name: string; query: string };

/*
 * Vault codec (manifest-v1 storage format).
 */

/** A single table's rows (byte columns rendered as `{ __b64 }`). */
export type CodecTableData = { name: string; records: Array<Record<string, unknown>> };

/**
 * Manifest-v1 manifest.
 */
export type CodecManifest = {
  schemaVersion: number;
  manifestSalt: string;
  canonicalizedAt: string;
  manifestId: string;
  name?: string | null;
  tables: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
};

/**
 * One manifest canonicalize should emit.
 */
export type CodecManifestSpec = {
  manifestId: string;
  manifestSalt: string;
  name?: string | null;
};

/**
 * A manifest-v1 data bucket, addressed by the manifest that owns it and its category.
 */
export type CodecDataBucket = {
  schemaVersion: number;
  manifestId: string;
  category: string;
  tables: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
};

/** A decoded blob entry: kind + plaintext bytes (base64). */
export type CodecBlobEntry = { kind: string; bytesBase64: string };

/** One manifest produced by canonicalize: the manifest and the blobs hashed with its own salt. */
export type CodecCanonicalizedManifest = { manifest: CodecManifest; blobs: Record<string, CodecBlobEntry> };

/**
 * Result of canonicalize: one entry per spec, in spec order, plus the vault's data buckets.
 */
export type CodecCanonicalized = {
  manifests: CodecCanonicalizedManifest[];
  dataBuckets: CodecDataBucket[];
};

/**
 * Data a newer writer put in the manifest that this client's local SQLite schema cannot hold.
 */
export type CodecOverflow = {
  tables: Record<string, Array<Record<string, unknown>>>;
  bucketTables: Record<string, Record<string, Array<Record<string, unknown>>>>;
  columns: Record<string, Record<string, Record<string, unknown>>>;
};

/** Input for canonicalize. */
export type CodecCanonicalizeInput = {
  tables: CodecTableData[];
  canonicalizedAt: string;
  manifests: CodecManifestSpec[];
  /** For legacy sqlite-blob migration: the manifest that unstamped rows are adopted into. TODO: delete this field once the migration is complete. */
  adoptUnstampedInto?: string | null;
};

/** Input for materialize. */
export type CodecMaterializeInput = {
  manifests: CodecManifest[];
  dataBuckets: CodecDataBucket[];
  schemaColumns: Record<string, string[]>;
};

/** Materialized tables the platform inserts into a fresh SQLite DB (`overflow` is a diagnostics copy). */
export type CodecMaterialized = { tables: CodecTableData[]; overflow: CodecOverflow };

/** Input for the bucket-only extraction. */
export type CodecExtractBucketsInput = { category: string; manifestIds: string[]; tables: Record<string, Array<Record<string, unknown>>> };

/** One entry in the bucket layout: a category and the tables it owns. */
export type CodecBucketLayoutEntry = { category: string; tables: string[] };

/** Structural validation outcome. */
export type CodecValidation = { ok: boolean; failedRules: string[]; message: string };

/** Input of the canonical merge: server side is the base, local side the incoming changes. */
export type CodecCanonicalMergeInput = {
  serverManifests: CodecManifest[];
  serverBuckets: CodecDataBucket[];
  contentlessServerManifestIds: string[];
  localManifests: CodecManifest[];
  localBuckets: CodecDataBucket[];
  schemaColumns: Record<string, string[]>;
};

/** One manifest's merged result: the server manifest with merged tables, plus its merged buckets. */
export type CodecCanonicalManifestMerge = {
  manifestId: string;
  manifest: CodecManifest;
  buckets: CodecDataBucket[];
  stats: { tablesProcessed: number; recordsFromLocal: number; recordsFromServer: number; recordsCreatedLocally: number; conflicts: number; recordsInserted: number };
};

/** Output of the canonical merge. */
export type CodecCanonicalMergeOutput = {
  manifests: CodecCanonicalManifestMerge[];
  droppedLocalManifestIds: string[];
};

/** A shared manifest's key record. */
export type SharingManifestRecord = {
  manifestId: string;
  salt: string;
  name?: string | null;
  canAdminister?: boolean;
};

/** One manifest the next push writes. */
export type SharingWriteRecord = {
  manifestId: string;
  isPersonal: boolean;
  salt: string;
  name: string | null;
  canAdminister: boolean;
};

/** The manifests a push writes, personal first, plus what was left out and why. */
export type SharingWriteSet = {
  records: SharingWriteRecord[];
  skipped: Array<{ manifestId: string; reason: 'NO_ROWS_IN_VAULT' | 'KEY_DID_NOT_OPEN' }>;
};

/** Input of the manifest write-set resolution. */
export type SharingResolveWriteSetInput = {
  personalManifestId: string;
  personalManifestSalt: string;
  stampedManifestIds: string[];
  openedManifestIds: string[];
  heldRecords: SharingManifestRecord[];
  displayNames: Record<string, string>;
};

/** Input of the manifest access partition. */
export type SharingPartitionAccessInput = {
  manifestIdsInVault: string[];
  writableManifestIds: string[];
  grantedManifestIds: string[];
};

/** What the vault holds but cannot write, and what it holds but has lost access to. */
export type SharingAccessPartition = { unwritable: string[]; lost: string[] };
