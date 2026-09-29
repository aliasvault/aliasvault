import { ApiRequestError } from '../api/errors/ApiRequestError';
import { throwIfServerPredatesV2Api } from '../sync/LegacyStorageModelMigration';

import { SrpAuthService, type SrpClientSession } from './SrpAuthService';

import type { WebApiService } from '../api/WebApiService';
import type { AccountKeyHierarchy } from '../crypto/AccountKeys';
import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';
import type { LoginResponse, TokenModel, ValidateLoginRequest, ValidateLoginRequest2Fa, ValidateLoginResponse } from '@aliasvault/models/webapi';

/**
 * The part of an API client the auth requests need.
 */
export type SrpLoginApi = Pick<WebApiService, 'rawFetch'>;

/**
 * The recovery code variant of the validate request.
 */
type ValidateLoginRequestRecoveryCode = ValidateLoginRequest & {
  recoveryCode: string;
};

/**
 * A registered account: its session tokens plus the key material the caller keeps client-side.
 */
export type RegistrationResult = {
  username: string;
  token: TokenModel;
  keys: AccountKeyHierarchy;
  derivedKey: string;
  derivationParams: UnlockKeyDerivationParams;
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
   * Register a new account with its SRP verifier and account key hierarchy, both created client-side. The server
   * holds no vault content yet; the first sync writes the empty vault.
   * @param username - The username
   * @param password - The master password
   * @returns The normalized username, session tokens and key material of the new account
   * @throws {ApiRequestError} with the server's error code when the server refuses the registration
   */
  public async register(username: string, password: string): Promise<RegistrationResult> {
    const prepared = await SrpAuthService.prepareRegistration(username, password);
    const token = await this.parseAuthResponse<TokenModel>(await this.post('Auth/register', prepared.request));
    const { salt, encryptionType, encryptionSettings } = prepared.request;
    return { username: prepared.request.username, token, keys: prepared.keys, derivedKey: prepared.derivedKey, derivationParams: { salt, encryptionType, encryptionSettings } };
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
    const session = await SrpAuthService.deriveLoginSession(loginResponse, normalizedUsername, passwordHashString);
    const model: ValidateLoginRequest = { username: normalizedUsername, rememberMe, ...session.proof };
    return this.verifiedLoginResponse(session, await this.post('Auth/validate', model));
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
    const session = await SrpAuthService.deriveLoginSession(loginResponse, normalizedUsername, passwordHashString);
    const model: ValidateLoginRequest2Fa = { username: normalizedUsername, rememberMe, ...session.proof, code2Fa };
    return this.verifiedLoginResponse(session, await this.post('Auth/validate-2fa', model));
  }

  /**
   * Validate login with a 2FA recovery code.
   * @param username - The username
   * @param passwordHashString - The password hash as uppercase hex
   * @param rememberMe - Whether to request an extended token lifetime
   * @param loginResponse - The initiate response
   * @param recoveryCode - The recovery code
   * @returns The validate response
   */
  public async validateLoginRecoveryCode(username: string, passwordHashString: string, rememberMe: boolean, loginResponse: LoginResponse, recoveryCode: string): Promise<ValidateLoginResponse> {
    const normalizedUsername = SrpAuthService.normalizeUsername(username);
    const session = await SrpAuthService.deriveLoginSession(loginResponse, normalizedUsername, passwordHashString);
    const model: ValidateLoginRequestRecoveryCode = { username: normalizedUsername, rememberMe, ...session.proof, recoveryCode };
    return this.verifiedLoginResponse(session, await this.post('Auth/validate-recovery-code', model));
  }

  /**
   * Parse a validate response and, once it carries tokens, check the server's session proof.
   * @param session - The client session the request was sent with
   * @param response - The raw response
   * @returns The parsed body
   */
  private async verifiedLoginResponse(session: SrpClientSession, response: Response): Promise<ValidateLoginResponse> {
    const result = await this.parseAuthResponse<ValidateLoginResponse>(response);
    if (!result.requiresTwoFactor) {
      await SrpAuthService.verifyServerProof(session, result.serverSessionProof);
    }
    return result;
  }

  /**
   * Parse an auth response, turning a failure into an ApiRequestError carrying the server's error code.
   * @param response - The raw response
   * @returns The parsed body
   */
  private async parseAuthResponse<T>(response: Response): Promise<T> {
    await throwIfServerPredatesV2Api(response.status, this.api);
    if (!response.ok) {
      throw await ApiRequestError.fromResponse(response);
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
