/**
 * Represents a delete account request.
 */
export type DeleteAccountRequest = {
  username: string;
  clientPublicEphemeral: string;
  clientSessionProof: string;
};
