/**
 * Constants for the .avex (AliasVault Encrypted eXport) file format.
 */
export const AvexConstants = {
  /**
   * The delimiter that separates the JSON header from the encrypted payload in .avex files.
   */
  HeaderDelimiter: '\n-----BEGIN ENCRYPTED DATA-----\n',

  /**
   * The .avex file format identifier.
   */
  FormatIdentifier: 'avex',

  /*
   * The .avex format version. This is the structure version of the container itself, independent of the
   * AliasVault application version that created the export. When changing it, also update the import logic
   * to support both the old and the new version, as all current logic checks for 1.0.0 explicitly.
   * Version history:
   * - 1.0.0: Initial .avex format with Argon2id KDF + AES-256-GCM encryption.
   */
  FormatVersion: '1.0.0',
} as const;
