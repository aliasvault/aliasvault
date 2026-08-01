/**
 * Encryption key SQLite database type.
 */
export type EncryptionKey = {
    Id: string;
    ManifestId?: string | null;
    PublicKey: string;
    PrivateKey: string;
    IsPrimary: boolean;
}
