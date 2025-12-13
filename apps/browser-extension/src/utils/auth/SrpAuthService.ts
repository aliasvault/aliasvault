import srp from 'secure-remote-password/client';

import type { TokenModel, LoginResponse, BadRequestResponse } from '@/utils/dist/core/models/webapi';

import { EncryptionUtility } from '../EncryptionUtility';

/**
 * Register request type for creating a new user.
 */
export type RegisterRequest = {
  username: string;
  salt: string;
  verifier: string;
  encryptionType: string;
  encryptionSettings: string;
  /** The SRP identity used for authentication (a random GUID generated at registration). */
  srpIdentity: string;
};

/**
 * Registration result type.
 */
export type RegistrationResult = {
  success: boolean;
  token?: TokenModel;
  error?: string;
};

/**
 * Login credentials prepared from password derivation.
 */
export type PreparedCredentials = {
  /** Password hash as uppercase hex string for SRP */
  passwordHashString: string;
  /** Password hash as base64 string for encryption/decryption */
  passwordHashBase64: string;
};

/**
 * Default encryption settings for Argon2Id.
 * These match the server defaults in AliasVault.Cryptography.Client/Defaults.cs
 */
export const DEFAULT_ENCRYPTION = {
  type: 'Argon2Id',
  settings: JSON.stringify({
    DegreeOfParallelism: 1,
    MemorySize: 19456,
    Iterations: 2,
  }),
} as const;

/**
 * SrpAuthService provides SRP-based authentication utilities.
 *
 * This service handles:
 * - User registration with SRP protocol
 * - Password hashing and key derivation
 * - SRP verifier generation
 *
 * It is designed to be used by both the browser extension UI and E2E tests.
 */
export class SrpAuthService {
  /**
   * Normalizes a username by converting to lowercase and trimming whitespace.
   *
   * @param username - The username to normalize
   * @returns The normalized username
   */
  public static normalizeUsername(username: string): string {
    return username.toLowerCase().trim();
  }

  /**
   * Generates a cryptographically secure SRP salt.
   *
   * @returns A random salt string
   */
  public static generateSalt(): string {
    return srp.generateSalt();
  }

  /**
   * Converts a Uint8Array to an uppercase hex string.
   *
   * @param bytes - The byte array to convert
   * @returns Uppercase hex string
   */
  public static bytesToHexString(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  /**
   * Converts a Uint8Array to a base64 string.
   *
   * @param bytes - The byte array to convert
   * @returns Base64 string
   */
  public static bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
  }

  /**
   * Derives an SRP private key from credentials.
   *
   * @param salt - The SRP salt
   * @param username - The normalized username
   * @param passwordHashString - The password hash as uppercase hex string
   * @returns The SRP private key
   */
  public static derivePrivateKey(
    salt: string,
    username: string,
    passwordHashString: string
  ): string {
    return srp.derivePrivateKey(salt, SrpAuthService.normalizeUsername(username), passwordHashString);
  }

  /**
   * Derives an SRP verifier from a private key.
   *
   * @param privateKey - The SRP private key
   * @returns The SRP verifier
   */
  public static deriveVerifier(privateKey: string): string {
    return srp.deriveVerifier(privateKey);
  }

  /**
   * Generates an SRP ephemeral key pair for client-side authentication.
   *
   * @returns Object containing public and secret ephemeral values
   */
  public static generateEphemeral(): { public: string; secret: string } {
    return srp.generateEphemeral();
  }

  /**
   * Derives an SRP session from the authentication exchange.
   *
   * @param clientSecretEphemeral - Client's secret ephemeral value
   * @param serverPublicEphemeral - Server's public ephemeral value
   * @param salt - The SRP salt
   * @param username - The normalized username
   * @param privateKey - The SRP private key
   * @returns The SRP session containing proof and key
   */
  public static deriveSession(
    clientSecretEphemeral: string,
    serverPublicEphemeral: string,
    salt: string,
    username: string,
    privateKey: string
  ): { proof: string; key: string } {
    return srp.deriveSession(
      clientSecretEphemeral,
      serverPublicEphemeral,
      salt,
      SrpAuthService.normalizeUsername(username),
      privateKey
    );
  }

  /**
   * Prepares login credentials by deriving the password hash.
   *
   * This method derives the encryption key from the password using the
   * encryption parameters from the login initiate response.
   *
   * @param password - The user's password
   * @param salt - The salt from login initiate response
   * @param encryptionType - The encryption type (e.g., 'Argon2Id')
   * @param encryptionSettings - The encryption settings JSON string
   * @returns Prepared credentials with hash in both hex and base64 formats
   */
  public static async prepareCredentials(
    password: string,
    salt: string,
    encryptionType: string,
    encryptionSettings: string
  ): Promise<PreparedCredentials> {
    // Derive key from password using Argon2Id
    const passwordHash = await EncryptionUtility.deriveKeyFromPassword(
      password,
      salt,
      encryptionType,
      encryptionSettings
    );

    return {
      passwordHashString: SrpAuthService.bytesToHexString(passwordHash),
      passwordHashBase64: SrpAuthService.bytesToBase64(passwordHash),
    };
  }

  /**
   * Generates a random UUID v4 for use as SRP identity.
   *
   * @returns A random UUID string
   */
  public static generateSrpIdentity(): string {
    return crypto.randomUUID();
  }

  /**
   * Prepares SRP registration data for a new user.
   *
   * This generates all the cryptographic values needed to register a user:
   * - Salt for key derivation
   * - Verifier for SRP authentication
   * - SRP identity (random GUID) for immutable authentication identity
   *
   * @param username - The username for registration
   * @param password - The password for registration
   * @returns Registration request data ready to send to the API
   */
  public static async prepareRegistration(
    username: string,
    password: string
  ): Promise<RegisterRequest> {
    const normalizedUsername = SrpAuthService.normalizeUsername(username);
    const salt = SrpAuthService.generateSalt();

    /**
     * Generate a random GUID for SRP identity. This is used for all SRP operations,
     * is set during registration, and never changes.
     */
    const srpIdentity = SrpAuthService.generateSrpIdentity();

    // Derive key from password using default Argon2Id settings
    const credentials = await SrpAuthService.prepareCredentials(
      password,
      salt,
      DEFAULT_ENCRYPTION.type,
      DEFAULT_ENCRYPTION.settings
    );

    // Generate SRP private key and verifier using srpIdentity (not username)
    const privateKey = SrpAuthService.derivePrivateKey(salt, srpIdentity, credentials.passwordHashString);
    const verifier = SrpAuthService.deriveVerifier(privateKey);

    return {
      username: normalizedUsername,
      salt,
      verifier,
      encryptionType: DEFAULT_ENCRYPTION.type,
      encryptionSettings: DEFAULT_ENCRYPTION.settings,
      srpIdentity,
    };
  }

  /**
   * Registers a new user via the API.
   *
   * @param apiBaseUrl - The base URL of the API (e.g., 'http://localhost:5092')
   * @param username - The username for the new account
   * @param password - The password for the new account
   * @returns Registration result with token on success
   */
  public static async registerUser(
    apiBaseUrl: string,
    username: string,
    password: string
  ): Promise<RegistrationResult> {
    try {
      // Prepare registration data
      const registerRequest = await SrpAuthService.prepareRegistration(username, password);

      // Normalize the API URL
      const baseUrl = apiBaseUrl.replace(/\/$/, '') + '/v1/';

      // Send registration request to API
      const response = await fetch(`${baseUrl}Auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(registerRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Registration failed with status ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText) as BadRequestResponse;
          errorMessage = errorJson.title || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        return { success: false, error: errorMessage };
      }

      const tokenModel = (await response.json()) as TokenModel;
      return { success: true, token: tokenModel };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Performs the full SRP login flow.
   *
   * @param apiBaseUrl - The base URL of the API
   * @param username - The username
   * @param password - The password
   * @param rememberMe - Whether to request extended token lifetime
   * @returns Login result with tokens and encryption key
   */
  public static async login(
    apiBaseUrl: string,
    username: string,
    password: string,
    rememberMe: boolean = false
  ): Promise<{
    success: boolean;
    token?: TokenModel;
    passwordHashBase64?: string;
    loginResponse?: LoginResponse;
    requiresTwoFactor?: boolean;
    error?: string;
  }> {
    try {
      const baseUrl = apiBaseUrl.replace(/\/$/, '') + '/v1/';
      const normalizedUsername = SrpAuthService.normalizeUsername(username);

      // Step 1: Initiate login
      const initiateResponse = await fetch(`${baseUrl}Auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: normalizedUsername }),
      });

      if (!initiateResponse.ok) {
        const errorText = await initiateResponse.text();
        try {
          const errorJson = JSON.parse(errorText) as BadRequestResponse;
          return { success: false, error: errorJson.title };
        } catch {
          return { success: false, error: errorText || 'Login initiation failed' };
        }
      }

      const loginResponse = (await initiateResponse.json()) as LoginResponse;

      /**
       * Use srpIdentity from server response if available, otherwise fall back to normalized username.
       * Note: the fallback can be removed in the future after 0.26.0+ is deployed.
       */
      const srpIdentity = loginResponse.srpIdentity ?? normalizedUsername;

      // Step 2: Prepare credentials
      const credentials = await SrpAuthService.prepareCredentials(
        password,
        loginResponse.salt,
        loginResponse.encryptionType,
        loginResponse.encryptionSettings
      );

      // Step 3: Generate SRP session using srpIdentity (not the typed username)
      const clientEphemeral = SrpAuthService.generateEphemeral();
      const privateKey = SrpAuthService.derivePrivateKey(
        loginResponse.salt,
        srpIdentity,
        credentials.passwordHashString
      );
      const session = SrpAuthService.deriveSession(
        clientEphemeral.secret,
        loginResponse.serverEphemeral,
        loginResponse.salt,
        srpIdentity,
        privateKey
      );

      // Step 4: Validate login
      const validateResponse = await fetch(`${baseUrl}Auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: normalizedUsername,
          rememberMe,
          clientPublicEphemeral: clientEphemeral.public,
          clientSessionProof: session.proof,
        }),
      });

      if (!validateResponse.ok) {
        const errorText = await validateResponse.text();
        try {
          const errorJson = JSON.parse(errorText) as BadRequestResponse;
          return { success: false, error: errorJson.title };
        } catch {
          return { success: false, error: errorText || 'Login validation failed' };
        }
      }

      const validateResult = await validateResponse.json();

      // Check for 2FA requirement
      if (validateResult.requiresTwoFactor) {
        return {
          success: false,
          requiresTwoFactor: true,
          loginResponse,
          passwordHashBase64: credentials.passwordHashBase64,
        };
      }

      return {
        success: true,
        token: validateResult.token,
        passwordHashBase64: credentials.passwordHashBase64,
        loginResponse,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}

export default SrpAuthService;
