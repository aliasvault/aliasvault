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
 * Status response type (v1). Returned by GET /v1/Auth/status.
 */
type StatusResponse = {
    clientVersionSupported: boolean;
    serverVersion: string;
    vaultRevision: number;
    srpSalt: string;
};

/**
 * The latest revision of a single logical manifest.
 */
type ManifestRevision = {
    manifestId: string;
    revision: number;
};
/**
 * Status response type (v2).
 */
type StatusResponseV2 = {
    clientVersionSupported: boolean;
    serverVersion: string;
    manifestRevisions: ManifestRevision[];
    /** The manifest owned by the user's personal group; every other entry is a shared one. */
    personalManifestId: string | null;
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
    srpIdentity?: string;
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

type EmailDecryptionKey = {
    /** Position of the public key in the response-level publicKeys table */
    keyIndex: number;
    /** The email's symmetric key, encrypted with the public key */
    encryptedSymmetricKey: string;
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
    /** The encrypted copies of the email's symmetric key the caller can decrypt, one per manifest keypair the caller holds. */
    decryptionKeys: EmailDecryptionKey[];
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
    currentPage: number;
    pageSize: number;
    totalRecords: number;
    publicKeys: string[];
    mails: MailboxEmail[];
};

type Email = {
    /** The raw RFC 822 source of the email message (ciphertext, base64)  */
    messageSource: string;
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
    /** The encrypted copies of the email's symmetric key the caller can decrypt, one per manifest keypair the caller holds */
    decryptionKeys: EmailDecryptionKey[];
    /** The public keys referenced by this email's decryption keys, indexed by EmailDecryptionKey.keyIndex */
    publicKeys: string[];
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
    srpIdentity: string;
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
    srpIdentity?: string;
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

/**
 * Vault key response type (account-key model). Returned by GET /v2/VaultKey/{type}.
 */
type VaultKeyResponse = {
    type: string;
    encryptedAccountKey: string;
    encryptedAccountPrivateKey: string | null;
    accountPublicKey: string | null;
    encryptedVek: string | null;
    salt: string;
    encryptionType: string;
    encryptionSettings: string;
};
/**
 * Envelope returned by GET /v2/VaultKey/{type} with HTTP 200.
 */
type VaultKeyGetResponse = {
    vaultKey: VaultKeyResponse | null;
};

/**
 * <auto-generated />
 * This file is auto-generated from core/models/scripts/generate-key-vocabulary.cjs.
 * Do not edit this file directly. Run 'core/models/build.sh' (or 'node core/models/scripts/generate-key-vocabulary.cjs') to regenerate.
 */
/**
 * Unlock methods a user can enroll. Each enrolled method stores one copy of the user's Account Key,
 * encrypted with a KEK derived from that method's secret.
 */
declare const UnlockMethodType: {
    /**
     * Master password: the KEK is derived from the password via Argon2.
     */
    readonly Password: "password";
};
/**
 * Type representing all valid UnlockMethodType tokens.
 */
type UnlockMethodTypeValue = typeof UnlockMethodType[keyof typeof UnlockMethodType];

/**
 * <auto-generated />
 * This file is auto-generated from core/models/scripts/generate-key-vocabulary.cjs.
 * Do not edit this file directly. Run 'core/models/build.sh' (or 'node core/models/scripts/generate-key-vocabulary.cjs') to regenerate.
 */
/**
 * How one user's access to one manifest's VEK is protected. Every (user, manifest) access path is
 * exactly one of these, and the token decides where the client looks for the key that opens the manifest.
 */
declare const ManifestKeyType: {
    /**
     * The VEK is encrypted with the user's own Account Key, which their unlock chain produces.
     */
    readonly AccountKey: "accountkey";
    /**
     * A grant: the VEK is encrypted to a public key of the user, so only its holder's private half can open it.
     */
    readonly GrantKey: "grantkey";
};
/**
 * Type representing all valid ManifestKeyType tokens.
 */
type ManifestKeyTypeValue = typeof ManifestKeyType[keyof typeof ManifestKeyType];

/**
 * <auto-generated />
 * This file is auto-generated from core/models/scripts/generate-key-vocabulary.cjs.
 * Do not edit this file directly. Run 'core/models/build.sh' (or 'node core/models/scripts/generate-key-vocabulary.cjs') to regenerate.
 */
/**
 * The algorithms a piece of vault key ciphertext can be encrypted with. The token travels next to every
 * ciphertext, so a reader always knows how to open it without inferring anything from context.
 */
declare const VaultKeyAlgorithm: {
    /**
     * AES-256-GCM: symmetric, used where the reader already holds the wrapping key.
     */
    readonly Aes256Gcm: "aes256-gcm";
    /**
     * RSA-OAEP with SHA-256: asymmetric, used to encrypt a VEK to a recipient's public key.
     */
    readonly RsaOaepSha256: "rsa-oaep-sha256";
};
/**
 * Type representing all valid VaultKeyAlgorithm tokens.
 */
type VaultKeyAlgorithmValue = typeof VaultKeyAlgorithm[keyof typeof VaultKeyAlgorithm];

/**
 * The messages of the /v2/Groups API: the membership half of vault sharing — who is in a shared group, who has been
 * asked to join one, and the grants that hand a group's vault key to a member.
 *
 * The names mirror the server DTOs in `AliasVault.Shared.Models.WebApi.V2.Groups` one for one, so a change on either
 * side is visible as a change to its counterpart. Server `Guid` and `DateTime` are strings here, as they are on the
 * wire.
 */
/**
 * A member's role in a group. The wire form is the name of the server-side `GroupRole` enum member; the privilege
 * ordering it encodes belongs to the server and is never re-derived by a client.
 */
type GroupRole = 'Owner' | 'Admin' | 'Member';
/**
 * One member of a group.
 */
type GroupMemberInfo = {
    userId: string;
    username: string;
    role: GroupRole;
};
/**
 * An invitation sent from a group that is still awaiting an answer.
 */
type SentGroupInvitation = {
    id: string;
    inviteeUsername: string;
    createdAt: string;
};
/**
 * An open invitation addressed to this user: an offer to join somebody else's group.
 */
type ReceivedGroupInvitation = {
    id: string;
    groupId: string;
    groupName: string;
    inviterUsername: string;
    createdAt: string;
};
/**
 * One shared group this user belongs to.
 */
type GroupInfo = {
    groupId: string;
    name: string;
    role: GroupRole;
    /** The group's shared vault, or null while no admin has created one yet. Nobody can be invited before it exists. */
    manifestId: string | null;
    members: GroupMemberInfo[];
    /** Open invitations sent from this group. Only served to admins, so empty for a plain member. */
    pendingInvitations: SentGroupInvitation[];
};
/**
 * Everything the sharing screen renders, as served by GET /v2/Groups.
 */
type GroupOverviewResponse = {
    groups: GroupInfo[];
    receivedInvitations: ReceivedGroupInvitation[];
};
/**
 * Create a shared group's vault: the manifest blob encrypted with a freshly minted VEK, plus the creator's own copy
 * of that VEK. The server is told which public key was used and looks its own row up from that, so it cannot name a
 * key it holds the private half of and be handed a readable copy of the VEK.
 */
type CreateSharedManifestRequest = {
    manifestId: string;
    name: string;
    manifestBlob: string;
    manifestCiphertextHash?: string;
    selfEncryptedVek: string;
    selfPublicKey: string;
    algorithm: VaultKeyAlgorithmValue;
};
/**
 * The created vault, as served by POST /v2/Groups/{groupId}/manifest.
 */
type CreateSharedManifestResponse = {
    manifestId: string;
    revisionNumber: number;
};
/**
 * Ask which account a username belongs to, and which public key an invitation to it must be sealed for.
 */
type GroupInvitationRecipientRequest = {
    username: string;
};
/**
 * A user a manifest VEK can be encrypted for, with the public key to encrypt it with.
 */
type GrantRecipient = {
    userId: string;
    publicKeyId: string;
    publicKey: string;
};
/**
 * The resolved recipient, as served by POST /v2/Groups/{groupId}/invitations/recipient.
 */
type GroupInvitationRecipientResponse = {
    recipient: GrantRecipient;
};
/**
 * One recipient's copy of a manifest VEK, encrypted for a public key of theirs.
 */
type ManifestGrant = {
    recipientUserId: string;
    recipientPublicKeyId: string;
    encryptedVek: string;
};
/**
 * Invite an account to a group, handing over the group's vault key sealed for them in the same call: accepting is
 * then the single step that makes someone a member and gives them the key.
 */
type CreateGroupInvitationRequest = {
    userId: string;
    grant: ManifestGrant;
    algorithm: VaultKeyAlgorithmValue;
};
/**
 * The sent invitation, as served by POST /v2/Groups/{groupId}/invitations.
 */
type CreateGroupInvitationResponse = {
    invitationId: string;
};

export { type ApiErrorResponse, AuthEventType, type AuthLogModel, type BadRequestResponse, type CreateGroupInvitationRequest, type CreateGroupInvitationResponse, type CreateSharedManifestRequest, type CreateSharedManifestResponse, type DeleteAccountInitiateRequest, type DeleteAccountInitiateResponse, type DeleteAccountRequest, type Email, type EmailAttachment, type EmailDecryptionKey, type FaviconExtractModel, type GrantRecipient, type GroupInfo, type GroupInvitationRecipientRequest, type GroupInvitationRecipientResponse, type GroupMemberInfo, type GroupOverviewResponse, type GroupRole, type LoginRequest, type LoginResponse, type MailboxBulkRequest, type MailboxBulkResponse, type MailboxEmail, type ManifestGrant, ManifestKeyType, type ManifestKeyTypeValue, type ManifestRevision, type MobileLoginInitiateRequest, type MobileLoginInitiateResponse, type MobileLoginPollResponse, type MobileLoginSubmitRequest, type PasswordChangeInitiateResponse, type ReceivedGroupInvitation, type RefreshToken, type SentGroupInvitation, type StatusResponse, type StatusResponseV2, type TokenModel, UnlockMethodType, type UnlockMethodTypeValue, type ValidateLoginRequest, type ValidateLoginRequest2Fa, type ValidateLoginResponse, type Vault, VaultKeyAlgorithm, type VaultKeyAlgorithmValue, type VaultKeyGetResponse, type VaultKeyResponse, type VaultPasswordChangeRequest, type VaultPostResponse, type VaultResponse };
