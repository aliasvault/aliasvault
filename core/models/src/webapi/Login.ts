/**
 * Login request type.
 */
export type LoginRequest = {
    username: string;
}

/**
 * Login response type.
 */
export type LoginResponse = {
    salt: string;
    serverEphemeral: string;
    encryptionType: string;
    encryptionSettings: string;
    srpIdentity?: string;
}
