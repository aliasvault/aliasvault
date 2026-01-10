/**
 * TotpCode SQLite database type.
 */
export type TotpCode = {
    /** The ID of the TOTP code */
    Id: string;

    /** The name of the TOTP code */
    Name: string;

    /** The secret key for the TOTP code */
    SecretKey: string;

    /** The item ID this TOTP code belongs to */
    ItemId: string;

    /** Whether the TOTP code has been deleted (soft delete) */
    IsDeleted?: boolean;
}
