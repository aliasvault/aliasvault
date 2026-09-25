/**
 * Vault key response type (account-key model). Returned by GET /v2/VaultKey/{type}.
 */
export type VaultKeyResponse = {
  type: string;
  encryptedAccountKey: string;
  encryptedAccountPrivateKey: string | null;
  accountPublicKey: string | null;
  encryptedVek: string | null;
  salt: string;
  encryptionType: string;
  encryptionSettings: string;
}

/**
 * Envelope returned by GET /v2/VaultKey/{type} with HTTP 200.
 */
export type VaultKeyGetResponse = {
  vaultKey: VaultKeyResponse | null;
}
