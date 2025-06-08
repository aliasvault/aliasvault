import srp from 'secure-remote-password/client';

import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import BadRequestResponse from '@/utils/types/webapi/BadRequestResponse';
import { LoginResponse } from '@/utils/types/webapi/Login';
import { ValidateLoginRequest2Fa, ValidateLoginResponse } from '@/utils/types/webapi/ValidateLogin';
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
    try {
      const response = await this.webApiService.rawFetch('Auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: username.toLowerCase().trim() }),
      });

      if (response.status === 400) {
        const badRequestResponse = await response.json() as BadRequestResponse;
        throw new ApiAuthError(badRequestResponse.title);
      }

      const loginResponse = await response.json() as LoginResponse;
      return loginResponse;
    } catch (error) {
      if (error instanceof ApiAuthError) {
        throw error;
      }
      throw new ApiAuthError('Could not reach AliasVault server. Please try again later or contact support if the problem persists.');
    }
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
    try {
      // Generate client ephemeral
      const clientEphemeral = srp.generateEphemeral();

      // Derive private key
      const privateKey = srp.derivePrivateKey(loginResponse.salt, username, passwordHash);

      // Derive session
      const sessionProof = srp.deriveSession(
        clientEphemeral.secret,
        loginResponse.serverEphemeral,
        loginResponse.salt,
        username,
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

      if (response.status === 400) {
        const badRequestResponse = await response.json() as BadRequestResponse;
        throw new ApiAuthError(badRequestResponse.title);
      }

      const validateResponse = await response.json() as ValidateLoginResponse;
      return validateResponse;
    } catch (error) {
      if (error instanceof ApiAuthError) {
        throw error;
      }
      console.error('validateLogin error', error);
      throw new ApiAuthError('Could not reach AliasVault server. Please try again later or contact support if the problem persists.');
    }
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
    try {
      // Generate client ephemeral
      const clientEphemeral = srp.generateEphemeral();

      // Derive private key
      const privateKey = srp.derivePrivateKey(loginResponse.salt, username, passwordHash);

      // Derive session
      const sessionProof = srp.deriveSession(
        clientEphemeral.secret,
        loginResponse.serverEphemeral,
        loginResponse.salt,
        username,
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

      if (response.status === 400) {
        const badRequestResponse = await response.json() as BadRequestResponse;
        throw new ApiAuthError(badRequestResponse.title);
      }

      const validateResponse = await response.json() as ValidateLoginResponse;
      return validateResponse;
    } catch (error) {
      if (error instanceof ApiAuthError) {
        throw error;
      }
      throw new ApiAuthError('Could not reach AliasVault server. Please try again later or contact support if the problem persists.');
    }
  }
}
