import { VaultKeyAlgorithm, type KeyRotationInitiateResponse, type PasswordChangeInitiateResponse, type PasswordChangeRequest } from '@aliasvault/models/webapi';

import { AppErrorCode, extractErrorCode } from '../api/errors/AppErrorCodes';
import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';
import { reencryptAccountKey } from '../rust/RustCore';
import { VaultSyncHoldReason, withVaultSyncHold } from '../sync/VaultSyncHold';

import { SrpAuthService, type SrpClientProof } from './SrpAuthService';
import { VaultKeyService } from './VaultKeyService';

import type { WebApiService } from '../api/WebApiService';
import type { KeyRotationOperationResult } from '../sync/VaultSync';
import type { VaultSyncKeyRotationParams } from '../sync/VaultSyncEngine';
import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';

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
  encryptionType: string;
  encryptionSettings: string;
  srpIdentity?: string;
};

/** The answer to an SRP challenge, plus what the same derivation yields for local key material. */
export type SrpChallengeAnswer = {
  proof: SrpClientProof;
  unlockKeyBase64: string;
  srpIdentity: string;
};

/** Runs the engine's key rotation operation, supplied by the host that owns the engine. */
export type RunKeyRotation = (params: VaultSyncKeyRotationParams) => Promise<KeyRotationOperationResult>;

/**
 * MasterPasswordService handling all master password operations: a password change, optionally together with a rotation of every encryption key.
 */
export class MasterPasswordService {
  /**
   * The derivation parameters of the password this device holds, or null before the first online unlock.
   */
  public static async getStoredDerivationParams(): Promise<UnlockKeyDerivationParams | null> {
    return getPlatform().storage.get<UnlockKeyDerivationParams>(StorageKeys.UNLOCK_KEY_DERIVATION_PARAMS);
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
   * the unlock key it yields comes along for callers that also need to open local key material.
   * @param challenge - the challenge the endpoint's initiate call returned
   * @param password - the master password to prove
   */
  public static async answerSrpChallenge(challenge: SrpChallenge, password: string): Promise<SrpChallengeAnswer> {
    const credentials = await SrpAuthService.prepareCredentials(password, challenge.salt, challenge.encryptionType, challenge.encryptionSettings);

    /*
     * Use srpIdentity from the challenge if available, otherwise fall back to the normalized username.
     * @todo Remove fallback after 0.26.0+ has been released.
     */
    const username = (await getPlatform().storage.get(StorageKeys.USERNAME)) as string | null;
    const srpIdentity = challenge.srpIdentity ?? SrpAuthService.normalizeUsername(username ?? '');

    const proof = await SrpAuthService.deriveClientProof(challenge.salt, srpIdentity, credentials.passwordHashString, challenge.serverEphemeral);
    return { proof, unlockKeyBase64: credentials.unlockKeyBase64, srpIdentity };
  }

  /**
   * Re-encrypt the Account Key for a new password: open it with the old password's KEK, encrypt it with the new one's.
   * @param encryptedAccountKey - the Account Key encrypted with the KEK of the current password
   * @param oldUnlockKeyBase64 - the unlock key of the current password
   * @param newUnlockKeyBase64 - the unlock key of the new password
   * @returns The decrypted Account Key and its new wrapping.
   * @throws {IncorrectPasswordError} when the old unlock key does not open the blob (wrong current password).
   */
  public static async reencryptAccountKey(encryptedAccountKey: string, oldUnlockKeyBase64: string, newUnlockKeyBase64: string): Promise<{ accountKey: string; newEncryptedAccountKey: string }> {
    const reencrypted = await reencryptAccountKey(encryptedAccountKey, oldUnlockKeyBase64, newUnlockKeyBase64);
    if (!reencrypted) {
      throw new IncorrectPasswordError();
    }
    return reencrypted;
  }

  /**
   * Change the master password by re-encrypting the Account Key using the new password's KEK.
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
    if (!storedParams || !await getPlatform().storage.get(StorageKeys.ENCRYPTED_ACCOUNT_KEY)) {
      throw new Error('Password change requires an unlocked account-key vault');
    }

    const challenge = await webApi.get<PasswordChangeInitiateResponse>('Auth/change-password/initiate');
    await MasterPasswordService.assertSaltUnchanged(challenge.salt);

    const current = await MasterPasswordService.answerSrpChallenge(challenge, currentPassword);
    await MasterPasswordService.adoptRaisedSettings(challenge, current.unlockKeyBase64, webApi);
    const encryptedAccountKey = (await getPlatform().storage.get(StorageKeys.ENCRYPTED_ACCOUNT_KEY)) as string;
    const next = await SrpAuthService.prepareNewPassword(newPassword, current.srpIdentity);

    // Re-encrypt the Account Key using the new password's KEK.
    const { accountKey, newEncryptedAccountKey } = await MasterPasswordService.reencryptAccountKey(encryptedAccountKey, current.unlockKeyBase64, next.unlockKeyBase64);

    await webApi.post<PasswordChangeRequest, void>('Auth/change-password', {
      currentClientPublicEphemeral: current.proof.clientPublicEphemeral,
      currentClientSessionProof: current.proof.clientSessionProof,
      newPasswordSalt: next.salt,
      newPasswordVerifier: next.verifier,
      newEncryptedAccountKey,
      newEncryptedAccountKeyAlgorithm: VaultKeyAlgorithm.Aes256Gcm,
      newEncryptionType: next.encryptionType,
      newEncryptionSettings: next.encryptionSettings,
    }, false);

    // Persist the new Account Key and its derivation parameters.
    await VaultKeyService.persistNewAccountKey(newEncryptedAccountKey, { salt: next.salt, encryptionType: next.encryptionType, encryptionSettings: next.encryptionSettings }, accountKey);
  }

  /**
   * Change the master password and rotate every encryption key: a new Account Key, personal vault key, account keypair and
   * signing keypair, with the personal vault re-encrypted and every shared-vault grant rewrapped. The Rust engine does the rotation.
   * @param webApi - the API client to use
   * @param runRotation - runs the engine's rotation operation
   * @param currentPassword - the current master password
   * @param newPassword - the new master password
   * @throws {IncorrectPasswordError} when the current password is wrong (detected locally).
   * @throws {PasswordChangedElsewhereError} when the password was changed on another device.
   * @throws {ApiRequestError} when the server refuses the initiate call.
   */
  public static async changePasswordAndRotateKeys(webApi: WebApiService, runRotation: RunKeyRotation, currentPassword: string, newPassword: string): Promise<KeyRotationOperationResult> {
    return withVaultSyncHold(VaultSyncHoldReason.KeyRotation, () => MasterPasswordService.performRotation(webApi, runRotation, currentPassword, newPassword));
  }

  /**
   * Prove the current password, derive the new unlock method, generate the new account keypair and run the rotation.
   * @param webApi - the API client to use
   * @param runRotation - runs the engine's rotation operation
   * @param currentPassword - the current master password
   * @param newPassword - the new master password
   */
  private static async performRotation(webApi: WebApiService, runRotation: RunKeyRotation, currentPassword: string, newPassword: string): Promise<KeyRotationOperationResult> {
    const storedParams = await MasterPasswordService.getStoredDerivationParams();
    if (!storedParams || !await VaultKeyService.hasLocalVaultKey()) {
      throw new Error('Key rotation requires an unlocked account-key vault');
    }

    const challenge = await webApi.get<KeyRotationInitiateResponse>('KeyRotation/initiate');
    await MasterPasswordService.assertSaltUnchanged(challenge.salt);

    const current = await MasterPasswordService.answerSrpChallenge(challenge, currentPassword);
    await MasterPasswordService.adoptRaisedSettings(challenge, current.unlockKeyBase64, webApi);
    await MasterPasswordService.assertPasswordOpensChain(current.unlockKeyBase64);
    const next = await SrpAuthService.prepareNewPassword(newPassword, current.srpIdentity);

    const result = await runRotation({
      userId: challenge.userId,
      currentClientPublicEphemeral: current.proof.clientPublicEphemeral,
      currentClientSessionProof: current.proof.clientSessionProof,
      accountKeyVersion: challenge.accountKeyVersion,
      manifestKeyVersion: challenge.manifestKeyVersion,
      newUnlockKey: next.unlockKeyBase64,
      newSalt: next.salt,
      newVerifier: next.verifier,
      newEncryptionType: next.encryptionType,
      newEncryptionSettings: next.encryptionSettings,
    });

    if (result.success && result.accountKey) {
      await getPlatform().storage.set(StorageKeys.ACCOUNT_KEY, result.accountKey);
    }
    return result;
  }

  /**
   * When another device raised the key derivation settings since this device cached its chain, cache the server's chain
   * and settings for the unlock key derived under the new settings, so local key material matches the server again.
   * @param challenge - the challenge the unlock key was derived for
   * @param unlockKeyBase64 - the unlock key derived under the challenge's settings
   * @param webApi - the API client to use
   * @throws {IncorrectPasswordError} when the unlock key does not open the server's chain.
   */
  private static async adoptRaisedSettings(challenge: SrpChallenge, unlockKeyBase64: string, webApi: WebApiService): Promise<void> {
    const stored = await MasterPasswordService.getStoredDerivationParams();
    if (!stored || stored.encryptionSettings === challenge.encryptionSettings) {
      return;
    }

    try {
      await VaultKeyService.refreshKeyChain({ unlockKey: unlockKeyBase64 }, webApi);
    } catch (error) {
      if (error instanceof Error && extractErrorCode(error.message) === AppErrorCode.UNLOCK_KEY_REJECTED) {
        throw new IncorrectPasswordError();
      }
      throw error;
    }
    const { salt, encryptionType, encryptionSettings } = challenge;
    await getPlatform().storage.set(StorageKeys.UNLOCK_KEY_DERIVATION_PARAMS, { salt, encryptionType, encryptionSettings });
  }

  /**
   * Check locally that the typed password opens the cached chain, so a wrong password never reaches the server (and the lockout counter).
   * @param unlockKeyBase64 - the unlock key derived from the typed password
   * @throws {IncorrectPasswordError} when it does not.
   */
  private static async assertPasswordOpensChain(unlockKeyBase64: string): Promise<void> {
    try {
      await VaultKeyService.openKeyChain({ unlockKey: unlockKeyBase64 });
    } catch (error) {
      if (error instanceof Error && extractErrorCode(error.message) === AppErrorCode.UNLOCK_KEY_REJECTED) {
        throw new IncorrectPasswordError();
      }
      throw error;
    }
  }
}

export default MasterPasswordService;
