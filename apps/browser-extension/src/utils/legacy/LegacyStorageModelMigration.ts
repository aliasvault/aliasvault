/**
 * Legacy storage model migration specific logic.
 * 
 * TODO: these methods and file can be deleted later once all users have migrated from sqlite-blob to manifest-v1.
 */

import { storage } from 'wxt/utils/storage';

import { StorageKeys } from '@/utils/constants/storageKeys';
import { devLog } from '@/utils/devLogger/DevLogger';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { replaceManifestRevisions } from '@/utils/ManifestRevisions';
import { ServerUpdateRequiredError } from '@/utils/types/errors/ServerUpdateRequiredError';
import { VaultKeyService } from '@/utils/VaultKeyService';

/*
 * -- 1. Servers predating the v2 vault API --
 */

/**
 * True when an error from WebApiService is an HTTP 404. WebApiService surfaces non-2xx responses as a generic
 * Error whose message carries the status code (`HTTP error! status: 404`).
 * @param e - the caught error
 */
function isNotFoundError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('status: 404');
}

/**
 * Run a v2 API call, translating the outdated-server 404 into {@link ServerUpdateRequiredError}. Such a server
 * answers every v2 endpoint with a 404, which is indistinguishable from a routing error unless we translate it,
 * so the UI can surface "update your server" (E-903) instead. Every other failure propagates unchanged.
 * @param fn - the call to run
 */
export async function withOutdatedServerGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isNotFoundError(e)) {
      throw new ServerUpdateRequiredError();
    }
    throw e;
  }
}

/*
 * -- 2. The sqlite-blob storage model --
 */

/** Numeric value of the server StorageFormat enum for the manifest-v1 format (SqliteBlob = 0, Manifest = 1). */
const STORAGE_FORMAT_MANIFEST = 1;

/**
 * The GET /v2/Vault fields that only a legacy sqlite-blob response carries. Structurally satisfied by the full
 * snapshot type, so callers pass the snapshot itself.
 */
export type LegacySqliteBlobSnapshot = {
  /** The server's storage format (0 = sqlite-blob, 1 = manifest-v1). Absent on servers predating the field. */
  storageFormat?: number;
  /** The legacy encrypted SQLite blob. */
  legacyVaultBlob?: string | null;
  /** The legacy sqlite-blob revision. */
  legacyRevision?: number | null;
  /** Data-model version string of the legacy blob. */
  version?: string | null;
  /** The manifest id the server has already reserved for this user's personal manifest. */
  personalManifestId?: string | null;
};

/** The already-encrypted blob to store locally, plus the metadata a VaultResponse needs alongside it. */
export type LegacySqliteBlobPassthrough = {
  encryptedBlob: string;
  version: string;
  revision: number;
};

/**
 * Whether the server answered with anything other than manifest-v1, which means the legacy sqlite-blob format
 * (including a server too old to report the field at all).
 * @param snapshot - the raw GET /v2/Vault response
 */
export function isLegacySqliteBlobSnapshot(snapshot: LegacySqliteBlobSnapshot): boolean {
  return snapshot.storageFormat !== STORAGE_FORMAT_MANIFEST;
}

/**
 * Take a legacy snapshot apart for local storage. The blob is already in the stored format (encrypted SQLite),
 * so it passes through untouched and the on-open schema upgrade handles the rest; this only resets the local
 * state that manifest-v1 owns and records the manifest id the migration push will stamp rows with.
 * @param snapshot - the raw GET /v2/Vault response
 */
export async function openLegacySqliteBlobSnapshot(snapshot: LegacySqliteBlobSnapshot): Promise<LegacySqliteBlobPassthrough> {
  // There is no manifest-v1 server state behind this snapshot, so any content fingerprint we hold is stale.
  await storage.removeItem(StorageKeys.VAULT_CONTENT_FINGERPRINTS);

  const revision = typeof snapshot.legacyRevision === 'number' ? snapshot.legacyRevision : 0;

  /*
   * The vault has never been materialized, so it carries no record of which manifest is ours. Persist the
   * server's id for it so the first migration canonicalize can stamp rows with it, and seed the revision map
   * with it: a legacy vault is one logical manifest, and every pull path (this one included) must leave the
   * per-manifest baselines matching what it fetched.
   */
  if (snapshot.personalManifestId) {
    await storage.setItem(StorageKeys.VAULT_PERSONAL_MANIFEST_ID, snapshot.personalManifestId);
    await replaceManifestRevisions({ [snapshot.personalManifestId]: revision });
  }

  devLog('[V2Pull] Legacy sqlite-blob pass-through (user not yet migrated), returning the blob as-is.');

  return {
    encryptedBlob: snapshot.legacyVaultBlob ?? '',
    version: snapshot.version ?? '',
    revision,
  };
}

/**
 * Canonicalize options that adopt rows carrying no ManifestId into the personal manifest. Only the one-time
 * migration of a legacy sqlite-blob vault may pass these: every other canonicalize must reject unstamped rows
 * rather than silently claim them (see `claim_manifest_scope` in the Rust codec).
 * @param personalManifestId - the manifest unstamped rows are adopted into
 */
export function legacyUnstampedRowAdoption(personalManifestId: string): { adoptUnstampedInto: string } {
  return { adoptUnstampedInto: personalManifestId };
}

/*
 * -- 3. The missing KEK/VEK account key hierarchy --
 */

/**
 * The freshly minted key hierarchy for one migration push. Held across the push so
 * {@link completeLegacyAccountKeyMigration} can cache exactly what the server committed.
 */
export type LegacyAccountKeyMigration = {
  /** The new VEK: everything this push writes is encrypted with it, and the caller adopts it as the session key. */
  contentKey: string;
  /** The new VEK encrypted with the Account Key; sent on the personal-manifest write so the server stores it. */
  encryptedVek: string;
  /** The rest of the hierarchy, sent as-is in the write payload. */
  accountKeys: {
    /** The Account Key encrypted with the password-derived KEK. */
    encryptedAccountKey: string;
    /** Public half of the new account keypair, used by others to grant this user access to a shared manifest. */
    accountPublicKey: string;
    /** Private half of the new account keypair, encrypted with the Account Key. */
    encryptedAccountPrivateKey: string;
  };
  /** Plaintext private half of the new account keypair, staged into the session once the push commits. */
  accountPrivateKey: string;
};

/**
 * Whether this vault still has to run the migration, answered entirely from local state: no cached vault key
 * means no hierarchy exists yet.
 */
export async function requiresLegacyAccountKeyMigration(): Promise<boolean> {
  return !await VaultKeyService.hasLocalVaultKey();
}

/**
 * Mint the full account key hierarchy for a migration push: a random Account Key (AK) encrypted with the
 * password-derived key, which from then on is only the KEK; a fresh VEK encrypted with the AK; and the account
 * keypair whose private half is encrypted with the AK too.
 * @param kek - the password-derived key this vault is currently encrypted with, which becomes the KEK
 */
export async function prepareLegacyAccountKeyMigration(kek: string): Promise<LegacyAccountKeyMigration> {
  const contentKey = EncryptionUtility.generateVaultEncryptionKey();
  const accountKey = EncryptionUtility.generateVaultEncryptionKey();
  const accountKeyPair = await EncryptionUtility.generateRsaKeyPair();

  return {
    contentKey,
    encryptedVek: await EncryptionUtility.encryptVaultEncryptionKey(contentKey, accountKey),
    accountKeys: {
      encryptedAccountKey: await EncryptionUtility.encryptVaultEncryptionKey(accountKey, kek),
      accountPublicKey: accountKeyPair.publicKey,
      encryptedAccountPrivateKey: await EncryptionUtility.symmetricEncrypt(accountKeyPair.privateKey, accountKey),
    },
    accountPrivateKey: accountKeyPair.privateKey,
  };
}

/**
 * Adopt the hierarchy the migration push just committed: cache the whole encrypted blob chain for offline unlock
 * and stage the account private key into the session.
 * @param migration - the hierarchy that was pushed
 */
export async function completeLegacyAccountKeyMigration(migration: LegacyAccountKeyMigration): Promise<void> {
  await VaultKeyService.adoptLocalAccountKeys({
    encryptedAccountKey: migration.accountKeys.encryptedAccountKey,
    encryptedVek: migration.encryptedVek,
    accountPublicKey: migration.accountKeys.accountPublicKey,
    encryptedAccountPrivateKey: migration.accountKeys.encryptedAccountPrivateKey,
    accountPrivateKey: migration.accountPrivateKey,
  });
}
