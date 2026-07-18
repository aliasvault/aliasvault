import type { LoginResponse, ValidateLoginRequest2Fa, ValidateLoginResponse, BadRequestResponse } from '@/utils/dist/core/models/webapi';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import { WebApiService } from '@/utils/WebApiService';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * An SRP client proof for authenticating against the server: the client public ephemeral
 * and the session proof (M1), both uppercase hex strings.
 */
export type SrpClientProof = {
  clientPublicEphemeral: string;
  clientSessionProof: string;
};

/**
 * Utility class for SRP login and validation operations.
 * Uses native Rust SRP implementation via NativeVaultManager.
 */
export class SrpUtility {
  private webApiService: WebApiService;

  /**
   * Constructor
   */
  public constructor(webApiService: WebApiService) {
    this.webApiService = webApiService;
  }

  /**
   * Derive an SRP client proof to authenticate against the server with the current password.
   *
   * Wraps the native Rust SRP primitives (generate ephemeral, derive private key, derive session)
   * that are shared used in multiple places.
   * 
   * @param salt The user's SRP salt (uppercase hex).
   * @param identity The SRP identity (srpIdentity from the server, or the username).
   * @param passwordHashHex The Argon2id-derived password hash as uppercase hex.
   * @param serverEphemeral The server's public ephemeral from the initiate response.
   * @returns The client public ephemeral and session proof to send to the server.
   */
  public static async deriveClientProof(
    salt: string,
    identity: string,
    passwordHashHex: string,
    serverEphemeral: string
  ): Promise<SrpClientProof> {
    const clientEphemeral = await NativeVaultManager.srpGenerateEphemeral();
    const privateKey = await NativeVaultManager.srpDerivePrivateKey(salt, identity, passwordHashHex);
    const session = await NativeVaultManager.srpDeriveSession(
      clientEphemeral.secret,
      serverEphemeral,
      salt,
      identity,
      privateKey
    );
    return {
      clientPublicEphemeral: clientEphemeral.public,
      clientSessionProof: session.proof,
    };
  }

  /**
   * Generate a fresh 32-byte SRP salt as an uppercase hex string (for a new/changed password).
   * @returns The generated salt.
   */
  public static async generateSalt(): Promise<string> {
    return NativeVaultManager.srpGenerateSalt();
  }

  /**
   * Derive the SRP verifier for a (new) password: the value the server stores to authenticate
   * future logins. Used when registering or changing a password.
   * @param salt The salt the new password hash was derived against (uppercase hex).
   * @param identity The SRP identity (srpIdentity from the server, or the username).
   * @param passwordHashHex The Argon2id-derived password hash as uppercase hex.
   * @returns The SRP verifier (uppercase hex).
   */
  public static async deriveVerifier(
    salt: string,
    identity: string,
    passwordHashHex: string
  ): Promise<string> {
    const privateKey = await NativeVaultManager.srpDerivePrivateKey(salt, identity, passwordHashHex);
    return NativeVaultManager.srpDeriveVerifier(privateKey);
  }

  /**
   * Initiates the login process with the server
   */
  public async initiateLogin(username: string): Promise<LoginResponse> {
    const response = await this.webApiService.rawFetch('Auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: username.toLowerCase().trim() }),
    });

    // Check if response is a bad request (400)
    if (response.status === 400) {
      const badRequestResponse = await response.json() as BadRequestResponse;
      throw new ApiAuthError(badRequestResponse.title);
    }

    // For other responses, try to parse as LoginResponse
    const loginResponse = await response.json() as LoginResponse;
    return loginResponse;
  }

  /**
   * Validates the login with the server using SRP protocol
   */
  public async validateLogin(
    username: string,
    passwordHash: string,
    rememberMe: boolean,
    loginResponse: LoginResponse
  ): Promise<ValidateLoginResponse> {
    /**
     * Use srpIdentity from server response if available, otherwise fall back to username.
     * Note: the fallback can be removed in the future after 0.26.0+ is deployed.
     */
    const srpIdentity = loginResponse.srpIdentity ?? username;

    const clientProof = await SrpUtility.deriveClientProof(
      loginResponse.salt,
      srpIdentity,
      passwordHash,
      loginResponse.serverEphemeral
    );

    const response = await this.webApiService.rawFetch('Auth/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: username.toLowerCase().trim(),
        rememberMe,
        clientPublicEphemeral: clientProof.clientPublicEphemeral,
        clientSessionProof: clientProof.clientSessionProof,
      }),
    });

    // Check if response is a bad request (400)
    if (response.status === 400) {
      const badRequestResponse = await response.json() as BadRequestResponse;
      throw new ApiAuthError(badRequestResponse.title);
    }

    // For other responses, try to parse as ValidateLoginResponse
    const validateResponse = await response.json() as ValidateLoginResponse;
    return validateResponse;
  }

  /**
   * Validates 2FA code with the server
   */
  public async validateLogin2Fa(
    username: string,
    passwordHash: string,
    rememberMe: boolean,
    loginResponse: LoginResponse,
    twoFactorCode: number
  ): Promise<ValidateLoginResponse> {
    /**
     * Use srpIdentity from server response if available, otherwise fall back to username.
     * Note: the fallback can be removed in the future after 0.26.0+ is deployed.
     */
    const srpIdentity = loginResponse.srpIdentity ?? username;

    const clientProof = await SrpUtility.deriveClientProof(
      loginResponse.salt,
      srpIdentity,
      passwordHash,
      loginResponse.serverEphemeral
    );

    const model: ValidateLoginRequest2Fa = {
      username: username.toLowerCase().trim(),
      rememberMe,
      clientPublicEphemeral: clientProof.clientPublicEphemeral,
      clientSessionProof: clientProof.clientSessionProof,
      code2Fa: twoFactorCode,
    };

    const response = await this.webApiService.rawFetch('Auth/validate-2fa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(model),
    });

    // Check if response is a bad request (400)
    if (response.status === 400) {
      const badRequestResponse = await response.json() as BadRequestResponse;
      throw new ApiAuthError(badRequestResponse.title);
    }

    // For other responses, try to parse as ValidateLoginResponse
    const validateResponse = await response.json() as ValidateLoginResponse;
    return validateResponse;
  }
}
