/**
 * Application error codes for the browser extension.
 *
 * These codes serve two purposes:
 * 1. Enable multi-language support by mapping codes to translation keys
 * 2. Provide debugging information when users report "unknown errors"
 *
 * When displayed to users, show: "Error occurred (Code: E-XXX)"
 * This allows users to report the code for debugging while keeping messages translatable.
 *
 * Code ranges:
 * - E-0xx: Generic errors
 * - E-1xx: Auth status check errors
 * - E-2xx: Vault retrieval errors (handleGetVault)
 * - E-3xx: Item/credential operations
 * - E-4xx: Passkey operations
 * - E-5xx: Sync operations (handleFullVaultSync)
 * - E-6xx: Storage read/write errors
 * - E-7xx: Merge operations
 * - E-8xx: Upload operations
 * - E-9xx: Migration/version errors
 */
export enum AppErrorCode {
  // Generic errors (E-0xx)
  UNKNOWN_ERROR = 'E-001',

  // Auth status check errors (E-1xx) - handleCheckAuthStatus
  AUTH_STATUS_CHECK_FAILED = 'E-101',
  AUTH_STATUS_MIGRATION_CHECK_FAILED = 'E-102',
  AUTH_VERSION_CHECK_FAILED = 'E-103',

  // Vault retrieval errors (E-2xx) - handleGetVault
  VAULT_NOT_FOUND = 'E-201', // No encrypted vault in storage
  VAULT_LOCKED = 'E-202', // No encryption key available
  VAULT_DECRYPT_FAILED = 'E-203', // Decryption failed
  VAULT_METADATA_READ_FAILED = 'E-204', // Failed to read vault metadata

  // Item/credential operations (E-3xx) - handleCreateItem, handleUpdateItem, etc.
  ITEM_CREATE_FAILED = 'E-301',
  ITEM_UPDATE_FAILED = 'E-302',
  ITEM_DELETE_FAILED = 'E-303',
  ITEM_READ_FAILED = 'E-304',

  // Passkey operations (E-4xx)
  PASSKEY_CREATE_FAILED = 'E-401',
  PASSKEY_GET_FAILED = 'E-402',

  // Sync operations (E-5xx) - handleFullVaultSync
  SYNC_STATUS_CHECK_FAILED = 'E-501', // Failed to get server status
  SYNC_VAULT_FETCH_FAILED = 'E-502', // Failed to fetch vault from server
  SYNC_VAULT_DECRYPT_FAILED = 'E-503', // Failed to decrypt server vault
  SYNC_STORE_FAILED = 'E-504', // Failed to store synced vault locally

  // Storage read/write errors (E-6xx)
  STORAGE_READ_FAILED = 'E-601',
  STORAGE_WRITE_FAILED = 'E-602',
  DATABASE_INIT_FAILED = 'E-603',
  ENCRYPTION_KEY_NOT_FOUND = 'E-604',

  // Merge operations (E-7xx)
  MERGE_FAILED = 'E-701',
  MERGE_CONFLICT = 'E-702',
  MERGE_UPLOAD_FAILED = 'E-703',

  // Upload operations (E-8xx)
  UPLOAD_FAILED = 'E-801',
  UPLOAD_OUTDATED = 'E-802', // Server has newer version
  UPLOAD_ENCRYPT_FAILED = 'E-803',

  // Migration/version errors (E-9xx)
  MIGRATION_CHECK_FAILED = 'E-901',
  VERSION_INCOMPATIBLE = 'E-902',
}

/**
 * All valid error code values for quick lookup
 */
const ERROR_CODE_VALUES = new Set(Object.values(AppErrorCode));

/**
 * Check if a string is a valid error code (E-XXX format)
 */
export function isErrorCode(code: string): code is AppErrorCode {
  return ERROR_CODE_VALUES.has(code as AppErrorCode);
}

/**
 * Extract error code from a string (e.g., "Error occurred (Code: E-501)" -> "E-501")
 */
export function extractErrorCode(message: string): AppErrorCode | null {
  // Match E-XXX pattern
  const match = message.match(/E-\d{3}/);
  if (match && isErrorCode(match[0])) {
    return match[0] as AppErrorCode;
  }
  return null;
}

/**
 * Format an error message with an error code for user display.
 * This allows users to report the code for debugging while keeping the message readable.
 *
 * @param message - The user-friendly error message (translated)
 * @param code - The error code for debugging
 * @returns Formatted message like "Error occurred (Code: E-501)"
 */
export function formatErrorWithCode(message: string, code: AppErrorCode): string {
  return `${message} (Code: ${code})`;
}

/**
 * Map error codes to translation keys for localized error messages.
 * Returns the translation key that should be used with t() function.
 */
export function getErrorTranslationKey(code: AppErrorCode): string {
  const codeToKeyMap: Record<AppErrorCode, string> = {
    // Generic errors (E-0xx)
    [AppErrorCode.UNKNOWN_ERROR]: 'common.errors.unknownErrorTryAgain',

    // Auth status check errors (E-1xx)
    [AppErrorCode.AUTH_STATUS_CHECK_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.AUTH_STATUS_MIGRATION_CHECK_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.AUTH_VERSION_CHECK_FAILED]: 'common.errors.unknownErrorTryAgain',

    // Vault retrieval errors (E-2xx)
    [AppErrorCode.VAULT_NOT_FOUND]: 'common.errors.vaultNotAvailable',
    [AppErrorCode.VAULT_LOCKED]: 'common.errors.vaultIsLocked',
    [AppErrorCode.VAULT_DECRYPT_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.VAULT_METADATA_READ_FAILED]: 'common.errors.unknownErrorTryAgain',

    // Item/credential operations (E-3xx)
    [AppErrorCode.ITEM_CREATE_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.ITEM_UPDATE_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.ITEM_DELETE_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.ITEM_READ_FAILED]: 'common.errors.unknownErrorTryAgain',

    // Passkey operations (E-4xx)
    [AppErrorCode.PASSKEY_CREATE_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.PASSKEY_GET_FAILED]: 'common.errors.unknownErrorTryAgain',

    // Sync operations (E-5xx)
    [AppErrorCode.SYNC_STATUS_CHECK_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.SYNC_VAULT_FETCH_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.SYNC_VAULT_DECRYPT_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.SYNC_STORE_FAILED]: 'common.errors.unknownErrorTryAgain',

    // Storage read/write errors (E-6xx)
    [AppErrorCode.STORAGE_READ_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.STORAGE_WRITE_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.DATABASE_INIT_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.ENCRYPTION_KEY_NOT_FOUND]: 'common.errors.vaultIsLocked',

    // Merge operations (E-7xx)
    [AppErrorCode.MERGE_FAILED]: 'common.errors.mergeFailed',
    [AppErrorCode.MERGE_CONFLICT]: 'common.errors.mergeFailed',
    [AppErrorCode.MERGE_UPLOAD_FAILED]: 'common.errors.unknownErrorTryAgain',

    // Upload operations (E-8xx)
    [AppErrorCode.UPLOAD_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.UPLOAD_OUTDATED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.UPLOAD_ENCRYPT_FAILED]: 'common.errors.unknownErrorTryAgain',

    // Migration/version errors (E-9xx)
    [AppErrorCode.MIGRATION_CHECK_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.VERSION_INCOMPATIBLE]: 'common.errors.browserExtensionOutdated',
  };

  return codeToKeyMap[code] || 'common.errors.unknownErrorTryAgain';
}

/**
 * Check if an error has an embedded error code (E-XXX format).
 * Use this to determine if an error message should be shown as-is (preserving the code)
 * rather than being replaced with a generic error message.
 *
 * @param err - The error (can be Error, string, or unknown)
 * @returns true if the error contains an E-XXX code
 */
export function hasErrorCode(err: unknown): boolean {
  if (err instanceof Error) {
    return extractErrorCode(err.message) !== null;
  }
  if (typeof err === 'string') {
    return extractErrorCode(err) !== null;
  }
  return false;
}

/**
 * Get the error message from an error, preserving error codes if present.
 * Use this when you want to display an error to the user and want to preserve
 * any embedded error codes for debugging/reporting purposes.
 *
 * @param err - The error (can be Error, string, or unknown)
 * @param fallback - Fallback message if error has no message
 * @returns The error message (with code if present)
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return fallback;
}
