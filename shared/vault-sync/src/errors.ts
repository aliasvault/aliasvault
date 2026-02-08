/**
 * Vault sync error codes per architecture Pattern 4.
 */
export const VaultSyncErrorCodes = {
  IPFS_UPLOAD_FAILED: 'VAULT_SYNC_IPFS_UPLOAD_FAILED',
  CONTRACT_UPDATE_FAILED: 'VAULT_SYNC_CONTRACT_UPDATE_FAILED',
  CID_PERSISTENCE_FAILED: 'VAULT_SYNC_CID_PERSISTENCE_FAILED',
  WALLET_NOT_CONNECTED: 'VAULT_SYNC_WALLET_NOT_CONNECTED',
  INVALID_ENCRYPTED_DATA: 'VAULT_SYNC_INVALID_ENCRYPTED_DATA',
} as const;

export type VaultSyncErrorCode = typeof VaultSyncErrorCodes[keyof typeof VaultSyncErrorCodes];

/**
 * Structured vault sync error with retry metadata.
 */
export class VaultSyncError extends Error {
  public readonly code: VaultSyncErrorCode;
  public readonly retryable: boolean;
  public readonly cause?: Error;

  constructor(code: VaultSyncErrorCode, message: string, retryable: boolean, cause?: Error) {
    super(message);
    this.name = 'VaultSyncError';
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
  }
}
