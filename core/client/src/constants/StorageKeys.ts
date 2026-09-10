/**
 * Storage keys the client core reads and writes through the host's {@link IKeyValueStore}. Host apps extend this
 * set with their own keys; the names here are shared so that every platform stores the same state under the same key.
 */

import { ALL_VAULT_MUTATION_SCOPES, type VaultMutationScope } from '../sync/VaultMutationScope';

import type { StorageKey } from '../platform/KeyValueStore';

export type { StorageKey } from '../platform/KeyValueStore';

export const StorageKeys = {
  /*
   * -- Auth and server connection --
   */

  /** JWT access token for the API. */
  ACCESS_TOKEN: 'local:accessToken',
  /** JWT refresh token for the API. */
  REFRESH_TOKEN: 'local:refreshToken',
  /** Username of the logged in user. */
  USERNAME: 'local:username',
  /** Base URL of the API the client talks to. */
  API_URL: 'local:apiUrl',
  /** Base URL of the web client, used for deep links. */
  CLIENT_URL: 'local:clientUrl',
  /** Version reported by the server on the last status call. */
  SERVER_VERSION: 'local:serverVersion',
  /** The capabilities that are enabled for this account passed from the server. */
  CAPABILITIES: 'local:capabilities',

  /*
   * -- Vault data (local cache) --
   */

  /** The encrypted vault blob. */
  ENCRYPTED_VAULT: 'local:encryptedVault',
  /** Public email domains supported by the server. */
  PUBLIC_EMAIL_DOMAINS: 'local:publicEmailDomains',
  /** Private email domains supported by the server. */
  PRIVATE_EMAIL_DOMAINS: 'local:privateEmailDomains',
  /** Private email domains that are hidden from the domain picker. */
  HIDDEN_PRIVATE_EMAIL_DOMAINS: 'local:hiddenPrivateEmailDomains',
  /** Argon2 parameters used to derive the KEK from the master password. */
  ENCRYPTION_KEY_DERIVATION_PARAMS: 'local:encryptionKeyDerivationParams',
  /** The VEK encrypted with the Account Key, as returned by the server. */
  ENCRYPTED_VEK: 'local:encryptedVek',
  /** The Account Key encrypted with the password-derived KEK, as returned by the server. */
  ENCRYPTED_ACCOUNT_KEY: 'local:encryptedAccountKey',
  /** The account public key, used for encrypting shared-manifest VEK grants. */
  ACCOUNT_PUBLIC_KEY: 'local:accountPublicKey',
  /** The account private key encrypted with the Account Key. */
  ENCRYPTED_ACCOUNT_PRIVATE_KEY: 'local:encryptedAccountPrivateKey',

  /*
   * -- Sync state --
   */

  /** True when the local vault has changes that are not pushed to the server yet. */
  IS_DIRTY: 'local:isDirty',
  /** Monotonic counter used to detect mutations that happened during an in-flight sync. */
  MUTATION_SEQUENCE: 'local:mutationSequence',
  /** True when the client operates against the local vault only. */
  IS_OFFLINE_MODE: 'local:isOfflineMode',
  /** Message of the last failed sync attempt, shown in the UI. */
  LAST_SYNC_ERROR: 'local:lastSyncError',
  /** The client's last known server revision per manifest. */
  SERVER_MANIFEST_REVISIONS: 'local:serverManifestRevisions',
  /** The client's last known revision per data bucket. */
  VAULT_BUCKET_REVISIONS: 'local:vaultBucketRevisions',
  /** The personal manifest's blob-hashing salt, cached from the last pull; see `CodecManifest.manifestSalt`. */
  VAULT_MANIFEST_SALT: 'local:vaultManifestSalt',

  /**
   * The server-side id of the user's personal manifest, learned from GET /v2/Vault. Fallback source for
   * canonicalize when the vault DB does not record it yet (legacy migration push).
   */
  VAULT_PERSONAL_MANIFEST_ID: 'local:vaultPersonalManifestId',

  /** Content fingerprints of the last pushed manifests and buckets, used for changed-only writes. */
  VAULT_CONTENT_FINGERPRINTS: 'local:vaultContentFingerprints',
  /** Local cache of encrypted blobs (hash to base64 AES-GCM ciphertext). Never stores plaintext at rest. */
  VAULT_BLOB_CIPHER_CACHE: 'local:vaultBlobCipherCache',
  /** Blob hashes the server has stored (refreshed on every pull/push). */
  VAULT_SERVER_BLOB_HASHES: 'local:vaultServerBlobHashes',
  /** Shared-manifest key records (wrapped VEK grants). */
  SHARED_MANIFESTS: 'local:sharedManifests',

  /*
   * -- Session state (cleared when the vault locks) --
   */

  /** The decrypted vault encryption key. Session-only: it must never persist to disk. */
  ENCRYPTION_KEY: 'session:encryptionKey',
  /** The decrypted account private key (JWK). Session-only: it must never persist to disk. */
  ACCOUNT_PRIVATE_KEY: 'session:accountPrivateKey',
  /** The sync hold record (reason + when it was taken) while an operation no sync may race runs; see VaultSyncHold. */
  VAULT_SYNC_HOLD: 'session:vaultSyncHold',
} as const satisfies Record<string, StorageKey>;

/**
 * Storage key holding the dirty flag for a single mutation scope.
 * @param scope - the mutation scope
 */
export const dirtyScopeStorageKey = (scope: VaultMutationScope): `local:${string}` => `local:dirtyScope:${scope}`;

/**
 * Record key of one data bucket's revision inside {@link StorageKeys.VAULT_BUCKET_REVISIONS}, addressed by the manifest that owns it and the category.
 * @param manifestId - the id of the manifest that owns the bucket
 * @param category - the data bucket category
 */
export const bucketRevisionKey = (manifestId: string, category: string): string => `${manifestId}:${category}`;

/** Keys that hold auth tokens, ephemeral error state and account-scoped server state. Cleared on any logout. */
export const AUTH_STORAGE_KEYS: readonly StorageKey[] = [
  StorageKeys.ACCESS_TOKEN,
  StorageKeys.REFRESH_TOKEN,
  StorageKeys.LAST_SYNC_ERROR,
  StorageKeys.CAPABILITIES,
];

/** Keys that must not survive a vault lock: the decrypted keys. Hosts add anything they derive from decrypted data. */
export const VAULT_LOCK_STORAGE_KEYS: readonly StorageKey[] = [
  StorageKeys.ENCRYPTION_KEY,
  StorageKeys.ACCOUNT_PRIVATE_KEY,
];

/**
 * Every key holding vault data or state derived from it, including the per-scope dirty flags. Cleared on ANY logout,
 * forced or user-initiated. Hosts append their own vault-derived keys.
 */
export const vaultDataStorageKeys = (): StorageKey[] => [
  StorageKeys.ENCRYPTED_VAULT,
  StorageKeys.PUBLIC_EMAIL_DOMAINS,
  StorageKeys.PRIVATE_EMAIL_DOMAINS,
  StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS,
  StorageKeys.SERVER_MANIFEST_REVISIONS,
  StorageKeys.VAULT_BUCKET_REVISIONS,
  StorageKeys.VAULT_MANIFEST_SALT,
  StorageKeys.VAULT_PERSONAL_MANIFEST_ID,
  StorageKeys.SHARED_MANIFESTS,
  StorageKeys.VAULT_CONTENT_FINGERPRINTS,
  StorageKeys.VAULT_BLOB_CIPHER_CACHE,
  StorageKeys.VAULT_SERVER_BLOB_HASHES,
  StorageKeys.IS_DIRTY,
  StorageKeys.MUTATION_SEQUENCE,
  StorageKeys.IS_OFFLINE_MODE,
  StorageKeys.ENCRYPTION_KEY_DERIVATION_PARAMS,
  StorageKeys.ENCRYPTED_VEK,
  StorageKeys.ENCRYPTED_ACCOUNT_KEY,
  StorageKeys.ACCOUNT_PUBLIC_KEY,
  StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY,
  ...ALL_VAULT_MUTATION_SCOPES.map(scope => dirtyScopeStorageKey(scope)),
];
