/**
 * VaultKeyService with client-side helpers for key operations.
 */

import { UnlockMethodType, type VaultKeyGetResponse, type VaultKeyResponse } from '@aliasvault/models/webapi';

import { ApiRequestError } from '../api/errors/ApiRequestError';
import { AppErrorCode, formatErrorWithCode } from '../api/errors/AppErrorCodes';
import { WebApiService } from '../api/WebApiService';
import { StorageKeys } from '../constants/StorageKeys';
import { EncryptionUtility } from '../crypto/EncryptionUtility';
import { getPlatform } from '../platform/ClientPlatform';

import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';

/**
 * Result of fetching the vault key from the server.
 */
export type FetchVaultKeyResult = {
  supported: boolean;
  vaultKey: VaultKeyResponse | null;
};

/**
 * The keys an unlock key opens.
 */
export type SessionKeys = {
  /** The vault encryption key (VEK). */
  vaultEncryptionKey: string;
  /** The account private key (JWK). */
  accountPrivateKey: string | null;
};

/**
 * Static helper for fetching, caching and opening the account-key unlock chain (KEK → AK → VEK + account keypair).
 */
export class VaultKeyService {
  /**
   * Fetch the current user's password vault key from the server.
   * @param webApi - the API client to use (popup context passes its own instance; background creates one)
   */
  public static async fetchVaultKey(webApi?: WebApiService): Promise<FetchVaultKeyResult> {
    const api = webApi ?? new WebApiService();
    try {
      const response = await api.get<VaultKeyGetResponse>(`VaultKey/${UnlockMethodType.Password}`);
      return { supported: true, vaultKey: response.vaultKey ?? null };
    } catch (e) {
      if (e instanceof ApiRequestError && e.statusCode === 404) {
        return { supported: false, vaultKey: null };
      } else if (e instanceof Error && e.message.includes('status: 404')) {
        return { supported: false, vaultKey: null };
      }
      throw e;
    }
  }

  /**
   * Right after authentication: fetch the account's key chain from the server, check that the unlock key opens it
   * and cache it for offline unlock.
   * @param unlockKeyBase64 - the password-derived key (the KEK)
   * @param webApi - the API client to use
   * @throws Error with {@link AppErrorCode.VAULT_DECRYPT_FAILED} when the key does not open the chain (wrong password).
   */
  public static async refreshKeyChain(unlockKeyBase64: string, webApi?: WebApiService): Promise<void> {
    const result = await VaultKeyService.fetchVaultKey(webApi);

    if (!result.supported) {
      // Older server: trust the local cache.
      await VaultKeyService.verifyUnlockKey(unlockKeyBase64);
      return;
    }

    if (!result.vaultKey) {
      await getPlatform().storage.removeMany([StorageKeys.ENCRYPTED_VEK, StorageKeys.ENCRYPTED_ACCOUNT_KEY, StorageKeys.ACCOUNT_PUBLIC_KEY, StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY]);
      return;
    }

    await VaultKeyService.openChain(unlockKeyBase64, result.vaultKey.encryptedAccountKey, result.vaultKey.encryptedVek ?? null, null);
    await VaultKeyService.cacheVaultKeyBlobs(result.vaultKey);
  }

  /**
   * Check offline that the unlock key opens the locally cached chain. A legacy account has no chain to check against.
   * @param unlockKeyBase64 - the password-derived key (the KEK), typed in or restored by PIN
   * @throws Error with {@link AppErrorCode.VAULT_DECRYPT_FAILED} when the key does not open the chain (wrong password).
   */
  public static async verifyUnlockKey(unlockKeyBase64: string): Promise<void> {
    await VaultKeyService.openKeyChain(unlockKeyBase64);
  }

  /**
   * Whether this device holds a key chain, i.e. whether the account is on the account-key model rather than a
   * legacy account whose unlock key encrypts the vault directly. The cache is written on every login and cleared
   * when the server reports no vault key, so it needs no server round-trip. A false answer is only ever stale in
   * one direction (another device migrated since the last login), which the sync resolves by adopting the remote chain.
   */
  public static async hasLocalVaultKey(): Promise<boolean> {
    return (await getPlatform().storage.get(StorageKeys.ENCRYPTED_ACCOUNT_KEY) as string | null) !== null;
  }

  /**
   * The unlock key of this session (the password-derived KEK), or null when the vault is locked.
   */
  public static async getSessionUnlockKey(): Promise<string | null> {
    return (await getPlatform().storage.get(StorageKeys.UNLOCK_KEY)) as string | null;
  }

  /**
   * The keys of the unlocked session, derived from the unlock key and the cached chain, or null when the vault is locked.
   */
  public static async getSessionKeys(): Promise<SessionKeys | null> {
    const unlockKey = await VaultKeyService.getSessionUnlockKey();
    return unlockKey ? VaultKeyService.openKeyChain(unlockKey) : null;
  }

  /**
   * The vault encryption key of the unlocked session, or null when the vault is locked.
   */
  public static async getSessionVaultEncryptionKey(): Promise<string | null> {
    return (await VaultKeyService.getSessionKeys())?.vaultEncryptionKey ?? null;
  }

  /**
   * The account private key of the unlocked session (JWK string), or null when the vault is locked or
   * the account has no keypair yet (legacy account, not migrated to manifest-v1 yet). Used to decrypt shared-manifest VEK grants.
   */
  public static async getSessionAccountPrivateKey(): Promise<string | null> {
    return (await VaultKeyService.getSessionKeys())?.accountPrivateKey ?? null;
  }

  /**
   * The cached account public key, or null when the account has no keypair yet.
   */
  public static async getAccountPublicKey(): Promise<string | null> {
    return (await getPlatform().storage.get(StorageKeys.ACCOUNT_PUBLIC_KEY)) as string | null;
  }

  /**
   * Persist new account key after a local password change. The session moves onto the new unlock key with it.
   * @param newEncryptedAccountKey - the Account Key encrypted with the new password-derived KEK
   * @param derivationParams - the KEK derivation parameters of the new password
   * @param newUnlockKeyBase64 - the new password-derived KEK
   */
  public static async persistNewAccountKey(newEncryptedAccountKey: string, derivationParams: UnlockKeyDerivationParams, newUnlockKeyBase64: string): Promise<void> {
    await getPlatform().storage.setMany([
      { key: StorageKeys.ENCRYPTED_ACCOUNT_KEY, value: newEncryptedAccountKey },
      { key: StorageKeys.UNLOCK_KEY_DERIVATION_PARAMS, value: derivationParams },
      { key: StorageKeys.UNLOCK_KEY, value: newUnlockKeyBase64 },
    ]);
  }

  /**
   * Open the locally cached chain with the unlock key. Without a cached chain (legacy account) the unlock key is
   * the vault encryption key.
   * @param unlockKeyBase64 - the password-derived key (the KEK)
   * @throws Error with {@link AppErrorCode.VAULT_DECRYPT_FAILED} when the key does not open the chain.
   */
  public static async openKeyChain(unlockKeyBase64: string): Promise<SessionKeys> {
    const storage = getPlatform().storage;
    const [encryptedAccountKey, encryptedVek, encryptedAccountPrivateKey] = await Promise.all([
      storage.get<string>(StorageKeys.ENCRYPTED_ACCOUNT_KEY),
      storage.get<string>(StorageKeys.ENCRYPTED_VEK),
      storage.get<string>(StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY),
    ]);
    if (!encryptedAccountKey) {
      return { vaultEncryptionKey: unlockKeyBase64, accountPrivateKey: null };
    }
    return VaultKeyService.openChain(unlockKeyBase64, encryptedAccountKey, encryptedVek, encryptedAccountPrivateKey);
  }

  /**
   * Walk a chain: the unlock key decrypts the Account Key, which decrypts the VEK and the account private key.
   * @param unlockKeyBase64 - the password-derived key (the KEK)
   * @param encryptedAccountKey - the Account Key encrypted with the KEK
   * @param encryptedVek - the VEK encrypted with the Account Key
   * @param encryptedAccountPrivateKey - the account private key encrypted with the Account Key, or null when the account has none yet
   */
  private static async openChain(unlockKeyBase64: string, encryptedAccountKey: string, encryptedVek: string | null, encryptedAccountPrivateKey: string | null): Promise<SessionKeys> {
    if (!encryptedVek) {
      throw new Error('Vault key chain is missing the encrypted VEK');
    }

    const accountKey = await VaultKeyService.decryptKeyOrThrow(encryptedAccountKey, unlockKeyBase64);
    const vaultEncryptionKey = await VaultKeyService.decryptKeyOrThrow(encryptedVek, accountKey);

    let accountPrivateKey: string | null = null;
    if (encryptedAccountPrivateKey) {
      try {
        accountPrivateKey = await EncryptionUtility.symmetricDecrypt(encryptedAccountPrivateKey, accountKey);
      } catch {
        // A stale/corrupt private-key blob must not fail the unlock; grant decryption degrades until the next login.
      }
    }
    return { vaultEncryptionKey, accountPrivateKey };
  }

  /**
   * Persist a server vault-key response's encrypted blobs for offline unlock.
   * @param vaultKey - the server's vault key response
   */
  public static async cacheVaultKeyBlobs(vaultKey: VaultKeyResponse): Promise<void> {
    await getPlatform().storage.setMany([
      { key: StorageKeys.ENCRYPTED_ACCOUNT_KEY, value: vaultKey.encryptedAccountKey },
      { key: StorageKeys.ENCRYPTED_VEK, value: vaultKey.encryptedVek },
    ]);

    if (vaultKey.accountPublicKey && vaultKey.encryptedAccountPrivateKey) {
      await getPlatform().storage.set(StorageKeys.ACCOUNT_PUBLIC_KEY, vaultKey.accountPublicKey);
      await getPlatform().storage.set(StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY, vaultKey.encryptedAccountPrivateKey);
    } else {
      await getPlatform().storage.removeMany([StorageKeys.ACCOUNT_PUBLIC_KEY, StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY]);
    }
  }

  /**
   * Decrypt an encrypted key blob, mapping an AES-GCM authentication failure onto the standard decrypt-failed
   * error code so existing wrong-password handling applies.
   * @param encryptedKey - encrypted key blob
   * @param decryptingKeyBase64 - the key that decrypts it (the KEK derived from the unlock method)
   */
  private static async decryptKeyOrThrow(encryptedKey: string, decryptingKeyBase64: string): Promise<string> {
    try {
      return await EncryptionUtility.decryptVaultEncryptionKey(encryptedKey, decryptingKeyBase64);
    } catch {
      // E-203: decrypt failed, which for the password key type means the entered password is wrong.
      throw new Error(formatErrorWithCode('Failed to decrypt vault encryption key', AppErrorCode.VAULT_DECRYPT_FAILED));
    }
  }
}

export default VaultKeyService;
