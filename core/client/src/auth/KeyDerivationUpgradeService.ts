import { VaultKeyAlgorithm, type KeyDerivationUpgradeRequest, type PasswordChangeInitiateResponse } from '@aliasvault/models/webapi';

import { isWeakerDerivation } from './DerivationSettings';
import { MasterPasswordService } from './MasterPasswordService';
import { DEFAULT_ENCRYPTION, SrpAuthService } from './SrpAuthService';

import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';

/** The API calls the upgrade makes; both the shared and the mobile API client provide them. */
export type KeyDerivationUpgradeApi = {
  get<T>(endpoint: string): Promise<T>;
  post<TRequest, TResponse>(endpoint: string, data: TRequest, parseJson?: boolean): Promise<TResponse>;
};

/** What a host passes in right after a password login. */
export type KeyDerivationUpgradeInput = {
  /** The API client, holding the new session's tokens. */
  webApi: KeyDerivationUpgradeApi;
  /** The derivation parameters the login used. */
  params: UnlockKeyDerivationParams;
  /** The unlock key the login derived. */
  unlockKeyBase64: string;
  /** The Account Key encrypted with the KEK of that unlock key. */
  encryptedAccountKey: string;
  /** Derives the unlock key from the master password under the given salt and settings. */
  deriveUnlockKey: (salt: string, encryptionSettings: string) => Promise<string>;
  /** The username, the SRP identity fallback for older servers. */
  username: string;
};

/** The password's new derivation parameters and unlock key, for the host to store like after a login. */
export type KeyDerivationUpgradeResult = {
  params: UnlockKeyDerivationParams;
  unlockKeyBase64: string;
  newEncryptedAccountKey: string;
  accountKey: string;
};

/**
 * Raises the key derivation settings of an account created before the current defaults, right after a password login.
 * The password and salt stay the same, so other devices are not affected. The new settings are always the client's own
 * defaults, never settings the server suggests.
 */
export class KeyDerivationUpgradeService {
  /**
   * Whether settings ask for less memory or fewer iterations than the defaults.
   * @param encryptionSettings - the settings JSON the account's password uses
   */
  public static needsUpgrade(encryptionSettings: string): boolean {
    return isWeakerDerivation(encryptionSettings, DEFAULT_ENCRYPTION.settings);
  }

  /**
   * Upgrade the settings when they are below the defaults.
   * @param input - the login's key material and the host's derivation function
   * @returns The new parameters and keys, or null when no upgrade was needed or the account changed meanwhile.
   */
  public static async upgradeIfNeeded(input: KeyDerivationUpgradeInput): Promise<KeyDerivationUpgradeResult | null> {
    const { webApi, params, unlockKeyBase64, encryptedAccountKey } = input;
    if (!KeyDerivationUpgradeService.needsUpgrade(params.encryptionSettings)) {
      return null;
    }

    const challenge = await webApi.get<PasswordChangeInitiateResponse>('Auth/key-derivation-upgrade/initiate');
    if (challenge.salt !== params.salt || challenge.encryptionSettings !== params.encryptionSettings) {
      return null;
    }

    const srpIdentity = challenge.srpIdentity ?? SrpAuthService.normalizeUsername(input.username);
    const currentHash = await SrpAuthService.srpPasswordHash(unlockKeyBase64, challenge.encryptionType);
    const proof = await SrpAuthService.deriveClientProof(challenge.salt, srpIdentity, currentHash, challenge.serverEphemeral);

    const newUnlockKeyBase64 = await input.deriveUnlockKey(params.salt, DEFAULT_ENCRYPTION.settings);
    const newHash = await SrpAuthService.srpPasswordHash(newUnlockKeyBase64, DEFAULT_ENCRYPTION.type);
    const newVerifier = await SrpAuthService.deriveVerifier(await SrpAuthService.derivePrivateKey(params.salt, srpIdentity, newHash));
    const { accountKey, newEncryptedAccountKey } = await MasterPasswordService.reencryptAccountKey(encryptedAccountKey, unlockKeyBase64, newUnlockKeyBase64);

    await webApi.post<KeyDerivationUpgradeRequest, void>('Auth/key-derivation-upgrade', {
      currentClientPublicEphemeral: proof.clientPublicEphemeral,
      currentClientSessionProof: proof.clientSessionProof,
      newPasswordVerifier: newVerifier,
      newEncryptedAccountKey,
      newEncryptedAccountKeyAlgorithm: VaultKeyAlgorithm.Aes256Gcm,
      newEncryptionType: DEFAULT_ENCRYPTION.type,
      newEncryptionSettings: DEFAULT_ENCRYPTION.settings,
    }, false);

    return {
      params: { salt: params.salt, encryptionType: DEFAULT_ENCRYPTION.type, encryptionSettings: DEFAULT_ENCRYPTION.settings },
      unlockKeyBase64: newUnlockKeyBase64,
      newEncryptedAccountKey,
      accountKey,
    };
  }
}

export default KeyDerivationUpgradeService;
