/**
 * Credential SQLite database type.
 */
export type Credential = {
    Id: string;
    Username?: string;
    Password: string;
    ServiceName: string;
    ServiceUrl?: string;
    Logo?: Uint8Array | number[];
    Notes?: string;
    Alias: Alias;
    /** Indicates if this credential has an associated passkey */
    HasPasskey?: boolean;
    /** The relying party ID (domain) of the associated passkey */
    PasskeyRpId?: string;
    /** The display name of the associated passkey */
    PasskeyDisplayName?: string;
    /** Indicates if this credential has one or more attachments */
    HasAttachment?: boolean;
}

/**
 * Alias SQLite database type.
 */
export type Alias = {
    FirstName?: string;
    LastName?: string;
    BirthDate: string;
    Gender?: string;
    Email?: string;
}