/**
 * A passkey in the intermediary import format.
 */
export type ImportedPasskey = {
  /** The passkey id from the original record, preserved through import/export. */
  Id?: string | null;
  RpId: string;
  /** The user handle (user id provided by the relying party). */
  UserHandle?: Uint8Array | null;
  /** Public key (JWK format). */
  PublicKey: string;
  /** Private key (JWK format). */
  PrivateKey: string;
  PrfKey?: Uint8Array | null;
  DisplayName: string;
};
