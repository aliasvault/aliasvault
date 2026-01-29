/**
 * Mobile login initiate request type.
 */
export type MobileLoginInitiateRequest = {
    clientPublicKey: string;
}

/**
 * Mobile login initiate response type.
 */
export type MobileLoginInitiateResponse = {
    requestId: string;
}

/**
 * Mobile login submit request type.
 */
export type MobileLoginSubmitRequest = {
    requestId: string;
    encryptedDecryptionKey: string;
}

/**
 * Mobile login poll response type.
 */
export type MobileLoginPollResponse = {
    fulfilled: boolean;
    encryptedSymmetricKey: string | null;
    encryptedToken: string | null;
    encryptedRefreshToken: string | null;
    encryptedDecryptionKey: string | null;
    encryptedUsername: string | null;
}
