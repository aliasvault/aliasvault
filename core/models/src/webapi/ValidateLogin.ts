/**
 * The verifier of the same password and salt under the current encryption type, sent once with a login that answered
 * a legacy (pre-0.31.0, Argon2Id) verifier. TODO: remove once no legacy verifiers are left.
 */
export type LegacySrpVerifierUpgrade = {
    srpVerifier: string;
    encryptionType: string;
}

/**
 * Validate login request type.
 */
export type ValidateLoginRequest = {
    username: string;
    rememberMe: boolean;
    clientPublicEphemeral: string;
    clientSessionProof: string;
    legacyVerifierUpgrade?: LegacySrpVerifierUpgrade;
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
    legacyVerifierUpgrade?: LegacySrpVerifierUpgrade;
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