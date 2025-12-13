/**
 * Encryption key SQLite database type.
 */
export type EncryptionKey = {
    Id: string;
    PublicKey: string;
    PrivateKey: string;
    IsPrimary: boolean;
}
