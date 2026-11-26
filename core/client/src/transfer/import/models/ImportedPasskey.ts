/**
 * A passkey in the intermediary import format.
 */
export type ImportedPasskey = {
  /** The WebAuthn credential id the relying party knows. */
  CredentialId?: Uint8Array | null;
  RpId: string;
  /** The user handle (user id provided by the relying party). */
  UserHandle?: Uint8Array | null;
  /** Public key (JWK format). */
  PublicKey: string;
  /** Private key (JWK format). */
  PrivateKey: string;
  /** The PRF (hmac-secret) secret, 32 bytes. */
  PrfKey?: Uint8Array | null;
  DisplayName: string;
  AdditionalData?: Uint8Array | null;
};
