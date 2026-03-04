/**
 * Top-level vault JSON structure.
 * Replaces the SQLite binary database with a JSON-serializable format.
 */
export type VaultJson = {
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
export type CredentialTree = {
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
export type AliasEntry = {
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
export type PasswordEntry = {
  value: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * File attachment stored as base64-encoded binary in JSON.
 */
export type AttachmentEntry = {
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
export type TotpEntry = {
  id: string;
  name: string;
  secretKey: string;
  isDeleted: boolean;
};

/**
 * Passkey (WebAuthn credential) entry.
 */
export type PasskeyEntry = {
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
export type EncryptionKeyEntry = {
  id: string;
  publicKey: string;
  privateKey: string;
  isPrimary: boolean;
};

/**
 * Summary of what changed during a vault merge.
 * Each array contains credential IDs affected by that merge action.
 */
export type MergeSummary = {
  added: string[];
  updated: string[];
  deleted: string[];
  kept: string[];
};

/**
 * Result of resolveVaultConflict(): the merged vault and a summary of changes.
 */
export type MergeResult = {
  merged: VaultJson;
  summary: MergeSummary;
};
