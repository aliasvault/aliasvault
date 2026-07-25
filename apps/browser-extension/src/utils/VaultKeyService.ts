/**
 * VaultKeyService.
 *
 * Client-side helper for the KEK/VEK model. The vault content is encrypted with a random Vault Encryption Key
 * (VEK) that never changes; the server stores the VEK wrapped (AES-256-GCM) with a Key Encryption Key (KEK)
 * derived from the master password. This service resolves which key the rest of the app should use as "the
 * encryption key": the unwrapped VEK for migrated users, or the password-derived key itself for legacy users.
 */

import { storage } from 'wxt/utils/storage';

import type { VaultKeyGetResponse, VaultKeyResponse } from '@/utils/dist/core/models/webapi';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { ApiRequestError } from '@/utils/types/errors/ApiRequestError';
import { AppErrorCode, formatErrorWithCode } from '@/utils/types/errors/AppErrorCodes';
import { WebApiService } from '@/utils/WebApiService';

/** Local cache of the wrapped VEK (AES-GCM ciphertext) enabling offline unlock for migrated users. */
export const WRAPPED_VEK_STORAGE_KEY = 'local:wrappedVek';

/** The key type for password-based vault keys, mirroring the server's VaultKey.KeyType value. */
export const VAULT_KEY_TYPE_PASSWORD = 'password';

/**
 * How long a fetched password vault key response is reused before hitting the network again. Mirrors the /v2/Status
 * cache: long enough to collapse the repeated probes a single sync cycle makes, short enough that it never spans
 * two user actions.
 */
const VAULT_KEY_CACHE_TTL_MS = 1000;

/**
 * Process-wide (background service worker) cache of the last successful password vault key response.
 *
 * This exists for NOT-yet-migrated users. A migrated device answers "do I have a vault key" from its local wrapped-VEK
 * cache and never probes at all, but a legacy device has nothing to cache, so every caller that asks would otherwise
 * issue its own GET — several per sync across the status check and the push path.
 */
let cachedVaultKey: { data: FetchVaultKeyResult; timestamp: number } | null = null;

/**
 * Result of resolving the vault encryption key after deriving the password key.
 */
export type ResolvedEncryptionKey = {
  /** The key to use for all vault encryption/decryption: the VEK for migrated users, the derived key for legacy users. */
  encryptionKey: string;
  /** The wrapped VEK when the user is on the KEK/VEK model, null for legacy users. */
  wrappedVek: string | null;
};

/**
 * Result of fetching the vault key from the server.
 */
export type FetchVaultKeyResult = {
  /** False when the server does not implement the VaultKey endpoint at all (older server version, HTTP 404). */
  supported: boolean;
  /** The vault key, or null when the user has none (legacy user) or the endpoint is unsupported. */
  vaultKey: VaultKeyResponse | null;
};

/**
 * Static helper for fetching, unwrapping, and caching the vault encryption key (VEK).
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
   * Resolve the vault encryption key right after authentication: fetch the vault key from the server, unwrap the
   * VEK with the password-derived key (KEK), and cache the wrapped VEK for offline unlock. For legacy users
   * (server explicitly reports no vault key) the derived key itself is the encryption key and any stale cached
   * wrapped VEK is cleared.
   * @param derivedKeyBase64 - the password-derived key (the KEK)
   * @param webApi - the API client to use
   * @throws Error with {@link AppErrorCode.VAULT_DECRYPT_FAILED} when the wrapped VEK cannot be unwrapped with the
   *   derived key (wrong password, or key material out of sync).
   */
  public static async resolveEncryptionKey(derivedKeyBase64: string, webApi?: WebApiService): Promise<ResolvedEncryptionKey> {
    const result = await VaultKeyService.fetchVaultKey(webApi);

    if (!result.supported) {
      // Older server: trust the local cache. Legacy accounts have no cached wrapped VEK and use the derived key.
      const cachedWrappedVek = await storage.getItem(WRAPPED_VEK_STORAGE_KEY) as string | null;
      if (!cachedWrappedVek) {
        return { encryptionKey: derivedKeyBase64, wrappedVek: null };
      }

      return { encryptionKey: await VaultKeyService.unwrapOrThrow(cachedWrappedVek, derivedKeyBase64), wrappedVek: cachedWrappedVek };
    }

    if (!result.vaultKey) {
      await storage.removeItem(WRAPPED_VEK_STORAGE_KEY);
      return { encryptionKey: derivedKeyBase64, wrappedVek: null };
    }

    const vek = await VaultKeyService.unwrapOrThrow(result.vaultKey.wrappedVek, derivedKeyBase64);
    await storage.setItem(WRAPPED_VEK_STORAGE_KEY, result.vaultKey.wrappedVek);
    return { encryptionKey: vek, wrappedVek: result.vaultKey.wrappedVek };
  }

  /**
   * Resolve the vault encryption key offline: unwrap the locally cached wrapped VEK with the derived key. For
   * legacy users (no cached wrapped VEK) the derived key itself is returned.
   * @param derivedKeyBase64 - the password-derived key
   * @throws Error with {@link AppErrorCode.VAULT_DECRYPT_FAILED} when unwrapping fails (wrong password).
   */
  public static async resolveEncryptionKeyOffline(derivedKeyBase64: string): Promise<string> {
    const wrappedVek = await storage.getItem(WRAPPED_VEK_STORAGE_KEY) as string | null;
    if (!wrappedVek) {
      return derivedKeyBase64;
    }

    return VaultKeyService.unwrapOrThrow(wrappedVek, derivedKeyBase64);
  }

  /**
   * Drop the in-memory vault key response cache. Called when the account is cleared (logout), so a subsequent login
   * as a different user can never be answered from the previous user's response inside the TTL window.
   */
  public static clearCache(): void {
    cachedVaultKey = null;
  }

  /**
   * Whether this device holds a vault key, i.e. whether the session encryption key is a VEK rather than the raw
   * password-derived key. This is the local source of truth for "am I on the KEK/VEK model": the cache is written
   * by {@link resolveEncryptionKey} on every login and cleared when the server reports no vault key, so it needs no
   * server round-trip. A false answer is only ever stale in one direction (another device migrated since the last
   * login), which the background sync resolves by adopting the remote key before any vault work happens.
   */
  public static async hasLocalVaultKey(): Promise<boolean> {
    return (await storage.getItem(WRAPPED_VEK_STORAGE_KEY) as string | null) !== null;
  }

  /**
   * Refresh the local wrapped-VEK cache from the server without needing the KEK.
   * @param webApi - the API client to use
   */
  public static async cacheWrappedVekFromServer(webApi?: WebApiService): Promise<void> {
    const result = await VaultKeyService.fetchVaultKey(webApi);
    if (result.vaultKey) {
      await storage.setItem(WRAPPED_VEK_STORAGE_KEY, result.vaultKey.wrappedVek);
    } else if (result.supported) {
      await storage.removeItem(WRAPPED_VEK_STORAGE_KEY);
    }
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
   * Given a key restored from an auxiliary unlock method (PIN, mobile QR), return the key to actually use and whether it was upgraded.
   * @param storedKey - the key restored from the auxiliary unlock method
   */
  private static async upgradeStoredKeyIfNeeded(storedKey: string): Promise<{ key: string; upgraded: boolean }> {
    const wrappedVek = await storage.getItem(WRAPPED_VEK_STORAGE_KEY) as string | null;
    if (!wrappedVek) {
      return { key: storedKey, upgraded: false };
    }

    try {
      const vek = await EncryptionUtility.unwrapVaultEncryptionKey(wrappedVek, storedKey);
      return { key: vek, upgraded: true };
    } catch {
      return { key: storedKey, upgraded: false };
    }
  }

  /**
   * Unwrap a wrapped VEK, mapping an AES-GCM authentication failure onto the standard decrypt-failed error code so
   * existing wrong-password handling applies.
   * @param wrappedVek - base64(IV ‖ ciphertext ‖ tag) of the wrapped VEK
   * @param kekBase64 - the password-derived KEK
   */
  private static async unwrapOrThrow(wrappedVek: string, kekBase64: string): Promise<string> {
    try {
      return await EncryptionUtility.unwrapVaultEncryptionKey(wrappedVek, kekBase64);
    } catch {
      // E-203: unwrap failed, which for the password key type means the entered password is wrong.
      throw new Error(formatErrorWithCode('Failed to unwrap vault encryption key', AppErrorCode.VAULT_DECRYPT_FAILED));
    }
  }
}

export default VaultKeyService;
