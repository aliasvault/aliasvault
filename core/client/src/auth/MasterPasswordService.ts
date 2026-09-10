import { StorageKeys } from '../constants/StorageKeys';
import { EncryptionUtility } from '../crypto/EncryptionUtility';
import { getPlatform } from '../platform/ClientPlatform';
import { VaultSyncHoldReason, withVaultSyncHold } from '../sync/VaultSyncHold';

import { SrpAuthService, type SrpClientProof } from './SrpAuthService';
import { VaultKeyService } from './VaultKeyService';

import type { WebApiService } from '../api/WebApiService';
import type { EncryptionKeyDerivationParams } from '@aliasvault/models/metadata';
import type { PasswordChangeInitiateResponse, PasswordChangeRequest } from '@aliasvault/models/webapi';

/**
 * Thrown when the entered master password does not decrypt the Account Key.
 */
export class IncorrectPasswordError extends Error {
  /** Creates the error. */
  public constructor() {
    super('Master password is incorrect');
    this.name = 'IncorrectPasswordError';
    Object.setPrototypeOf(this, IncorrectPasswordError.prototype);
  }
}

/**
 * Thrown when the server's salt no longer matches the stored one which indicates that the master password was changed (on another device).
 */
export class PasswordChangedElsewhereError extends Error {
  /** Creates the error. */
  public constructor() {
    super('Password was changed on another device');
    this.name = 'PasswordChangedElsewhereError';
    Object.setPrototypeOf(this, PasswordChangedElsewhereError.prototype);
  }
}

/** The SRP challenge a server endpoint issues before it accepts a password-confirmed action. */
export type SrpChallenge = {
  salt: string;
  serverEphemeral: string;
  encryptionSettings: string;
  srpIdentity?: string;
};

/** The answer to an SRP challenge, plus what the same derivation yields for local key material. */
export type SrpChallengeAnswer = {
  proof: SrpClientProof;
  kekBase64: string;
  srpIdentity: string;
};

/**
 * MasterPasswordService handling all master password operations.
 */
export class MasterPasswordService {
  /**
   * The derivation parameters of the password this device holds, or null before the first online unlock.
   */
  public static async getStoredDerivationParams(): Promise<EncryptionKeyDerivationParams | null> {
    return getPlatform().storage.get<EncryptionKeyDerivationParams>(StorageKeys.ENCRYPTION_KEY_DERIVATION_PARAMS);
  }

  /**
   * Sanity check that a salt the server reports is still the one this device derived its keys from. Unknown on
   * either side passes: there is nothing to compare yet.
   * @param serverSalt - the salt the server currently holds for this account
   * @throws {PasswordChangedElsewhereError} when the salts differ: the password was changed on another device.
   */
  public static async assertSaltUnchanged(serverSalt: string | null | undefined): Promise<void> {
    const stored = await MasterPasswordService.getStoredDerivationParams();
    if (stored && serverSalt && serverSalt !== stored.salt) {
      throw new PasswordChangedElsewhereError();
    }
  }

  /**
   * Answer a server's SRP challenge with the master password. The password goes no further than the derivation;
   * the KEK it yields comes along for callers that also need to open local key material.
   * @param challenge - the challenge the endpoint's initiate call returned
   * @param password - the master password to prove
   */
  public static async answerSrpChallenge(challenge: SrpChallenge, password: string): Promise<SrpChallengeAnswer> {
    const credentials = await SrpAuthService.prepareCredentials(password, challenge.salt, challenge.encryptionSettings);

    /*
     * Use srpIdentity from the challenge if available, otherwise fall back to the normalized username.
     * @todo Remove fallback after 0.26.0+ has been released.
     */
    const username = (await getPlatform().storage.get(StorageKeys.USERNAME)) as string | null;
    const srpIdentity = challenge.srpIdentity ?? SrpAuthService.normalizeUsername(username ?? '');

    const proof = await SrpAuthService.deriveClientProof(challenge.salt, srpIdentity, credentials.passwordHashString, challenge.serverEphemeral);
    return { proof, kekBase64: credentials.passwordHashBase64, srpIdentity };
  }

  /**
   * Re-encrypt the Account Key for a new password: open it with the old KEK, encrypt it with the new one.
   * @param encryptedAccountKey - the Account Key encrypted with the old password-derived KEK
   * @param oldKekBase64 - the KEK derived from the current password
   * @param newKekBase64 - the KEK derived from the new password
   * @returns The decrypted Account Key and its new wrapping.
   * @throws {IncorrectPasswordError} when the old KEK does not open the blob (wrong current password).
   */
  public static async reencryptAccountKey(encryptedAccountKey: string, oldKekBase64: string, newKekBase64: string): Promise<{ accountKey: string; newEncryptedAccountKey: string }> {
    const accountKey = await MasterPasswordService.decryptAccountKey(encryptedAccountKey, oldKekBase64);
    return { accountKey, newEncryptedAccountKey: await EncryptionUtility.encryptVaultEncryptionKey(accountKey, newKekBase64) };
  }

  /**
   * Change the master password by re-encrypting the Account Key using a new KEK.
   * @param webApi - the API client to use
   * @param currentPassword - the current master password
   * @param newPassword - the new master password
   * @throws {IncorrectPasswordError} when the current password is wrong (detected locally).
   * @throws {PasswordChangedElsewhereError} when the password was already changed on another device.
   * @throws {ApiRequestError} when the server rejects the change (e.g. PASSWORD_MISMATCH on a concurrent change).
   */
  public static async changePassword(webApi: WebApiService, currentPassword: string, newPassword: string): Promise<void> {
    // Hold the vault sync to prevent concurrent password changes.
    await withVaultSyncHold(VaultSyncHoldReason.PasswordChange, () => MasterPasswordService.performChange(webApi, currentPassword, newPassword));
  }

  /**
   * Change master password: verify the current password, re-encrypt the Account Key, commit on the server, persist locally.
   * @param webApi - the API client to use
   * @param currentPassword - the current master password
   * @param newPassword - the new master password
   */
  private static async performChange(webApi: WebApiService, currentPassword: string, newPassword: string): Promise<void> {
    const storedParams = await MasterPasswordService.getStoredDerivationParams();
    const encryptedAccountKey = (await getPlatform().storage.get(StorageKeys.ENCRYPTED_ACCOUNT_KEY)) as string | null;
    if (!storedParams || !encryptedAccountKey) {
      throw new Error('Password change requires an unlocked account-key vault');
    }

    const challenge = await webApi.get<PasswordChangeInitiateResponse>('Auth/change-password/initiate');
    await MasterPasswordService.assertSaltUnchanged(challenge.salt);

    const current = await MasterPasswordService.answerSrpChallenge(challenge, currentPassword);
    const next = await SrpAuthService.prepareNewPassword(newPassword, current.srpIdentity);

    // Re-encrypt the Account Key using the new KEK.
    const { newEncryptedAccountKey } = await MasterPasswordService.reencryptAccountKey(encryptedAccountKey, current.kekBase64, next.kekBase64);

    await webApi.post<PasswordChangeRequest, void>('Auth/change-password', {
      currentClientPublicEphemeral: current.proof.clientPublicEphemeral,
      currentClientSessionProof: current.proof.clientSessionProof,
      newPasswordSalt: next.salt,
      newPasswordVerifier: next.verifier,
      newEncryptedAccountKey,
      newEncryptionType: next.encryptionType,
      newEncryptionSettings: next.encryptionSettings,
    }, false);

    // Persist the new Account Key and its derivation parameters.
    await VaultKeyService.persistNewAccountKey(newEncryptedAccountKey, { salt: next.salt, encryptionType: next.encryptionType, encryptionSettings: next.encryptionSettings });
  }

  /**
   * Decrypt the KEK-wrapped Account Key.
   * @param encryptedAccountKey - the Account Key encrypted with the password-derived KEK
   * @param kekBase64 - the KEK derived from the entered password
   */
  private static async decryptAccountKey(encryptedAccountKey: string, kekBase64: string): Promise<string> {
    try {
      return await EncryptionUtility.decryptVaultEncryptionKey(encryptedAccountKey, kekBase64);
    } catch {
      throw new IncorrectPasswordError();
    }
  }
}

export default MasterPasswordService;
