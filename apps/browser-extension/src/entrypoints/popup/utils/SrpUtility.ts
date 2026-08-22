import { SrpAuthService } from '@/utils/auth/SrpAuthService';
import type { LoginResponse, ValidateLoginResponse, ValidateLoginRequest, ValidateLoginRequest2Fa, BadRequestResponse } from '@/utils/dist/core/models/webapi';
import { throwIfServerPredatesV2Api } from '@/utils/legacy/LegacyStorageModelMigration';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import { WebApiService } from '@/utils/WebApiService';

/**
 * Utility class for SRP authentication operations.
 *
 * This class wraps the SrpAuthService to provide WebApiService-aware
 * authentication methods for the browser extension popup.
 */
class SrpUtility {
  private readonly webApiService: WebApiService;

  /**
   * Constructor for the SrpUtility class.
   *
   * @param webApiService - The WebApiService instance.
   */
  public constructor(webApiService: WebApiService) {
    this.webApiService = webApiService;
  }

  /**
   * Reject a response that a server predating the v2 API produced.
   * TODO: can be deleted later once all users have migrated to the new storage format and we don't support v1 API anymore.
   * @param response - the raw auth response
   */
  private async assertServerSupportsV2Api(response: Response): Promise<void> {
    await throwIfServerPredatesV2Api(response.status, await this.webApiService.getApiUrl());
  }

  /**
   * Initiate login with server.
   */
  public async initiateLogin(username: string): Promise<LoginResponse> {
    const normalizedUsername = SrpAuthService.normalizeUsername(username);

    const response = await this.webApiService.rawFetch('Auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: normalizedUsername }),
    });

    await this.assertServerSupportsV2Api(response);

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
   * Validate login with server using locally generated ephemeral and session proof.
   */
  public async validateLogin(
    username: string,
    passwordHashString: string,
    rememberMe: boolean,
    loginResponse: LoginResponse
  ): Promise<ValidateLoginResponse> {
    const normalizedUsername = SrpAuthService.normalizeUsername(username);
    const proof = await SrpAuthService.deriveLoginProof(loginResponse, normalizedUsername, passwordHashString);

    const model: ValidateLoginRequest = {
      username: normalizedUsername,
      rememberMe: rememberMe,
      ...proof,
    };

    const response = await this.webApiService.rawFetch('Auth/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(model),
    });

    await this.assertServerSupportsV2Api(response);

    // Check if response is a bad request (400)
    if (response.status === 400) {
      const badRequestResponse = await response.json() as BadRequestResponse;
      throw new ApiAuthError(badRequestResponse.title);
    }

    // For other responses, try to parse as ValidateLoginResponse
    const validateLoginResponse = await response.json() as ValidateLoginResponse;
    return validateLoginResponse;
  }

  /**
   * Validate login with 2FA with server using locally generated ephemeral and session proof.
   */
  public async validateLogin2Fa(
    username: string,
    passwordHashString: string,
    rememberMe: boolean,
    loginResponse: LoginResponse,
    code2Fa: number
  ): Promise<ValidateLoginResponse> {
    const normalizedUsername = SrpAuthService.normalizeUsername(username);
    const proof = await SrpAuthService.deriveLoginProof(loginResponse, normalizedUsername, passwordHashString);

    const model: ValidateLoginRequest2Fa = {
      username: normalizedUsername,
      rememberMe,
      ...proof,
      code2Fa,
    };

    const response = await this.webApiService.rawFetch('Auth/validate-2fa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(model),
    });

    await this.assertServerSupportsV2Api(response);

    // Check if response is a bad request (400)
    if (response.status === 400) {
      const badRequestResponse = await response.json() as BadRequestResponse;
      throw new ApiAuthError(badRequestResponse.title);
    }

    // For other responses, try to parse as ValidateLoginResponse
    const validateLoginResponse = await response.json() as ValidateLoginResponse;
    return validateLoginResponse;
  }
}

export default SrpUtility;
