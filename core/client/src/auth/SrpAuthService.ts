import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';
import { argon2DeriveKey, createAccountKeyHierarchy, rustCore } from '../rust/RustCore';
import { bytesToBase64 } from '../utilities/Base64';

import { assertNotWeakerDerivation } from './DerivationSettings';

import type { AccountKeyBlobs, AccountKeyHierarchy, SrpEphemeral, SrpSession } from '../rust/RustCoreTypes';
import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';
import type { LegacySrpVerifierUpgrade, LoginResponse } from '@aliasvault/models/webapi';

/**
 * The register request body: the SRP credentials and the account key hierarchy.
 */
export type RegisterRequest = AccountKeyBlobs & {
  username: string;
  salt: string;
  verifier: string;
  encryptionType: string;
  encryptionSettings: string;
  srpIdentity: string;
};

/**
 * Prepared registration data: the request payload plus the key material the caller must keep client-side.
 */
export type PreparedRegistration = {
  request: RegisterRequest;
  keys: AccountKeyHierarchy;
  unlockKey: string;
};

/**
 * The client's SRP proof as sent in a request body.
 */
export type SrpClientProof = {
  clientPublicEphemeral: string;
  clientSessionProof: string;
};

/**
 * A client proof plus the session key that checks the server's proof; the key never leaves the client.
 */
export type SrpClientSession = {
  proof: SrpClientProof;
  sessionKey: string;
};

/**
 * What a password derives for a login.
 */
export type PreparedCredentials = {
  /** The SRP password hash (uppercase hex) for the account's encryption type. */
  passwordHashString: string;
  /** The unlock key (base64): the Argon2id output of the password. */
  unlockKeyBase64: string;
  /** Set when the account still has a legacy verifier, see {@link LegacySrpVerifierUpgrade}. */
  legacyVerifierUpgrade?: LegacySrpVerifierUpgrade;
};

/**
 * What a login proof is made from: the SRP password hash and, for a legacy verifier, its upgrade.
 */
export type LoginCredentials = Pick<PreparedCredentials, 'passwordHashString' | 'legacyVerifierUpgrade'>;

/**
 * What a new master password needs on both sides: what the server stores to verify it, and the unlock key it derives.
 */
export type NewPasswordMaterial = {
  salt: string;
  verifier: string;
  encryptionType: string;
  encryptionSettings: string;
  unlockKeyBase64: string;
};

/**
 * The encryption type of a verifier made from the unlock key itself, created before the SRP input was split off.
 */
export const LEGACY_ENCRYPTION_TYPE = 'Argon2Id';

/**
 * Default Argon2Id settings for a newly derived unlock key. The type derives the SRP input and the KEK from it with HKDF.
 */
export const DEFAULT_ENCRYPTION = {
  type: 'Argon2IdHkdf',
  settings: JSON.stringify({
    DegreeOfParallelism: 1,
    MemorySize: 65536,
    Iterations: 5,
  }),
} as const;

/**
 * SRP registration, login proofs and unlock key derivation, on top of the Rust core.
 */
export class SrpAuthService {
  /**
   * Lowercases and trims a username.
   * @param username - The username to normalize
   */
  public static normalizeUsername(username: string): string {
    return username.toLowerCase().trim();
  }

  /**
   * A random SRP salt (uppercase hex).
   */
  public static async generateSalt(): Promise<string> {
    return rustCore().srpGenerateSalt();
  }

  /**
   * The SRP private key (uppercase hex).
   * @param salt - The SRP salt
   * @param username - The username or SRP identity
   * @param passwordHashString - The SRP password hash (uppercase hex)
   */
  public static async derivePrivateKey(salt: string, username: string, passwordHashString: string): Promise<string> {
    return rustCore().srpDerivePrivateKey(salt, SrpAuthService.normalizeUsername(username), passwordHashString);
  }

  /**
   * The SRP verifier (uppercase hex) of a private key.
   * @param privateKey - The SRP private key
   */
  public static async deriveVerifier(privateKey: string): Promise<string> {
    return rustCore().srpDeriveVerifier(privateKey);
  }

  /**
   * A client ephemeral pair (uppercase hex).
   */
  public static async generateEphemeral(): Promise<SrpEphemeral> {
    return rustCore().srpGenerateEphemeral();
  }

  /**
   * The client session (proof and key, uppercase hex) from the server's public ephemeral.
   * @param clientSecretEphemeral - Client's secret ephemeral value
   * @param serverPublicEphemeral - Server's public ephemeral value
   * @param salt - The SRP salt
   * @param username - The username or SRP identity
   * @param privateKey - The SRP private key
   */
  public static async deriveSession(clientSecretEphemeral: string, serverPublicEphemeral: string, salt: string, username: string, privateKey: string): Promise<SrpSession> {
    return rustCore().srpDeriveSession(clientSecretEphemeral, serverPublicEphemeral, salt, SrpAuthService.normalizeUsername(username), privateKey);
  }

  /**
   * The client's SRP proof for one server-verified master password check.
   * @param salt - The SRP salt from the initiate response
   * @param srpIdentity - The SRP identity from the initiate response
   * @param passwordHashString - The SRP password hash (uppercase hex)
   * @param serverEphemeral - The server's public ephemeral from the initiate response
   */
  public static async deriveClientProof(salt: string, srpIdentity: string, passwordHashString: string, serverEphemeral: string): Promise<SrpClientProof> {
    return (await SrpAuthService.deriveClientSession(salt, srpIdentity, passwordHashString, serverEphemeral)).proof;
  }

  /**
   * The client's SRP proof and the session key, for exchanges where the server's proof is checked.
   * @param salt - The SRP salt from the initiate response
   * @param srpIdentity - The SRP identity from the initiate response
   * @param passwordHashString - The password hash as uppercase hex string
   * @param serverEphemeral - The server's public ephemeral from the initiate response
   * @returns The proof to submit and the session key to verify the server's proof with
   */
  public static async deriveClientSession(salt: string, srpIdentity: string, passwordHashString: string, serverEphemeral: string): Promise<SrpClientSession> {
    const clientEphemeral = await SrpAuthService.generateEphemeral();
    const privateKey = await SrpAuthService.derivePrivateKey(salt, srpIdentity, passwordHashString);
    const session = await SrpAuthService.deriveSession(clientEphemeral.secret, serverEphemeral, salt, srpIdentity, privateKey);

    return { proof: { clientPublicEphemeral: clientEphemeral.public, clientSessionProof: session.proof }, sessionKey: session.key };
  }

  /**
   * Checks the server's session proof (M2), which confirms the server holds the verifier for this password.
   * @param session - The client session the request was sent with
   * @param serverSessionProof - The server's proof from the validate response
   * @throws {Error} when the proof does not match
   */
  public static async verifyServerProof(session: SrpClientSession, serverSessionProof: string): Promise<void> {
    const valid = await rustCore().srpVerifySession(session.proof.clientPublicEphemeral, session.proof.clientSessionProof, session.sessionKey, serverSessionProof);
    if (!valid) {
      throw new Error('Server session proof verification failed.');
    }
  }

  /**
   * The client's SRP proof and session key for a login initiate response.
   * @param loginResponse - The login initiate response holding salt, SRP identity and server ephemeral
   * @param username - The username typed by the user, the SRP identity fallback on older servers
   * @param passwordHashString - The SRP password hash (uppercase hex)
   */
  public static async deriveLoginSession(loginResponse: LoginResponse, username: string, passwordHashString: string): Promise<SrpClientSession> {
    // LEGACY: servers before 0.26.0 send no SRP identity. TODO: remove the fallback once the minimum server is 0.26.0+.
    const srpIdentity = loginResponse.srpIdentity ?? SrpAuthService.normalizeUsername(username);

    return SrpAuthService.deriveClientSession(loginResponse.salt, srpIdentity, passwordHashString, loginResponse.serverEphemeral);
  }

  /**
   * Derive the unlock key (the Argon2id output, base64) from the password. Refuses settings weaker than those this
   * device already derived with.
   * @param password - The user's password
   * @param salt - The account's salt
   * @param encryptionSettings - The encryption settings JSON string
   * @returns The unlock key (base64)
   * @throws Error with {@link AppErrorCode.UNLOCK_SETTINGS_WEAKENED} when the settings are weaker than the stored ones.
   */
  public static async deriveUnlockKey(password: string, salt: string, encryptionSettings: string): Promise<string> {
    const stored = await getPlatform().storage.get<UnlockKeyDerivationParams>(StorageKeys.UNLOCK_KEY_DERIVATION_PARAMS);
    if (stored) {
      assertNotWeakerDerivation(encryptionSettings, stored.encryptionSettings);
    }
    return bytesToBase64(await argon2DeriveKey(password, salt, encryptionSettings));
  }

  /**
   * Derive the unlock key from the password and the SRP password hash the account's encryption type makes from it.
   * @param password - The user's password
   * @param salt - The salt from the server's challenge
   * @param encryptionType - The encryption type from the server's challenge
   * @param encryptionSettings - The encryption settings JSON string
   * @returns The SRP password hash (hex) and the unlock key (base64)
   */
  public static async prepareCredentials(password: string, salt: string, encryptionType: string, encryptionSettings: string): Promise<PreparedCredentials> {
    const unlockKeyBase64 = await SrpAuthService.deriveUnlockKey(password, salt, encryptionSettings);
    return { passwordHashString: await SrpAuthService.srpPasswordHash(unlockKeyBase64, encryptionType), unlockKeyBase64 };
  }

  /**
   * The SRP password hash (uppercase hex) an account's encryption type makes from an unlock key.
   * @param unlockKeyBase64 - The unlock key (base64), the Argon2id output of the password
   * @param encryptionType - The encryption type from the server's challenge
   * @returns The SRP password hash
   */
  public static async srpPasswordHash(unlockKeyBase64: string, encryptionType: string): Promise<string> {
    return rustCore().deriveSrpPasswordHash(unlockKeyBase64, encryptionType);
  }

  /**
   * {@link prepareCredentials} for a login: an account that still has a legacy verifier also gets its upgrade.
   * @param password - The user's password
   * @param loginResponse - The login initiate response
   * @param username - The username typed by the user, the SRP identity fallback on older servers
   */
  public static async prepareLoginCredentials(password: string, loginResponse: LoginResponse, username: string): Promise<PreparedCredentials> {
    const unlockKeyBase64 = await SrpAuthService.deriveUnlockKey(password, loginResponse.salt, loginResponse.encryptionSettings);
    return SrpAuthService.loginCredentials(unlockKeyBase64, loginResponse, username);
  }

  /**
   * The login credentials of an unlock key derived elsewhere (natively on mobile), see {@link prepareLoginCredentials}.
   * @param unlockKeyBase64 - The unlock key (base64), the Argon2id output of the password
   * @param loginResponse - The login initiate response
   * @param username - The username typed by the user, the SRP identity fallback on older servers
   */
  public static async loginCredentials(unlockKeyBase64: string, loginResponse: LoginResponse, username: string): Promise<PreparedCredentials> {
    const credentials: PreparedCredentials = { passwordHashString: await SrpAuthService.srpPasswordHash(unlockKeyBase64, loginResponse.encryptionType), unlockKeyBase64 };
    if (loginResponse.encryptionType !== LEGACY_ENCRYPTION_TYPE) {
      return credentials;
    }

    const srpIdentity = loginResponse.srpIdentity ?? SrpAuthService.normalizeUsername(username);
    const upgradedHash = await SrpAuthService.srpPasswordHash(unlockKeyBase64, DEFAULT_ENCRYPTION.type);
    const srpVerifier = await SrpAuthService.deriveVerifier(await SrpAuthService.derivePrivateKey(loginResponse.salt, srpIdentity, upgradedHash));
    return { ...credentials, legacyVerifierUpgrade: { srpVerifier, encryptionType: DEFAULT_ENCRYPTION.type } };
  }

  /**
   * A random UUID v4 as SRP identity.
   */
  public static generateSrpIdentity(): string {
    return crypto.randomUUID();
  }

  /**
   * Derive what a new master password needs: a fresh salt, the SRP verifier and the unlock key, with the default
   * Argon2id settings.
   * @param password - the new master password
   * @param srpIdentity - the account's SRP identity the verifier is bound to
   */
  public static async prepareNewPassword(password: string, srpIdentity: string): Promise<NewPasswordMaterial> {
    const salt = await SrpAuthService.generateSalt();
    const unlockKeyBase64 = bytesToBase64(await argon2DeriveKey(password, salt, DEFAULT_ENCRYPTION.settings));
    const privateKey = await SrpAuthService.derivePrivateKey(salt, srpIdentity, await SrpAuthService.srpPasswordHash(unlockKeyBase64, DEFAULT_ENCRYPTION.type));
    const verifier = await SrpAuthService.deriveVerifier(privateKey);
    return { salt, verifier, encryptionType: DEFAULT_ENCRYPTION.type, encryptionSettings: DEFAULT_ENCRYPTION.settings, unlockKeyBase64 };
  }

  /**
   * Prepare a registration: a fresh salt, verifier and SRP identity, and the account key hierarchy.
   * @param username - The username for registration
   * @param password - The password for registration
   * @returns The request body plus the key material the client keeps
   */
  public static async prepareRegistration(username: string, password: string): Promise<PreparedRegistration> {
    const normalizedUsername = SrpAuthService.normalizeUsername(username);
    const srpIdentity = SrpAuthService.generateSrpIdentity();
    const material = await SrpAuthService.prepareNewPassword(password, srpIdentity);
    const hierarchy = await createAccountKeyHierarchy(material.unlockKeyBase64);

    return {
      request: {
        username: normalizedUsername,
        salt: material.salt,
        verifier: material.verifier,
        encryptionType: material.encryptionType,
        encryptionSettings: material.encryptionSettings,
        srpIdentity,
        ...hierarchy.accountKeys,
      },
      keys: hierarchy,
      unlockKey: material.unlockKeyBase64,
    };
  }
}

export default SrpAuthService;
