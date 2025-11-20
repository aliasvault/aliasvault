/**
 * Represents the error response returned by the API.
 */
type ApiErrorResponse = {
    /**
     * The main error message.
     */
    message: string;
    /**
     * The error code associated with this error.
     */
    code: string;
    /**
     * Additional details about the error.
     */
    details: Record<string, unknown>;
    /**
     * The HTTP status code associated with this error.
     */
    statusCode: number;
    /**
     * The timestamp when the error occurred.
     */
    timestamp: string;
};

/**
 * Vault type.
 */
type Vault = {
    username: string;
    blob: string;
    version: string;
    currentRevisionNumber: number;
    credentialsCount: number;
    createdAt: string;
    updatedAt: string;
    encryptionPublicKey?: string;
    emailAddressList?: string[];
    privateEmailDomainList?: string[];
    hiddenPrivateEmailDomainList?: string[];
    publicEmailDomainList?: string[];
};

/**
 * Vault response type.
 */
type VaultResponse = {
    status: number;
    vault: Vault;
};

/**
 * Vault post response type returned after uploading a new vault to the server.
 */
type VaultPostResponse = {
    status: number;
    newRevisionNumber: number;
};

/**
 * Status response type.
 */
type StatusResponse = {
    clientVersionSupported: boolean;
    serverVersion: string;
    vaultRevision: number;
    srpSalt: string;
};

/**
 * Login request type.
 */
type LoginRequest = {
    username: string;
};
/**
 * Login response type.
 */
type LoginResponse = {
    salt: string;
    serverEphemeral: string;
    encryptionType: string;
    encryptionSettings: string;
};

/**
 * Validate login request type.
 */
type ValidateLoginRequest = {
    username: string;
    rememberMe: boolean;
    clientPublicEphemeral: string;
    clientSessionProof: string;
};
/**
 * Validate login request type for 2FA.
 */
type ValidateLoginRequest2Fa = {
    username: string;
    code2Fa: number;
    rememberMe: boolean;
    clientPublicEphemeral: string;
    clientSessionProof: string;
};
/**
 * Token model type.
 */
type TokenModel = {
    token: string;
    refreshToken: string;
};
/**
 * Validate login response type.
 */
type ValidateLoginResponse = {
    requiresTwoFactor: boolean;
    token?: TokenModel;
    serverSessionProof: string;
};

type MailboxEmail = {
    /** The preview of the email message */
    messagePreview: string;
    /** Indicates whether the email has attachments */
    hasAttachments: boolean;
    /** The ID of the email */
    id: number;
    /** The subject of the email */
    subject: string;
    /** The display name of the sender */
    fromDisplay: string;
    /** The domain of the sender's email address */
    fromDomain: string;
    /** The local part of the sender's email address */
    fromLocal: string;
    /** The domain of the recipient's email address */
    toDomain: string;
    /** The local part of the recipient's email address */
    toLocal: string;
    /** The date of the email */
    date: string;
    /** The system date of the email */
    dateSystem: string;
    /** The number of seconds ago the email was received */
    secondsAgo: number;
    /**
     * The encrypted symmetric key which was used to encrypt the email message.
     * This key is encrypted with the public key of the user.
     */
    encryptedSymmetricKey: string;
    /** The public key of the user used to encrypt the symmetric key */
    encryptionKey: string;
};

/**
 * Mailbox bulk request type.
 */
type MailboxBulkRequest = {
    addresses: string[];
    page: number;
    pageSize: number;
};
/**
 * Mailbox bulk response type.
 */
type MailboxBulkResponse = {
    addresses: string[];
    currentPage: number;
    pageSize: number;
    totalRecords: number;
    mails: MailboxEmail[];
};

/**
 * Email attachment type.
 */
type EmailAttachment = {
    /** The ID of the attachment */
    id: number;
    /** The ID of the email the attachment belongs to */
    emailId: number;
    /** The filename of the attachment */
    filename: string;
    /** The MIME type of the attachment */
    mimeType: string;
    /** The size of the attachment in bytes */
    filesize: number;
};

type Email = {
    /** The body of the email message */
    messageHtml: string;
    /** The plain text body of the email message */
    messagePlain: string;
    /** The ID of the email */
    id: number;
    /** The subject of the email */
    subject: string;
    /** The display name of the sender */
    fromDisplay: string;
    /** The domain of the sender's email address */
    fromDomain: string;
    /** The local part of the sender's email address */
    fromLocal: string;
    /** The domain of the recipient's email address */
    toDomain: string;
    /** The local part of the recipient's email address */
    toLocal: string;
    /** The date of the email */
    date: string;
    /** The system date of the email */
    dateSystem: string;
    /** The number of seconds ago the email was received */
    secondsAgo: number;
    /**
     * The encrypted symmetric key which was used to encrypt the email message.
     * This key is encrypted with the public key of the user.
     */
    encryptedSymmetricKey: string;
    /** The public key of the user used to encrypt the symmetric key */
    encryptionKey: string;
    /** The attachments of the email */
    attachments: EmailAttachment[];
};

/**
 * Auth Log model.
 */
type AuthLogModel = {
    /**
     * Gets or sets the primary key for the auth log entry.
     */
    id: number;
    /**
     * Gets or sets the timestamp of the auth log entry.
     */
    timestamp: string;
    /**
     * Gets or sets the type of authentication event.
     */
    eventType: number;
    /**
     * Gets or sets the username associated with the auth log entry.
     */
    username: string;
    /**
     * Gets or sets the IP address from which the authentication attempt was made.
     */
    ipAddress: string;
    /**
     * Gets or sets the user agent string of the device used for the authentication attempt.
     */
    userAgent: string;
    /**
     * Gets or sets the client application name and version.
     */
    client: string;
    /**
     * Gets or sets a value indicating whether the authentication attempt was successful.
     */
    isSuccess: boolean;
};

type RefreshToken = {
    /**
     * Gets or sets the unique identifier for the refresh token.
     */
    id: string;
    /**
     * Gets or sets the device identifier associated with the refresh token.
     */
    deviceIdentifier: string;
    /**
     * Gets or sets the expiration date of the refresh token.
     */
    expireDate: string;
    /**
     * Gets or sets the creation date of the refresh token.
     */
    createdAt: string;
};

type FaviconExtractModel = {
    image: string | null;
};

/**
 * Represents a delete account initiate response.
 */
type DeleteAccountInitiateRequest = {
    username: string;
};
/**
 * Represents a delete account initiate response.
 */
type DeleteAccountInitiateResponse = {
    salt: string;
    serverEphemeral: string;
    encryptionType: string;
    encryptionSettings: string;
};

/**
 * Represents a delete account request.
 */
type DeleteAccountRequest = {
    username: string;
    clientPublicEphemeral: string;
    clientSessionProof: string;
};

/**
 * Represents a password change initiate response.
 */
type PasswordChangeInitiateResponse = {
    salt: string;
    serverEphemeral: string;
    encryptionType: string;
    encryptionSettings: string;
};

/**
 * Represents a request to change the users password including a new vault that is encrypted with the new password.
 */
type VaultPasswordChangeRequest = Vault & {
    currentClientPublicEphemeral: string;
    currentClientSessionProof: string;
    newPasswordSalt: string;
    newPasswordVerifier: string;
};

type BadRequestResponse = {
    type: string;
    title: string;
    status: number;
    errors: Record<string, string[]>;
    traceId: string;
};

/**
 * Represents the type of authentication event.
 */
declare enum AuthEventType {
    /**
     * Represents a standard login attempt.
     */
    Login = 1,
    /**
     * Represents a two-factor authentication attempt.
     */
    TwoFactorAuthentication = 2,
    /**
     * Represents a user logout event.
     */
    Logout = 3,
    /**
     * Represents a mobile login attempt (login via QR code from mobile app).
     */
    MobileLogin = 4,
    /**
     * Represents JWT access token refresh event issued by client to API.
     */
    TokenRefresh = 10,
    /**
     * Represents a password reset event.
     */
    PasswordReset = 20,
    /**
     * Represents a password change event.
     */
    PasswordChange = 21,
    /**
     * Represents enabling two-factor authentication in settings.
     */
    TwoFactorAuthEnable = 22,
    /**
     * Represents disabling two-factor authentication in settings.
     */
    TwoFactorAuthDisable = 23,
    /**
     * Represents a user registration event.
     */
    Register = 30,
    /**
     * Represents a user account deletion event.
     */
    AccountDeletion = 99
}

/**
 * Mobile login initiate request type.
 */
type MobileLoginInitiateRequest = {
    clientPublicKey: string;
};
/**
 * Mobile login initiate response type.
 */
type MobileLoginInitiateResponse = {
    requestId: string;
};
/**
 * Mobile login submit request type.
 */
type MobileLoginSubmitRequest = {
    requestId: string;
    encryptedDecryptionKey: string;
};
/**
 * Mobile login poll response type.
 */
type MobileLoginPollResponse = {
    fulfilled: boolean;
    encryptedSymmetricKey: string | null;
    encryptedToken: string | null;
    encryptedRefreshToken: string | null;
    encryptedDecryptionKey: string | null;
    encryptedUsername: string | null;
};

export { type ApiErrorResponse, AuthEventType, type AuthLogModel, type BadRequestResponse, type DeleteAccountInitiateRequest, type DeleteAccountInitiateResponse, type DeleteAccountRequest, type Email, type EmailAttachment, type FaviconExtractModel, type LoginRequest, type LoginResponse, type MailboxBulkRequest, type MailboxBulkResponse, type MailboxEmail, type MobileLoginInitiateRequest, type MobileLoginInitiateResponse, type MobileLoginPollResponse, type MobileLoginSubmitRequest, type PasswordChangeInitiateResponse, type RefreshToken, type StatusResponse, type TokenModel, type ValidateLoginRequest, type ValidateLoginRequest2Fa, type ValidateLoginResponse, type Vault, type VaultPasswordChangeRequest, type VaultPostResponse, type VaultResponse };
