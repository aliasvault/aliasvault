/**
 * VaultKeyService with client-side helpers for key operations.
 */

import { UnlockMethodType, VaultKeyAlgorithm, type VaultKeyGetResponse, type VaultKeyResponse } from '@aliasvault/models/webapi';

import { ApiRequestError } from '../api/errors/ApiRequestError';
import { AppErrorCode, formatErrorWithCode } from '../api/errors/AppErrorCodes';
import { WebApiService } from '../api/WebApiService';
import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';
import { openAccountKeyChain } from '../rust/RustCore';

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
   * Right after authentication: fetch the account's key chain from the server, check that the key opens it and
   * cache it for offline unlock.
   * @param unlockKeyBase64 - the unlock key (the Argon2id output of the master password) or a stored Account Key
   * @param webApi - the API client to use
   * @returns The Account Key to store for this session.
   * @throws Error with {@link AppErrorCode.UNLOCK_KEY_REJECTED} when the key does not open the chain (wrong password).
   */
  public static async refreshKeyChain(unlockKeyBase64: string, webApi?: WebApiService): Promise<string> {
    const result = await VaultKeyService.fetchVaultKey(webApi);

    if (!result.supported) {
      // Older server: trust the local cache.
      return VaultKeyService.verifyUnlockKey(unlockKeyBase64);
    }

    if (!result.vaultKey) {
      // Sanity check: a server without the key chain this device holds is behind the session.
      if (await VaultKeyService.hasLocalVaultKey()) {
        throw new Error(formatErrorWithCode('The server holds no key chain for this account', AppErrorCode.KEY_OUT_OF_SYNC));
      }
      await getPlatform().storage.removeMany([StorageKeys.ENCRYPTED_VEK, StorageKeys.ENCRYPTED_ACCOUNT_KEY, StorageKeys.ACCOUNT_PUBLIC_KEY, StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY, StorageKeys.SIGNING_PUBLIC_KEY, StorageKeys.ENCRYPTED_SIGNING_PRIVATE_KEY]);
      return unlockKeyBase64;
    }

    if (result.vaultKey.algorithm !== VaultKeyAlgorithm.Aes256Gcm) {
      throw new Error(formatErrorWithCode(`Unsupported Account Key algorithm '${result.vaultKey.algorithm}'`, AppErrorCode.VAULT_VERSION_INCOMPATIBLE));
    }

    const keys = await VaultKeyService.openChain(unlockKeyBase64, result.vaultKey.encryptedAccountKey, result.vaultKey.encryptedVek ?? null, null);
    await VaultKeyService.cacheVaultKeyBlobs(result.vaultKey);
    return keys.accountKey;
  }

  /**
   * Check offline that a key opens the locally cached chain (an account not yet upgraded has none; its key is the vault key).
   * @param unlockKeyBase64 - the unlock key derived from the typed password, or a key restored by PIN or WebAuthn
   * @returns The Account Key to store for this session.
   * @throws Error with {@link AppErrorCode.UNLOCK_KEY_REJECTED} when the key does not open the chain (wrong password).
   */
  public static async verifyUnlockKey(unlockKeyBase64: string): Promise<string> {
    return (await VaultKeyService.openKeyChain(unlockKeyBase64)).accountKey;
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
   * locked. A legacy stored unlock key is replaced by the Account Key here (see LegacyKeyConversion).
   */
  public static async getSessionKeys(): Promise<SessionKeys | null> {
    const accountKey = await VaultKeyService.getSessionAccountKey();
    if (!accountKey) {
      return null;
    }
    const keys = await VaultKeyService.openKeyChain(accountKey);
    await convertLegacySessionKey(accountKey, keys.accountKey);
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
   * unlock key is the vault encryption key.
   * @param unlockKeyBase64 - the Account Key or an unlock key
   * @throws Error with {@link AppErrorCode.UNLOCK_KEY_REJECTED} when the key does not open the chain.
   */
  public static async openKeyChain(unlockKeyBase64: string): Promise<SessionKeys> {
    const storage = getPlatform().storage;
    const [encryptedAccountKey, encryptedVek, encryptedAccountPrivateKey] = await Promise.all([
      storage.get<string>(StorageKeys.ENCRYPTED_ACCOUNT_KEY),
      storage.get<string>(StorageKeys.ENCRYPTED_VEK),
      storage.get<string>(StorageKeys.ENCRYPTED_ACCOUNT_PRIVATE_KEY),
    ]);
    if (!encryptedAccountKey) {
      return { vaultEncryptionKey: unlockKeyBase64, accountPrivateKey: null, accountKey: unlockKeyBase64 };
    }
    return VaultKeyService.openChain(unlockKeyBase64, encryptedAccountKey, encryptedVek, encryptedAccountPrivateKey);
  }

  /**
   * Walk a chain with the Account Key or an unlock key (see the Rust `open_account_key_chain`).
   * @param unlockKeyBase64 - the Account Key or an unlock key
   * @param encryptedAccountKey - the Account Key encrypted with the KEK derived from the unlock key
   * @param encryptedVek - the VEK encrypted with the Account Key
   * @param encryptedAccountPrivateKey - the account private key encrypted with the Account Key, or null when the account has none yet
   */
  private static async openChain(unlockKeyBase64: string, encryptedAccountKey: string, encryptedVek: string | null, encryptedAccountPrivateKey: string | null): Promise<SessionKeys> {
    if (!encryptedVek) {
      throw new Error('Vault key chain is missing the encrypted VEK');
    }

    const opened = await openAccountKeyChain(unlockKeyBase64, encryptedAccountKey, encryptedVek, encryptedAccountPrivateKey);
    switch (opened.status) {
      case 'opened':
        return { vaultEncryptionKey: opened.vaultEncryptionKey, accountPrivateKey: opened.accountPrivateKey, accountKey: opened.accountKey };
      case 'unlockKeyRejected':
        // E-206: the key does not open the account key, which for the password key type means a wrong password.
        throw new Error(formatErrorWithCode('Failed to decrypt key chain', AppErrorCode.UNLOCK_KEY_REJECTED));
      default:
        // E-207: the account key opened, so a failure here is a damaged chain and never a wrong password.
        throw new Error(formatErrorWithCode('Failed to decrypt key chain', AppErrorCode.KEY_CHAIN_UNREADABLE));
    }
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
