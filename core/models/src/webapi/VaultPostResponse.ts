/**
 * Vault post response type returned after uploading a new vault to the server.
 */
export type VaultPostResponse = {
  status: number;
  newRevisionNumber: number;
}