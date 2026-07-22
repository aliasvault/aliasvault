/**
 * Vault key response type (KEK/VEK model). Returned by GET /v2/VaultKey/{keyType}.
 * Carries the wrapped VEK plus the KEK derivation parameters so an authenticated client can derive the KEK from
 * the unlock secret and unwrap the vault encryption key. The SRP verifier is never returned.
 */
export type VaultKeyResponse = {
  /** The unlock method type, e.g. "password". */
  keyType: string;
  /** The wrapped VEK: base64(IV ‖ ciphertext ‖ authTag) of the VEK encrypted with the KEK (AES-256-GCM). */
  wrappedVek: string;
  /** The salt used for KEK derivation (same value as the SRP salt for the password key type). */
  salt: string;
  /** The key derivation type, e.g. "Argon2Id". */
  encryptionType: string;
  /** The key derivation settings as a JSON string. */
  encryptionSettings: string;
}

/**
 * Envelope returned by GET /v2/VaultKey/{keyType} with HTTP 200. A null vaultKey means the user has no vault key
 * of the requested type (legacy user). An HTTP 404 on the endpoint itself means the server does not implement
 * vault keys at all (older server version) and must be treated differently: fall back to any locally cached
 * wrapped VEK instead of assuming a legacy account.
 */
export type VaultKeyGetResponse = {
  vaultKey: VaultKeyResponse | null;
}
