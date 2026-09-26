/*
 * The header of an .avex (encrypted export) file. Property names are the JSON wire names (camelCase).
 */

/**
 * Key derivation function parameters.
 */
export type AvexKdfParams = {
  /** The KDF algorithm type. */
  type: string;
  /** The salt value (base64-encoded). */
  salt: string;
  /** Algorithm-specific parameters, keyed as the Rust core expects them (DegreeOfParallelism, MemorySize, Iterations). */
  params: Record<string, number>;
};

/**
 * Encryption algorithm parameters.
 */
export type AvexEncryptionParams = {
  algorithm: string;
  /** The byte offset where the encrypted data begins. */
  encryptedDataOffset: number;
};

/**
 * Metadata about the export.
 */
export type AvexMetadata = {
  exportedAt: string;
  exportedBy: string;
  /** The AliasVault application version that created this export. */
  appVersion?: string | null;
};

/**
 * The header for an .avex file.
 */
export type AvexHeader = {
  format: string;
  /** The .avex container format version (not the app version). */
  version: string;
  kdf: AvexKdfParams;
  encryption: AvexEncryptionParams;
  metadata: AvexMetadata;
};
