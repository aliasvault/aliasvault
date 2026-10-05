import { ApiRequestError } from '../api/errors/ApiRequestError';
import { throwIfServerPredatesV2Api } from '../sync/LegacyStorageModelMigration';

import { SrpAuthService, type LoginCredentials, type SrpClientSession } from './SrpAuthService';

import type { WebApiService } from '../api/WebApiService';
import type { AccountKeyHierarchy } from '../crypto/AccountKeys';
import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';
import type { LegacySrpVerifierUpgrade, LoginResponse, TokenModel, ValidateLoginRequest, ValidateLoginRequest2Fa, ValidateLoginResponse } from '@aliasvault/models/webapi';

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
 * A login proof derived once from the password, reusable for every validate request of the same login session.
 */
export type LoginProof = {
  session: SrpClientSession;
  legacyVerifierUpgrade?: LegacySrpVerifierUpgrade;
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
   * @param inviteCode - The registration invite code, required when public registration is disabled
   * @returns The normalized username, session tokens and key material of the new account
   * @throws {ApiRequestError} with the server's error code when the server refuses the registration
   */
  public async register(username: string, password: string, inviteCode?: string): Promise<RegistrationResult> {
    const prepared = await SrpAuthService.prepareRegistration(username, password);
    const token = await this.parseAuthResponse<TokenModel>(await this.post('Auth/register', { ...prepared.request, inviteCode }));
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
   * @param credentials - The SRP password hash and, for a legacy verifier, its upgrade
   * @param rememberMe - Whether to request an extended token lifetime
   * @param loginResponse - The initiate response
   * @returns The validate response
   */
  public async validateLogin(username: string, credentials: LoginCredentials, rememberMe: boolean, loginResponse: LoginResponse): Promise<ValidateLoginResponse> {
    return this.validateLoginWithProof(username, await this.createLoginProof(username, credentials, loginResponse), rememberMe, loginResponse.loginSessionId);
  }

  /**
   * Validate login with a 2FA authenticator code.
   * @param username - The username
   * @param credentials - The SRP password hash and, for a legacy verifier, its upgrade
   * @param rememberMe - Whether to request an extended token lifetime
   * @param loginResponse - The initiate response
   * @param code2Fa - The authenticator code
   * @returns The validate response
   */
  public async validateLogin2Fa(username: string, credentials: LoginCredentials, rememberMe: boolean, loginResponse: LoginResponse, code2Fa: number): Promise<ValidateLoginResponse> {
    return this.validateLogin2FaWithProof(username, await this.createLoginProof(username, credentials, loginResponse), rememberMe, loginResponse.loginSessionId, code2Fa);
  }

  /**
   * Derive the proof of a login session from the password hash, so a caller can keep the proof instead of the hash.
   * @param username - The username
   * @param credentials - The SRP password hash and, for a legacy verifier, its upgrade
   * @param loginResponse - The initiate response
   * @returns The login proof
   */
  public async createLoginProof(username: string, credentials: LoginCredentials, loginResponse: LoginResponse): Promise<LoginProof> {
    const session = await SrpAuthService.deriveLoginSession(loginResponse, SrpAuthService.normalizeUsername(username), credentials.passwordHashString);
    return { session, legacyVerifierUpgrade: credentials.legacyVerifierUpgrade };
  }

  /**
   * Validate login with a 2FA authenticator code, using a proof from {@link createLoginProof}.
   * @param username - The username
   * @param proof - The login proof
   * @param rememberMe - Whether to request an extended token lifetime
   * @param loginSessionId - The login session id from the initiate response
   * @param code2Fa - The authenticator code
   * @returns The validate response
   */
  public async validateLogin2FaWithProof(username: string, proof: LoginProof, rememberMe: boolean, loginSessionId: string, code2Fa: number): Promise<ValidateLoginResponse> {
    const model: ValidateLoginRequest2Fa = { ...this.proofModel(SrpAuthService.normalizeUsername(username), rememberMe, proof, loginSessionId), code2Fa };
    return this.verifiedLoginResponse(proof.session, await this.post('Auth/validate-2fa', model));
  }

  /**
   * Validate login with the server using a proof from {@link createLoginProof}.
   * @param username - The username
   * @param proof - The login proof
   * @param rememberMe - Whether to request an extended token lifetime
   * @param loginSessionId - The login session id from the initiate response
   * @returns The validate response
   */
  public async validateLoginWithProof(username: string, proof: LoginProof, rememberMe: boolean, loginSessionId: string): Promise<ValidateLoginResponse> {
    const model: ValidateLoginRequest = this.proofModel(SrpAuthService.normalizeUsername(username), rememberMe, proof, loginSessionId);
    return this.verifiedLoginResponse(proof.session, await this.post('Auth/validate', model));
  }

  /**
   * Validate login with a 2FA recovery code.
   * @param username - The username
   * @param credentials - The SRP password hash and, for a legacy verifier, its upgrade
   * @param rememberMe - Whether to request an extended token lifetime
   * @param loginResponse - The initiate response
   * @param recoveryCode - The recovery code
   * @returns The validate response
   */
  public async validateLoginRecoveryCode(username: string, credentials: LoginCredentials, rememberMe: boolean, loginResponse: LoginResponse, recoveryCode: string): Promise<ValidateLoginResponse> {
    const proof = await this.createLoginProof(username, credentials, loginResponse);
    const model: ValidateLoginRequestRecoveryCode = { ...this.proofModel(SrpAuthService.normalizeUsername(username), rememberMe, proof, loginResponse.loginSessionId), recoveryCode };
    return this.verifiedLoginResponse(proof.session, await this.post('Auth/validate-recovery-code', model));
  }

  /**
   * Build the fields every validate request carries.
   * @param username - The normalized username
   * @param rememberMe - Whether to request an extended token lifetime
   * @param proof - The login proof
   * @param loginSessionId - The login session id from the initiate response
   * @returns The validate request
   */
  private proofModel(username: string, rememberMe: boolean, proof: LoginProof, loginSessionId: string): ValidateLoginRequest {
    return { username, rememberMe, ...proof.session.proof, loginSessionId, legacyVerifierUpgrade: proof.legacyVerifierUpgrade };
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
