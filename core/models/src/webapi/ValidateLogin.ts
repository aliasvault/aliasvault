/**
 * Validate login request type.
 */
export type ValidateLoginRequest = {
    username: string;
    rememberMe: boolean;
    clientPublicEphemeral: string;
    clientSessionProof: string;
}

/**
 * Validate login request type for 2FA.
 */
export type ValidateLoginRequest2Fa = {
    username: string;
    code2Fa: number;
    rememberMe: boolean;
    clientPublicEphemeral: string;
    clientSessionProof: string;
}

/**
 * Token model type.
 */
export type TokenModel = {
    token: string;
    refreshToken: string;
}

/**
 * Validate login response type.
 */
export type ValidateLoginResponse = {
    requiresTwoFactor: boolean;
    token?: TokenModel;
    serverSessionProof: string;
  }