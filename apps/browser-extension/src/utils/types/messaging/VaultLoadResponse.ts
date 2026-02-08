/**
 * Response type for LOAD_VAULT_FROM_BLOCKCHAIN message handler.
 * Returned from background → popup via webext-bridge.
 */
export type VaultLoadResponse = {
  success: boolean;
  error?: string;
  /** True if vault on-chain matches local — no download needed. */
  upToDate?: boolean;
  /** True if no vault registration found on-chain (new user). */
  notRegistered?: boolean;
  /** Base64-encoded encrypted vault blob (for message passing). */
  encryptedBlob?: string;
  /** CIDv1 string of the vault blob. */
  cid?: string;
  /** Hex-encoded SHA-256 hash of the CID string. */
  cidHash?: string;
  /** Whether the error is retryable. */
  retryable?: boolean;
};
