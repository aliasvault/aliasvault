import { SrpAuthService } from '@/utils/auth/SrpAuthService';
import type { LoginResponse, ValidateLoginResponse, ValidateLoginRequest, ValidateLoginRequest2Fa, BadRequestResponse } from '@/utils/dist/core/models/webapi';
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

    /*
     * Use srpIdentity from server response if available, otherwise fall back to normalized username.
     * @todo Remove fallback after 0.26.0+ has been released.
     */
    const srpIdentity = loginResponse.srpIdentity ?? normalizedUsername;

    // Generate client ephemeral
    const clientEphemeral = SrpAuthService.generateEphemeral();

    // Derive private key using srpIdentity (not the typed username)
    const privateKey = SrpAuthService.derivePrivateKey(
      loginResponse.salt,
      srpIdentity,
      passwordHashString
    );

    // Derive session using srpIdentity (not the typed username)
    const session = SrpAuthService.deriveSession(
      clientEphemeral.secret,
      loginResponse.serverEphemeral,
      loginResponse.salt,
      srpIdentity,
      privateKey
    );

    const model: ValidateLoginRequest = {
      username: normalizedUsername,
      rememberMe: rememberMe,
      clientPublicEphemeral: clientEphemeral.public,
      clientSessionProof: session.proof,
    };

    const response = await this.webApiService.rawFetch('Auth/validate', {
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

    /*
     * Use srpIdentity from server response if available, otherwise fall back to normalized username.
     * @todo Remove fallback after 0.26.0+ has been released.
     */
    const srpIdentity = loginResponse.srpIdentity ?? normalizedUsername;

    // Generate client ephemeral
    const clientEphemeral = SrpAuthService.generateEphemeral();

    // Derive private key using srpIdentity (not the typed username)
    const privateKey = SrpAuthService.derivePrivateKey(
      loginResponse.salt,
      srpIdentity,
      passwordHashString
    );

    // Derive session using srpIdentity (not the typed username)
    const session = SrpAuthService.deriveSession(
      clientEphemeral.secret,
      loginResponse.serverEphemeral,
      loginResponse.salt,
      srpIdentity,
      privateKey
    );

    const model: ValidateLoginRequest2Fa = {
      username: normalizedUsername,
      rememberMe,
      clientPublicEphemeral: clientEphemeral.public,
      clientSessionProof: session.proof,
      code2Fa,
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
    const validateLoginResponse = await response.json() as ValidateLoginResponse;
    return validateLoginResponse;
  }
}

export default SrpUtility;
