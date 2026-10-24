import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';
import { logExpected } from '../utilities/Diagnostics';

import { KeyDerivationUpgradeService } from './KeyDerivationUpgradeService';
import { MasterPasswordService } from './MasterPasswordService';
import { SrpAuthService } from './SrpAuthService';
import { SrpLoginService } from './SrpLoginService';
import { VaultKeyService, type KeyChainKey } from './VaultKeyService';

import type { WebApiService } from '../api/WebApiService';
import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';

/**
 * Thrown by an offline password check when this device holds no derivation parameters from an earlier online login.
 */
export class MissingDerivationParamsError extends Error {
  /** Creates the error. */
  public constructor() {
    super('No stored unlock key derivation parameters');
    this.name = 'MissingDerivationParamsError';
    Object.setPrototypeOf(this, MissingDerivationParamsError.prototype);
  }
}

/** How {@link UnlockService.unlockWithPassword} reaches the server. */
export type PasswordUnlockOptions = {
  /** Unlock against the server's key chain (true) or the locally cached one (false). */
  online: boolean;
  /** The API client, required when online. */
  webApi?: WebApiService;
  /** The account to unlock; defaults to the stored username. */
  username?: string;
};

/**
 * The master password unlock and login completion flows, shared by every host.
 */
export class UnlockService {
  /**
   * Check a master password offline: stored derivation parameters, derive the unlock key, open the cached key chain.
   * @param password - the master password
   * @returns The Account Key.
   * @throws {MissingDerivationParamsError} when no derivation parameters are stored.
   * @throws Error with AppErrorCode.UNLOCK_KEY_REJECTED (E-206) on a wrong password.
   */
  public static async verifyPasswordOffline(password: string): Promise<string> {
    const params = await MasterPasswordService.getStoredDerivationParams();
    if (!params) {
      throw new MissingDerivationParamsError();
    }

    const unlockKey = await SrpAuthService.deriveUnlockKey(password, params.salt, params.encryptionSettings);
    return VaultKeyService.verifyUnlockKey(unlockKey);
  }

  /**
   * Unlock with the master password, online against the server's key chain or offline against the cached one. The
   * caller stores the returned Account Key.
   * @param password - the master password
   * @param options - online or offline, and the API client for the online path
   * @returns The Account Key.
   * @throws {MissingDerivationParamsError} offline, when no derivation parameters are stored.
   * @throws Error with AppErrorCode.UNLOCK_KEY_REJECTED (E-206) on a wrong password.
   */
  public static async unlockWithPassword(password: string, options: PasswordUnlockOptions): Promise<string> {
    if (!options.online) {
      return UnlockService.verifyPasswordOffline(password);
    }
    if (!options.webApi) {
      throw new Error('An online unlock needs an API client');
    }

    const username = options.username ?? await getPlatform().storage.get<string>(StorageKeys.USERNAME);
    const loginResponse = await new SrpLoginService(options.webApi).initiateLogin(username!);
    const unlockKey = await SrpAuthService.deriveUnlockKey(password, loginResponse.salt, loginResponse.encryptionSettings);
    await UnlockService.storeDerivationParams(loginResponse);
    const accountKey = await VaultKeyService.refreshKeyChain({ unlockKey }, options.webApi);
    await UnlockService.upgradeKeyDerivation(password, loginResponse, unlockKey, options.webApi, username!);
    return accountKey;
  }

  /**
   * Finish an accepted login: fetch and check the key chain, then store the derivation parameters and the Account Key.
   * @param key - the unlock key of the login, or the Account Key a mobile app sent
   * @param derivationParams - the derivation parameters of the account's password
   * @param webApi - the API client, already holding the new session's tokens
   * @param onKeyChainFailure - ends the session when the key chain cannot be opened, before the error is rethrown
   * @returns The Account Key.
   */
  public static async completeKeyChainLogin(key: KeyChainKey, derivationParams: UnlockKeyDerivationParams, webApi: WebApiService, onKeyChainFailure?: () => Promise<void>): Promise<string> {
    let accountKey: string;
    try {
      accountKey = await VaultKeyService.refreshKeyChain(key, webApi);
    } catch (err) {
      await onKeyChainFailure?.();
      throw err;
    }

    await UnlockService.storeDerivationParams(derivationParams);
    await getPlatform().storage.set(StorageKeys.ACCOUNT_KEY, accountKey);
    return accountKey;
  }

  /**
   * After a password login, raise the key derivation settings to the defaults when they are below them. A failure is
   * logged and ignored: the login already succeeded and the next one tries again.
   * @param password - the master password the user logged in with
   * @param derivationParams - the derivation parameters the login used
   * @param unlockKeyBase64 - the unlock key the login derived
   * @param webApi - the API client, holding the new session's tokens
   * @param username - the username, the SRP identity fallback for older servers
   */
  public static async upgradeKeyDerivation(password: string, derivationParams: UnlockKeyDerivationParams, unlockKeyBase64: string, webApi: WebApiService, username: string): Promise<void> {
    if (!KeyDerivationUpgradeService.needsUpgrade(derivationParams.encryptionSettings)) {
      return;
    }

    try {
      const encryptedAccountKey = await getPlatform().storage.get<string>(StorageKeys.ENCRYPTED_ACCOUNT_KEY);
      if (!encryptedAccountKey) {
        return;
      }

      const result = await KeyDerivationUpgradeService.upgradeIfNeeded({
        webApi,
        params: derivationParams,
        unlockKeyBase64,
        encryptedAccountKey,
        /** Derives with the password the user logged in with. */
        deriveUnlockKey: (salt, encryptionSettings) => SrpAuthService.deriveUnlockKey(password, salt, encryptionSettings),
        username,
      });
      if (result) {
        await VaultKeyService.persistNewAccountKey(result.newEncryptedAccountKey, result.params, result.accountKey);
      }
    } catch (err) {
      logExpected('Key derivation upgrade failed', err);
    }
  }

  /**
   * Store the derivation parameters for offline unlock and local password checks.
   */
  private static async storeDerivationParams(params: UnlockKeyDerivationParams): Promise<void> {
    const { salt, encryptionType, encryptionSettings } = params;
    await getPlatform().storage.set(StorageKeys.UNLOCK_KEY_DERIVATION_PARAMS, { salt, encryptionType, encryptionSettings });
  }
}

export default UnlockService;
