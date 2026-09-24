import { ApiAuthError } from '../api/errors/ApiAuthError';
import { throwIfServerPredatesV2Api } from '../sync/LegacyStorageModelMigration';

import { SrpAuthService } from './SrpAuthService';

import type { WebApiService } from '../api/WebApiService';
import type { AccountKeyHierarchy } from '../crypto/AccountKeys';
import type { BadRequestResponse, LoginResponse, TokenModel, ValidateLoginRequest, ValidateLoginRequest2Fa, ValidateLoginResponse } from '@aliasvault/models/webapi';

/**
 * The part of an API client the auth requests need.
 */
export type SrpLoginApi = Pick<WebApiService, 'rawFetch'>;

/**
 * A registered account: its session tokens plus the key material the caller keeps client-side.
 */
export type RegistrationResult = {
  token: TokenModel;
  keys: AccountKeyHierarchy;
  derivedKey: string;
};

/**
 * The SRP auth requests for registering and logging in.
 */
export class SrpLoginService {
  /**
   * Create the service.
   * @param api - The API client the requests go through
   */
  public constructor(private readonly api: SrpLoginApi) {}

  /**
   * Register a new account with its SRP verifier and account key hierarchy, both created client-side.
   * @param username - The username
   * @param password - The master password
   * @returns The session tokens and key material of the new account
   * @throws {ApiAuthError} when the server refuses the registration
   */
  public async register(username: string, password: string): Promise<RegistrationResult> {
    const prepared = await SrpAuthService.prepareRegistration(username, password);
    const token = await this.parseAuthResponse<TokenModel>(await this.post('Auth/register', prepared.request));
    return { token, keys: prepared.keys, derivedKey: prepared.derivedKey };
  }

  /**
   * Initiate login with the server.
   * @param username - The username
   * @returns The server's login challenge
   */
  public async initiateLogin(username: string): Promise<LoginResponse> {
    const normalizedUsername = SrpAuthService.normalizeUsername(username);
    return this.parseAuthResponse<LoginResponse>(await this.post('Auth/login', { username: normalizedUsername }));
  }

  /**
   * Validate login with the server using the locally generated ephemeral and session proof.
   * @param username - The username
   * @param passwordHashString - The password hash as uppercase hex
   * @param rememberMe - Whether to request an extended token lifetime
   * @param loginResponse - The initiate response
   * @returns The validate response
   */
  public async validateLogin(username: string, passwordHashString: string, rememberMe: boolean, loginResponse: LoginResponse): Promise<ValidateLoginResponse> {
    const normalizedUsername = SrpAuthService.normalizeUsername(username);
    const proof = await SrpAuthService.deriveLoginProof(loginResponse, normalizedUsername, passwordHashString);
    const model: ValidateLoginRequest = { username: normalizedUsername, rememberMe, ...proof };
    return this.parseAuthResponse<ValidateLoginResponse>(await this.post('Auth/validate', model));
  }

  /**
   * Validate login with a 2FA authenticator code.
   * @param username - The username
   * @param passwordHashString - The password hash as uppercase hex
   * @param rememberMe - Whether to request an extended token lifetime
   * @param loginResponse - The initiate response
   * @param code2Fa - The authenticator code
   * @returns The validate response
   */
  public async validateLogin2Fa(username: string, passwordHashString: string, rememberMe: boolean, loginResponse: LoginResponse, code2Fa: number): Promise<ValidateLoginResponse> {
    const normalizedUsername = SrpAuthService.normalizeUsername(username);
    const proof = await SrpAuthService.deriveLoginProof(loginResponse, normalizedUsername, passwordHashString);
    const model: ValidateLoginRequest2Fa = { username: normalizedUsername, rememberMe, ...proof, code2Fa };
    return this.parseAuthResponse<ValidateLoginResponse>(await this.post('Auth/validate-2fa', model));
  }

  /**
   * Parse an auth response, turning a 400 into an ApiAuthError carrying the server's error code.
   * @param response - The raw response
   * @returns The parsed body
   */
  private async parseAuthResponse<T>(response: Response): Promise<T> {
    await throwIfServerPredatesV2Api(response.status, this.api);
    if (response.status === 400) {
      const badRequestResponse = await response.json() as BadRequestResponse;
      throw new ApiAuthError(badRequestResponse.title);
    }
    return await response.json() as T;
  }

  /**
   * Post an auth request.
   * @param path - The endpoint
   * @param body - The request body
   * @returns The raw response
   */
  private async post(path: string, body: unknown): Promise<Response> {
    return this.api.rawFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
