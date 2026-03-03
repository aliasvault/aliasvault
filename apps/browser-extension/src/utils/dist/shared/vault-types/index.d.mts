import { Credential, Attachment, TotpCode, PasswordSettings, EncryptionKey, Passkey } from '@aliasvault/models/vault';

/**
 * Top-level vault JSON structure.
 * Replaces the SQLite binary database with a JSON-serializable format.
 */
type VaultJson = {
    version: number;
    credentials: Record<string, CredentialTree>;
    settings: Record<string, string>;
    encryptionKeys: EncryptionKeyEntry[];
    lastModified?: number;
};
/**
 * Denormalized credential combining Service, Alias, Credential, and Password
 * into a single tree with child arrays for attachments, TOTP codes, and passkeys.
 */
type CredentialTree = {
    id: string;
    serviceName: string;
    serviceUrl?: string;
    logo?: string;
    username?: string;
    password: PasswordEntry;
    notes?: string;
    alias: AliasEntry;
    attachments: AttachmentEntry[];
    totpCodes: TotpEntry[];
    passkeys: PasskeyEntry[];
    createdAt: number;
    updatedAt: number;
    isDeleted: boolean;
};
/**
 * Alias identity data associated with a credential.
 */
type AliasEntry = {
    firstName?: string;
    lastName?: string;
    nickName?: string;
    birthDate: string;
    gender?: string;
    email?: string;
};
/**
 * Password value with timestamps.
 */
type PasswordEntry = {
    value: string;
    createdAt: number;
    updatedAt: number;
};
/**
 * File attachment stored as base64-encoded binary in JSON.
 */
type AttachmentEntry = {
    id: string;
    filename: string;
    blob: string;
    createdAt: number;
    updatedAt: number;
    isDeleted: boolean;
};
/**
 * TOTP (Time-based One-Time Password) entry.
 */
type TotpEntry = {
    id: string;
    name: string;
    secretKey: string;
    isDeleted: boolean;
};
/**
 * Passkey (WebAuthn credential) entry.
 */
type PasskeyEntry = {
    id: string;
    credentialId: string;
    rpId: string;
    userHandle?: string;
    publicKey: string;
    privateKey: string;
    prfKey?: string;
    displayName: string;
    additionalData?: string;
    createdAt: number;
    updatedAt: number;
    isDeleted: boolean;
};
/**
 * Encryption key entry in the vault.
 */
type EncryptionKeyEntry = {
    id: string;
    publicKey: string;
    privateKey: string;
    isPrimary: boolean;
};

declare class VaultStore {
    private vault;
    private constructor();
    static fromJson(json: string): VaultStore;
    toJson(): string;
    static createEmpty(): VaultStore;
    getAllCredentials(): Credential[];
    getCredentialById(id: string): Credential | null;
    createCredential(credential: Credential, attachments: Attachment[], totpCodes?: TotpCode[]): Promise<string>;
    updateCredentialById(credential: Credential, originalAttachmentIds: string[], attachments: Attachment[], originalTotpCodeIds?: string[], totpCodes?: TotpCode[]): Promise<number>;
    deleteCredentialById(id: string): Promise<number>;
    getSetting(key: string, defaultValue?: string): string;
    setSetting(key: string, value: string): void;
    getDefaultEmailDomain(): Promise<string | null>;
    getDefaultIdentityLanguage(): string;
    getEffectiveIdentityLanguage(): Promise<string>;
    getDefaultIdentityGender(): string;
    getDefaultIdentityAgeRange(): string;
    getPasswordSettings(): PasswordSettings;
    getAllEncryptionKeys(): EncryptionKey[];
    addEncryptionKey(key: EncryptionKey): void;
    getPasskeysByRpId(rpId: string): Array<Passkey & {
        Username?: string | null;
        ServiceName?: string | null;
    }>;
    getPasskeyById(passkeyId: string): (Passkey & {
        Username?: string | null;
        ServiceName?: string | null;
    }) | null;
    getPasskeysByCredentialId(credentialId: string): Passkey[];
    createPasskey(passkey: Omit<Passkey, 'CreatedAt' | 'UpdatedAt' | 'IsDeleted'>): Promise<void>;
    deletePasskeyById(passkeyId: string): Promise<number>;
    deletePasskeysByCredentialId(credentialId: string): Promise<number>;
    updatePasskeyDisplayName(passkeyId: string, displayName: string): Promise<number>;
    getAttachmentsForCredential(credentialId: string): Attachment[];
    getTotpCodesForCredential(credentialId: string): TotpCode[];
    getAllEmailAddresses(): string[];
    hasPendingMigrations(): Promise<boolean>;
    getDatabaseVersion(): number;
    private treeToCredential;
    private entryToPasskey;
}

export { type AliasEntry, type AttachmentEntry, type CredentialTree, type EncryptionKeyEntry, type PasskeyEntry, type PasswordEntry, type TotpEntry, type VaultJson, VaultStore };
