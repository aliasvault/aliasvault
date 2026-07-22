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
   * Fetch the current user's password vault key from the server.
   * @param webApi - the API client to use (popup context passes its own instance; background creates one)
   */
  public static async fetchVaultKey(webApi?: WebApiService): Promise<FetchVaultKeyResult> {
    const api = webApi ?? new WebApiService();
    try {
      const response = await api.get<VaultKeyGetResponse>(`VaultKey/${VAULT_KEY_TYPE_PASSWORD}`);
      return { supported: true, vaultKey: response.vaultKey ?? null };
    } catch (e) {
      if (e instanceof ApiRequestError && e.statusCode === 404) {
        return { supported: false, vaultKey: null };
      }
      if (e instanceof Error && e.message.includes('status: 404')) {
        return { supported: false, vaultKey: null };
      }
      throw e;
    }
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
   * Given a key restored from an auxiliary unlock method (PIN, mobile QR), return the key to actually use.
   * @param storedKey - the key restored from the auxiliary unlock method
   */
  public static async upgradeStoredKeyIfNeeded(storedKey: string): Promise<{ key: string; upgraded: boolean }> {
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
