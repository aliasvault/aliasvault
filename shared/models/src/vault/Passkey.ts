/**
 * Passkey SQLite database type.
 */
export type Passkey = {
    /** The ID of the passkey */
    Id: string;

    /** The credential ID foreign key */
    CredentialId: string;

    /** The relying party identifier */
    RpId: string;

    /** The user ID provided by the relying party */
    UserId?: string | null;

    /** The public key */
    PublicKey: string;

    /** The private key */
    PrivateKey: string;

    /** The PRF encryption key associated with the passkey (optional, only set if PRF was requested by RP) */
    PrfKey?: Uint8Array | number[];

    /** The display name for the passkey */
    DisplayName: string;

    /** Additional data as JSON blob (Base64 encoded) */
    AdditionalData?: string | null;

    /** Created timestamp (epoch milliseconds) */
    CreatedAt: number;

    /** Updated timestamp (epoch milliseconds) */
    UpdatedAt: number;

    /** Soft delete flag (0/1) */
    IsDeleted: number;
}
