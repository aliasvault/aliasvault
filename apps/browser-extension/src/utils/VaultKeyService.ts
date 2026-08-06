/**
 * VaultKeyService with client-side helpers for key operations.
 */

import { storage } from 'wxt/utils/storage';

import { StorageKeys } from '@/utils/constants/storageKeys';
import type { VaultKeyGetResponse, VaultKeyResponse } from '@/utils/dist/core/models/webapi';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { ApiRequestError } from '@/utils/types/errors/ApiRequestError';
import { AppErrorCode, formatErrorWithCode } from '@/utils/types/errors/AppErrorCodes';
import { WebApiService } from '@/utils/WebApiService';

/** The key type for password-based vault keys, mirroring the server's VaultKey.KeyType value. */
export const VAULT_KEY_TYPE_PASSWORD = 'password';

/**
 * Short-lived cache of the last successful password vault key response, to avoid unnecessary repeated
 * network requests.
 */
const VAULT_KEY_CACHE_TTL_MS = 1000;

/**
 * Process-wide (background service worker) cache of the last successful password vault key response, used by
 * all callers that need to check if the user has a vault key.
 */
let cachedVaultKey: { data: FetchVaultKeyResult; timestamp: number } | null = null;

/**
 * Result of resolving the vault encryption key after deriving the password key.
 */
export type ResolvedEncryptionKey = {
  encryptionKey: string;
  encryptedVek: string | null;
};

/**
 * Result of fetching the vault key from the server.
 */
export type FetchVaultKeyResult = {
  supported: boolean;
  vaultKey: VaultKeyResponse | null;
};

/**
 * Static helper for fetching, decrypting, and caching the account-key unlock chain (KEK → AK → VEK + account keypair).
 */
export class VaultKeyService {
  /**
   * Fetch the current user's password vault key from the server. Successful responses are reused for
   * {@link VAULT_KEY_CACHE_TTL_MS} so the several callers a single sync cycle makes share one request; errors are
   * never cached, so a transient failure does not stick.
   * @param webApi - the API client to use (popup context passes its own instance; background creates one)
   */
  public static async fetchVaultKey(webApi?: WebApiService): Promise<FetchVaultKeyResult> {
    if (cachedVaultKey && Date.now() - cachedVaultKey.timestamp < VAULT_KEY_CACHE_TTL_MS) {
      return cachedVaultKey.data;
    }

    const api = webApi ?? new WebApiService();
    let result: FetchVaultKeyResult;
    try {
      const response = await api.get<VaultKeyGetResponse>(`VaultKey/${VAULT_KEY_TYPE_PASSWORD}`);
      result = { supported: true, vaultKey: response.vaultKey ?? null };
    } catch (e) {
      if (e instanceof ApiRequestError && e.statusCode === 404) {
        result = { supported: false, vaultKey: null };
      } else if (e instanceof Error && e.message.includes('status: 404')) {
        result = { supported: false, vaultKey: null };
      } else {
        throw e;
      }
    }

    cachedVaultKey = { data: result, timestamp: Date.now() };
    return result;
  }

  /**
   * Resolve the vault encryption key right after authentication: fetch the vault key from the server, decrypt
   * the Account Key with the password-derived key (KEK), and with the AK decrypt the VEK and the account
   * private key. All encrypted blobs are cached for offline unlock. For legacy users (server explicitly
   * reports no vault key) the derived key itself is the encryption key and any stale cached chain is cleared.
   */
  public static async resolveEncryptionKey(derivedKeyBase64: string, webApi?: WebApiService): Promise<ResolvedEncryptionKey> {
    const result = await VaultKeyService.fetchVaultKey(webApi);

    if (!result.supported) {
      // Older server: trust the local cache. Legacy accounts have no cached blob chain and use the derived key.
      return VaultKeyService.resolveFromLocalCache(derivedKeyBase64);
    }

    if (!result.vaultKey) {
      await storage.removeItems([StorageKeys.ENCRYPTED_VEK, StorageKeys.ENCRYPTED_ACCOUNT_KEY, StorageKeys.ACCOUNT_PUBLIC_KEY, StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY]);
      return { encryptionKey: derivedKeyBase64, encryptedVek: null };
    }

    const vek = await VaultKeyService.unwrapChainOrThrow(result.vaultKey, derivedKeyBase64);
    await VaultKeyService.cacheVaultKeyBlobs(result.vaultKey);
    return { encryptionKey: vek, encryptedVek: result.vaultKey.encryptedAccountKey };
  }

  /**
   * Resolve the vault encryption key offline: decrypt the locally cached blob chain with the derived key. For
   * legacy users (no cached chain) the derived key itself is returned.
   * @param derivedKeyBase64 - the password-derived key
   * @throws Error with {@link AppErrorCode.VAULT_DECRYPT_FAILED} when decryption fails (wrong password).
   */
  public static async resolveEncryptionKeyOffline(derivedKeyBase64: string): Promise<string> {
    return (await VaultKeyService.resolveFromLocalCache(derivedKeyBase64)).encryptionKey;
  }

  /**
   * Drop the cached vault-key response so the next resolve re-fetches it from the server.
   */
  public static clearCache(): void {
    cachedVaultKey = null;
  }

  /**
   * Whether this device holds a vault key, i.e. whether the session encryption key is a VEK rather than the raw
   * password-derived key. This is the local source of truth for "am I on the account-key model": the cache is
   * written by {@link resolveEncryptionKey} on every login and cleared when the server reports no vault key, so
   * it needs no server round-trip. A false answer is only ever stale in one direction (another device migrated
   * since the last login), which the background sync resolves by adopting the remote key before any vault work happens.
   */
  public static async hasLocalVaultKey(): Promise<boolean> {
    if ((await storage.getItem(StorageKeys.ENCRYPTED_ACCOUNT_KEY) as string | null) !== null) {
      return true;
    }
    // Pre-encrypted VEK cache shape (encrypted VEK only), left behind by an older build of this extension.
    return (await storage.getItem(StorageKeys.ENCRYPTED_VEK) as string | null) !== null;
  }

  /**
   * Refresh the local blob-chain cache from the server without needing the KEK.
   * @param webApi - the API client to use
   */
  public static async cacheEncryptedVekFromServer(webApi?: WebApiService): Promise<void> {
    const result = await VaultKeyService.fetchVaultKey(webApi);
    if (result.vaultKey) {
      await VaultKeyService.cacheVaultKeyBlobs(result.vaultKey);
    } else if (result.supported) {
      await storage.removeItems([StorageKeys.ENCRYPTED_VEK, StorageKeys.ENCRYPTED_ACCOUNT_KEY, StorageKeys.ACCOUNT_PUBLIC_KEY, StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY]);
    }
  }

  /**
   * The account private key of the unlocked session (JWK string), or null when the vault is locked or
   * the account has no keypair yet (legacy account, not migrated to manifest-v1 yet). Used to decrypt shared-manifest VEK grants.
   */
  public static async getSessionAccountPrivateKey(): Promise<string | null> {
    return (await storage.getItem(StorageKeys.ACCOUNT_PRIVATE_KEY)) as string | null;
  }

  /**
   * The cached account public key, or null when the account has no keypair yet.
   */
  public static async getAccountPublicKey(): Promise<string | null> {
    return (await storage.getItem(StorageKeys.ACCOUNT_PUBLIC_KEY)) as string | null;
  }

  /**
   * Persist the account-key blob chain produced client-side (registration is web-client-only, so this runs on
   * the account-key migration push) and stage the session private key.
   * @param blobs - the encrypted Account Key and KEK derivation parameters for the given unlock method.
   */
  public static async adoptLocalAccountKeys(blobs: { encryptedAccountKey: string; encryptedVek: string; accountPublicKey: string; encryptedAccountPrivateKey: string; accountPrivateKey: string }): Promise<void> {
    await storage.setItems([
      { key: StorageKeys.ENCRYPTED_ACCOUNT_KEY, value: blobs.encryptedAccountKey },
      { key: StorageKeys.ENCRYPTED_VEK, value: blobs.encryptedVek },
      { key: StorageKeys.ACCOUNT_PUBLIC_KEY, value: blobs.accountPublicKey },
      { key: StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY, value: blobs.encryptedAccountPrivateKey },
      { key: StorageKeys.ACCOUNT_PRIVATE_KEY, value: blobs.accountPrivateKey },
    ]);
  }

  /**
   * Resolve the key to actually use for a local additional unlock method (PIN, mobile QR), upgrading a pre-migration
   * stored key (the old KEK) to the VEK when needed.
   * @param storedKey - the key restored from the auxiliary unlock method
   * @param onUpgraded - optional callback invoked with the upgraded VEK when the stored key was the old KEK
   */
  public static async resolveStoredUnlockKey(storedKey: string, onUpgraded?: (vek: string) => Promise<void>): Promise<string> {
    const { key, upgraded } = await VaultKeyService.upgradeStoredKeyIfNeeded(storedKey);
    if (upgraded && onUpgraded) {
      await onUpgraded(key);
    }
    return key;
  }

  /**
   * Given a key restored from an auxiliary unlock method (PIN, mobile QR), return the key to actually use and
   * whether it was upgraded: a stored key that decrypts the cached chain was the old KEK, and the chain's VEK
   * supersedes it.
   * @param storedKey - the key restored from the auxiliary unlock method
   */
  private static async upgradeStoredKeyIfNeeded(storedKey: string): Promise<{ key: string; upgraded: boolean }> {
    try {
      const resolved = await VaultKeyService.resolveFromLocalCache(storedKey);
      if (resolved.encryptedVek !== null && resolved.encryptionKey !== storedKey) {
        return { key: resolved.encryptionKey, upgraded: true };
      }
      return { key: storedKey, upgraded: false };
    } catch {
      return { key: storedKey, upgraded: false };
    }
  }

  /**
   * Decrypt the locally cached blob chain with the given KEK, staging the session private key when the chain
   * carries one. Falls back to the pre-encrypted VEK cache shape (a encrypted VEK alone), and to the derived key itself
   * when nothing is cached (legacy account).
   * @param derivedKeyBase64 - the password-derived key (the KEK)
   */
  private static async resolveFromLocalCache(derivedKeyBase64: string): Promise<ResolvedEncryptionKey> {
    const encryptedAccountKey = (await storage.getItem(StorageKeys.ENCRYPTED_ACCOUNT_KEY)) as string | null;
    const encryptedVek = (await storage.getItem(StorageKeys.ENCRYPTED_VEK)) as string | null;

    if (encryptedAccountKey) {
      const accountKey = await VaultKeyService.unwrapOrThrow(encryptedAccountKey, derivedKeyBase64);
      const vek = encryptedVek ? await VaultKeyService.unwrapOrThrow(encryptedVek, accountKey) : accountKey;
      await VaultKeyService.stageSessionPrivateKey(accountKey, (await storage.getItem(StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY)) as string | null);
      return { encryptionKey: vek, encryptedVek: encryptedAccountKey };
    }

    if (encryptedVek) {
      // Pre-encrypted VEK cache: the VEK was encrypted directly with the KEK.
      return { encryptionKey: await VaultKeyService.unwrapOrThrow(encryptedVek, derivedKeyBase64), encryptedVek };
    }

    return { encryptionKey: derivedKeyBase64, encryptedVek: null };
  }

  /**
   * Decrypt a fresh server response's chain with the KEK: AK first, then the VEK (or the AK itself for a
   * transitional account where AK ≡ VEK), staging the session private key when the account has a keypair.
   * @param vaultKey - the server's vault key response
   * @param derivedKeyBase64 - the password-derived KEK
   */
  private static async unwrapChainOrThrow(vaultKey: VaultKeyResponse, derivedKeyBase64: string): Promise<string> {
    const accountKey = await VaultKeyService.unwrapOrThrow(vaultKey.encryptedAccountKey, derivedKeyBase64);
    const vek = vaultKey.encryptedVek ? await VaultKeyService.unwrapOrThrow(vaultKey.encryptedVek, accountKey) : accountKey;
    await VaultKeyService.stageSessionPrivateKey(accountKey, vaultKey.encryptedAccountPrivateKey ?? null);
    return vek;
  }

  /**
   * Decrypt the account private key with the AK into session storage, so pull/grant flows can decrypt shared
   * VEKs. A chain without a keypair (transitional account) clears any stale session copy instead.
   * @param accountKeyBase64 - the encrypted Account Key
   * @param encryptedAccountPrivateKey - the account private key encrypted with the Account Key, or null when the account has none yet
   */
  private static async stageSessionPrivateKey(accountKeyBase64: string, encryptedAccountPrivateKey: string | null): Promise<void> {
    if (!encryptedAccountPrivateKey) {
      await storage.removeItem(StorageKeys.ACCOUNT_PRIVATE_KEY);
      return;
    }
    try {
      const privateKeyJwk = await EncryptionUtility.symmetricDecrypt(encryptedAccountPrivateKey, accountKeyBase64);
      await storage.setItem(StorageKeys.ACCOUNT_PRIVATE_KEY, privateKeyJwk);
    } catch {
      // A stale/corrupt private-key blob must not fail the unlock; grant decryption degrades until the next sync.
      await storage.removeItem(StorageKeys.ACCOUNT_PRIVATE_KEY);
    }
  }

  /**
   * Persist a server vault-key response's encrypted blobs for offline unlock.
   * @param vaultKey - the server's vault key response
   */
  private static async cacheVaultKeyBlobs(vaultKey: VaultKeyResponse): Promise<void> {
    await storage.setItem(StorageKeys.ENCRYPTED_ACCOUNT_KEY, vaultKey.encryptedAccountKey);
    if (vaultKey.encryptedVek) {
      await storage.setItem(StorageKeys.ENCRYPTED_VEK, vaultKey.encryptedVek);
    } else {
      await storage.removeItem(StorageKeys.ENCRYPTED_VEK);
    }
    if (vaultKey.accountPublicKey && vaultKey.encryptedAccountPrivateKey) {
      await storage.setItem(StorageKeys.ACCOUNT_PUBLIC_KEY, vaultKey.accountPublicKey);
      await storage.setItem(StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY, vaultKey.encryptedAccountPrivateKey);
    } else {
      await storage.removeItems([StorageKeys.ACCOUNT_PUBLIC_KEY, StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY]);
    }
  }

  /**
   * Decrypt an encrypted key blob, mapping an AES-GCM authentication failure onto the standard decrypt-failed
   * error code so existing wrong-password handling applies.
   * @param encryptedKey - encrypted key blob
   * @param decryptingKeyBase64 - the key that decrypts it (the KEK derived from the unlock method)
   */
  private static async unwrapOrThrow(encryptedKey: string, decryptingKeyBase64: string): Promise<string> {
    try {
      return await EncryptionUtility.unwrapVaultEncryptionKey(encryptedKey, decryptingKeyBase64);
    } catch {
      // E-203: decrypt failed, which for the password key type means the entered password is wrong.
      throw new Error(formatErrorWithCode('Failed to decrypt vault encryption key', AppErrorCode.VAULT_DECRYPT_FAILED));
    }
  }
}

export default VaultKeyService;
