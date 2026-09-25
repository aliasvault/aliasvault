/**
 * Mobile login initiate request type.
 */
export type MobileLoginInitiateRequest = {
    clientPublicKey: string;
}

/**
 * Mobile login initiate response type. The request id goes into the QR code, the poll secret stays with the initiating client.
 */
export type MobileLoginInitiateResponse = {
    requestId: string;
    pollSecret: string;
}

/**
 * Mobile login poll request type.
 */
export type MobileLoginPollRequest = {
    requestId: string;
    pollSecret: string;
}

/**
 * State of a mobile login request as seen by the polling client.
 */
export type MobileLoginStatus = 'Pending' | 'Approved' | 'Declined';

/**
 * Mobile login poll response type. The encrypted fields are only set when the status is Approved.
 */
export type MobileLoginPollResponse = {
    status: MobileLoginStatus;
    encryptedSymmetricKey: string | null;
    encryptedPayload: string | null;
    encryptedUnlockKey: string | null;
}

/**
 * Decrypted content of `encryptedPayload` in the poll response.
 */
export type MobileLoginPayload = {
    username: string;
    token: string;
    refreshToken: string;
    salt: string;
    encryptionType: string;
    encryptionSettings: string;
}

/**
 * Request type of the mobile app calls that only name a request (details and decline).
 */
export type MobileLoginRequestReference = {
    requestId: string;
}

/**
 * Mobile login details response type: what the mobile app shows before the user approves.
 * Everything except the public key is reported by the requesting client and is context, not proof.
 */
export type MobileLoginDetailsResponse = {
    clientPublicKey: string;
    ipAddress: string | null;
    location: string | null;
    clientName: string | null;
    browser: string | null;
    operatingSystem: string | null;
    createdAt: string;
}

/**
 * Mobile login submit request type.
 */
export type MobileLoginSubmitRequest = {
    requestId: string;
    encryptedUnlockKey: string;
}
