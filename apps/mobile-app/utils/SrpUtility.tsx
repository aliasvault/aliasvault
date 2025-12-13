import srp from 'secure-remote-password/client';

import type { LoginResponse, ValidateLoginRequest2Fa, ValidateLoginResponse, BadRequestResponse } from '@/utils/dist/core/models/webapi';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import { WebApiService } from '@/utils/WebApiService';

/**
 * Utility class for SRP login and validation operations.
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

    const clientEphemeral = srp.generateEphemeral();
    const privateKey = srp.derivePrivateKey(loginResponse.salt, srpIdentity, passwordHash);
    const sessionProof = srp.deriveSession(
      clientEphemeral.secret,
      loginResponse.serverEphemeral,
      loginResponse.salt,
      srpIdentity,
      privateKey
    );

    const response = await this.webApiService.rawFetch('Auth/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: username.toLowerCase().trim(),
        rememberMe,
        clientPublicEphemeral: clientEphemeral.public,
        clientSessionProof: sessionProof.proof,
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

    const clientEphemeral = srp.generateEphemeral();
    const privateKey = srp.derivePrivateKey(loginResponse.salt, srpIdentity, passwordHash);
    const sessionProof = srp.deriveSession(
      clientEphemeral.secret,
      loginResponse.serverEphemeral,
      loginResponse.salt,
      srpIdentity,
      privateKey
    );

    const model: ValidateLoginRequest2Fa = {
      username: username.toLowerCase().trim(),
      rememberMe,
      clientPublicEphemeral: clientEphemeral.public,
      clientSessionProof: sessionProof.proof,
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
