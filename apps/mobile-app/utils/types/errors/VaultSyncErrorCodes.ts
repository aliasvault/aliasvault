/**
 * Error codes for vault sync operations
 * These codes are returned from native layer and should be used instead of parsing error messages
 * This enables multi-language support and robust error handling
 */
export enum VaultSyncErrorCode {
  // Authentication errors
  AUTHENTICATION_FAILED = 'VAULT_SYNC_AUTH_FAILED',
  SESSION_EXPIRED = 'VAULT_SYNC_SESSION_EXPIRED',
  PASSWORD_CHANGED = 'VAULT_SYNC_PASSWORD_CHANGED',

  // Network/connectivity errors
  SERVER_UNAVAILABLE = 'VAULT_SYNC_SERVER_UNAVAILABLE',
  NETWORK_ERROR = 'VAULT_SYNC_NETWORK_ERROR',
  TIMEOUT = 'VAULT_SYNC_TIMEOUT',

  // Version/compatibility errors
  CLIENT_VERSION_NOT_SUPPORTED = 'VAULT_SYNC_CLIENT_VERSION_NOT_SUPPORTED',
  SERVER_VERSION_NOT_SUPPORTED = 'VAULT_SYNC_SERVER_VERSION_NOT_SUPPORTED',
  VAULT_VERSION_INCOMPATIBLE = 'VAULT_SYNC_VAULT_VERSION_INCOMPATIBLE',

  // Vault status errors
  VAULT_MERGE_REQUIRED = 'VAULT_SYNC_MERGE_REQUIRED',
  VAULT_OUTDATED = 'VAULT_SYNC_OUTDATED',

  // Decryption errors
  VAULT_DECRYPT_FAILED = 'VAULT_SYNC_DECRYPT_FAILED',

  // Generic errors
  UNKNOWN_ERROR = 'VAULT_SYNC_UNKNOWN_ERROR',
  PARSE_ERROR = 'VAULT_SYNC_PARSE_ERROR',
}

/**
 * Check if an error is a vault sync error
 */
export function isVaultSyncError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('VAULT_SYNC_')
  );
}

/**
 * Get the vault sync error code from an error object
 */
export function getVaultSyncErrorCode(error: unknown): VaultSyncErrorCode | null {
  if (isVaultSyncError(error)) {
    return error.code as VaultSyncErrorCode;
  }
  return null;
}
