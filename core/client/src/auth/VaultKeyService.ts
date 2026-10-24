/**
 * VaultKeyService with client-side helpers for key operations.
 */

import { UnlockMethodType, VaultKeyAlgorithm, type VaultKeyGetResponse, type VaultKeyResponse } from '@aliasvault/models/webapi';

import { ApiRequestError } from '../api/errors/ApiRequestError';
import { AppErrorCode, extractErrorCode, formatErrorWithCode } from '../api/errors/AppErrorCodes';
import { WebApiService } from '../api/WebApiService';
import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';
import { openKeyChainWithAccountKey, openKeyChainWithUnlockKey } from '../rust/RustCore';

import { convertLegacySessionKey } from './LegacyKeyConversion';

import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';

/**
 * Result of fetching the vault key from the server.
 */
export type FetchVaultKeyResult = {
  supported: boolean;
  vaultKey: VaultKeyResponse | null;
};

/**
 * The keys the Account Key opens.
 */
export type SessionKeys = {
  /** The vault encryption key (VEK). */
  vaultEncryptionKey: string;
  /** The account private key (JWK). */
  accountPrivateKey: string | null;
  /** The Account Key, which the session stores for later unlocks. */
  accountKey: string;
};

/**
 * The key a key chain is opened with: the unlock key of a password login, or the Account Key a device unlock method or
 * an earlier login stored.
 */
export type KeyChainKey = { unlockKey: string } | { accountKey: string };

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
      // TODO: switch to `UnlockMethod/${UnlockMethodType.Password}` after minimum API is 0.32.0+ that has the new URL.
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
   * Right after authentication: fetch the account's key chain from the server, check that the key opens it and
   * cache it for offline unlock.
   * @param key - the unlock key of the password login, or the Account Key a mobile app sent
   * @param webApi - the API client to use
   * @returns The Account Key to store for this session.
   * @throws Error with {@link AppErrorCode.UNLOCK_KEY_REJECTED} when the key does not open the chain (wrong password).
   */
  public static async refreshKeyChain(key: KeyChainKey, webApi?: WebApiService): Promise<string> {
    const result = await VaultKeyService.fetchVaultKey(webApi);

    if (!result.supported) {
      // Older server: trust the local cache.
      return (await VaultKeyService.openKeyChain(key)).accountKey;
    }

    if (!result.vaultKey) {
      // Sanity check: a server without the key chain this device holds is behind the session.
      if (await VaultKeyService.hasLocalVaultKey()) {
        throw new Error(formatErrorWithCode('The server holds no key chain for this account', AppErrorCode.KEY_OUT_OF_SYNC));
      }
      await getPlatform().storage.removeMany([StorageKeys.ENCRYPTED_VEK, StorageKeys.ENCRYPTED_ACCOUNT_KEY, StorageKeys.ACCOUNT_PUBLIC_KEY, StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY, StorageKeys.SIGNING_PUBLIC_KEY, StorageKeys.ENCRYPTED_SIGNING_PRIVATE_KEY]);
      return VaultKeyService.keyOf(key);
    }

    if (result.vaultKey.algorithm !== VaultKeyAlgorithm.Aes256Gcm) {
      throw new Error(formatErrorWithCode(`Unsupported Account Key algorithm '${result.vaultKey.algorithm}'`, AppErrorCode.VAULT_VERSION_INCOMPATIBLE));
    }

    const keys = await VaultKeyService.openChain(key, result.vaultKey.encryptedAccountKey, result.vaultKey.encryptedVek ?? null, null);

    /*
     * A device holding a vault under its unlock key but no chain yet (the account was upgraded on another device) stays
     * a legacy session: its first sync caches the chain and re-encrypts the stored vault under the VEK in one step.
     */
    if ('unlockKey' in key && !await VaultKeyService.hasLocalVaultKey() && await getPlatform().storage.get(StorageKeys.ENCRYPTED_VAULT) !== null) {
      return key.unlockKey;
    }

    await VaultKeyService.cacheVaultKeyBlobs(result.vaultKey);
    return keys.accountKey;
  }

  /**
   * Check offline that the unlock key derived from the typed password opens the locally cached chain (an account not yet
   * upgraded has none; its unlock key is the vault key).
   * @param unlockKey - the unlock key derived from the typed password
   * @returns The Account Key to store for this session.
   * @throws Error with {@link AppErrorCode.UNLOCK_KEY_REJECTED} when the key does not open the chain (wrong password).
   */
  public static async verifyUnlockKey(unlockKey: string): Promise<string> {
    return (await VaultKeyService.openKeyChain({ unlockKey })).accountKey;
  }

  /**
   * Check offline that an Account Key a device unlock method (PIN, passkey) restored opens the locally cached chain.
   * @param accountKey - the restored Account Key
   * @returns The Account Key to store for this session.
   * @throws Error with {@link AppErrorCode.UNLOCK_KEY_REJECTED} when the key does not open the chain (a stale key).
   */
  public static async verifyAccountKey(accountKey: string): Promise<string> {
    return (await VaultKeyService.openKeyChain({ accountKey })).accountKey;
  }

  /**
   * Whether this device holds a key chain, i.e. whether the account is on the account-key model rather than a
   * legacy account whose unlock key encrypts the vault directly. The cache is written on every login and cleared
   * when the server reports no vault key, so it needs no server round-trip. A false answer is only ever stale in
   * one direction (another device migrated since the last login), which the sync resolves by accepting the remote chain.
   */
  public static async hasLocalVaultKey(): Promise<boolean> {
    const platform = getPlatform();
    if (platform.hasLocalVaultKey) {
      return platform.hasLocalVaultKey();
    }
    return (await platform.storage.get(StorageKeys.ENCRYPTED_ACCOUNT_KEY) as string | null) !== null;
  }

  /**
   * Whether a failed unlock means the entered password or PIN was wrong. A key chain rejects a wrong key itself;
   * a legacy account has no chain, so there the stored vault failing to decrypt is the only signal.
   * @param code - the error code the unlock failed with
   */
  public static async isWrongUnlockKey(code: AppErrorCode | null): Promise<boolean> {
    if (code === AppErrorCode.UNLOCK_KEY_REJECTED) {
      return true;
    }
    return code === AppErrorCode.VAULT_DECRYPT_FAILED && !await VaultKeyService.hasLocalVaultKey();
  }

  /**
   * The Account Key of the unlocked session, or null when the vault is locked.
   */
  public static async getSessionAccountKey(): Promise<string | null> {
    return (await getPlatform().storage.get(StorageKeys.ACCOUNT_KEY)) as string | null;
  }

  /**
   * The keys of the unlocked session, derived from the Account Key and the cached chain, or null when the vault is
   * locked.
   */
  public static async getSessionKeys(): Promise<SessionKeys | null> {
    const storedKey = await VaultKeyService.getSessionAccountKey();
    if (!storedKey) {
      return null;
    }
    return VaultKeyService.openStoredSessionKey(storedKey);
  }

  /**
   * Open the cached chain with the key the session stores: the Account Key. A session that still holds an unlock key
   * (see LegacyKeyConversion) opens the chain with it as such and stores the Account Key in its place.
   * @param storedKey - the key the session stores
   */
  private static async openStoredSessionKey(storedKey: string): Promise<SessionKeys> {
    try {
      return await VaultKeyService.openKeyChain({ accountKey: storedKey });
    } catch (error) {
      if (!(error instanceof Error) || extractErrorCode(error.message) !== AppErrorCode.UNLOCK_KEY_REJECTED) {
        throw error;
      }
    }
    /*
     * LEGACY: the session holds an unlock key from before the account had a key chain.
     * This legacy key conversion call can be removed once all clients have updated to 0.31.0+.
     */
    const keys = await VaultKeyService.openKeyChain({ unlockKey: storedKey });
    await convertLegacySessionKey(storedKey, keys.accountKey);
    return keys;
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
   * The cached account signing private key, encrypted with the Account Key, or null when the account has no signing key yet.
   */
  public static async getEncryptedSigningPrivateKey(): Promise<string | null> {
    return (await getPlatform().storage.get(StorageKeys.ENCRYPTED_SIGNING_PRIVATE_KEY)) as string | null;
  }

  /**
   * Persist the new account key after a local password change. The session stores the Account Key, which the change
   * leaves as it is.
   * @param newEncryptedAccountKey - the Account Key encrypted with the KEK of the new password
   * @param derivationParams - the unlock key derivation parameters of the new password
   * @param accountKeyBase64 - the Account Key
   */
  public static async persistNewAccountKey(newEncryptedAccountKey: string, derivationParams: UnlockKeyDerivationParams, accountKeyBase64: string): Promise<void> {
    await getPlatform().storage.setMany([
      { key: StorageKeys.ENCRYPTED_ACCOUNT_KEY, value: newEncryptedAccountKey },
      { key: StorageKeys.UNLOCK_KEY_DERIVATION_PARAMS, value: derivationParams },
      { key: StorageKeys.ACCOUNT_KEY, value: accountKeyBase64 },
    ]);
  }

  /**
   * Open the locally cached chain with a stored or typed key. Without a cached chain (account not yet upgraded) the
   * key is the vault encryption key.
   * @param key - the unlock key or the Account Key
   * @throws Error with {@link AppErrorCode.UNLOCK_KEY_REJECTED} when the key does not open the chain.
   */
  public static async openKeyChain(key: KeyChainKey): Promise<SessionKeys> {
    const storage = getPlatform().storage;
    const [encryptedAccountKey, encryptedVek, encryptedAccountPrivateKey] = await Promise.all([
      storage.get<string>(StorageKeys.ENCRYPTED_ACCOUNT_KEY),
      storage.get<string>(StorageKeys.ENCRYPTED_VEK),
      storage.get<string>(StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY),
    ]);
    if (!encryptedAccountKey) {
      const keyBase64 = VaultKeyService.keyOf(key);
      return { vaultEncryptionKey: keyBase64, accountPrivateKey: null, accountKey: keyBase64 };
    }
    return VaultKeyService.openChain(key, encryptedAccountKey, encryptedVek, encryptedAccountPrivateKey);
  }

  /**
   * Walk a chain with the unlock key or the Account Key (the Rust `open_key_chain_with_unlock_key` and
   * `open_key_chain_with_account_key`).
   * @param key - the unlock key or the Account Key
   * @param encryptedAccountKey - the Account Key encrypted with the KEK derived from the unlock key
   * @param encryptedVek - the VEK encrypted with the Account Key
   * @param encryptedAccountPrivateKey - the account private key encrypted with the Account Key, or null when the account has none yet
   */
  private static async openChain(key: KeyChainKey, encryptedAccountKey: string, encryptedVek: string | null, encryptedAccountPrivateKey: string | null): Promise<SessionKeys> {
    if (!encryptedVek) {
      throw new Error('Vault key chain is missing the encrypted VEK');
    }

    const opened = 'unlockKey' in key
      ? await openKeyChainWithUnlockKey(key.unlockKey, encryptedAccountKey, encryptedVek, encryptedAccountPrivateKey)
      : await openKeyChainWithAccountKey(key.accountKey, encryptedVek, encryptedAccountPrivateKey);
    switch (opened.status) {
      case 'opened':
        return { vaultEncryptionKey: opened.vaultEncryptionKey, accountPrivateKey: opened.accountPrivateKey, accountKey: opened.accountKey };
      case 'unlockKeyRejected':
      case 'accountKeyRejected':
        // E-206: the key does not open the chain, which for the unlock key means a wrong password.
        throw new Error(formatErrorWithCode('Failed to decrypt key chain', AppErrorCode.UNLOCK_KEY_REJECTED));
      default:
        // E-207: the account key opened, so a failure here is a damaged chain and never a wrong password.
        throw new Error(formatErrorWithCode('Failed to decrypt key chain', AppErrorCode.KEY_CHAIN_UNREADABLE));
    }
  }

  /**
   * The base64 key inside a {@link KeyChainKey}.
   */
  private static keyOf(key: KeyChainKey): string {
    return 'unlockKey' in key ? key.unlockKey : key.accountKey;
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

    if (vaultKey.signingPublicKey && vaultKey.encryptedSigningPrivateKey) {
      await getPlatform().storage.setMany([
        { key: StorageKeys.SIGNING_PUBLIC_KEY, value: vaultKey.signingPublicKey },
        { key: StorageKeys.ENCRYPTED_SIGNING_PRIVATE_KEY, value: vaultKey.encryptedSigningPrivateKey },
      ]);
    } else {
      await getPlatform().storage.removeMany([StorageKeys.SIGNING_PUBLIC_KEY, StorageKeys.ENCRYPTED_SIGNING_PRIVATE_KEY]);
    }
  }
}

export default VaultKeyService;
