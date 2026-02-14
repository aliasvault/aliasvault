/**
 * App error codes for mobile app operations.
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
 * - E-1xx: Authentication errors
 * - E-2xx: Network/connectivity errors
 * - E-3xx: Version/compatibility errors
 * - E-4xx: Vault status errors
 * - E-5xx: Decryption/Encryption errors
 * - E-6xx: Database/Storage errors
 * - E-7xx: Merge errors
 * - E-8xx: Upload errors
 * - E-9xx: Native module errors
 */
export enum AppErrorCode {
  // Generic errors (E-0xx) - from AppError.kt
  UNKNOWN_ERROR = 'E-001',
  PARSE_ERROR = 'E-002',

  // Authentication errors (E-1xx) - from AppError.kt
  AUTHENTICATION_FAILED = 'E-101',
  SESSION_EXPIRED = 'E-102',
  PASSWORD_CHANGED = 'E-103',

  // Network/connectivity errors (E-2xx) - from AppError.kt
  SERVER_UNAVAILABLE = 'E-201',
  NETWORK_ERROR = 'E-202',
  TIMEOUT = 'E-203',

  // Version/compatibility errors (E-3xx) - from AppError.kt
  CLIENT_VERSION_NOT_SUPPORTED = 'E-301',
  SERVER_VERSION_NOT_SUPPORTED = 'E-302',
  VAULT_VERSION_INCOMPATIBLE = 'E-303',

  // Vault status errors (E-4xx) - from AppError.kt + VaultSync.kt
  VAULT_MERGE_REQUIRED = 'E-401',
  VAULT_OUTDATED = 'E-402',
  VAULT_NOT_FOUND = 'E-403', // VaultSync.kt: no local vault for merge

  // Decryption/Encryption errors (E-5xx) - from AppError.kt
  VAULT_DECRYPT_FAILED = 'E-501',
  ENCRYPTION_KEY_NOT_FOUND = 'E-502', // AppError: encryption key not available
  BASE64_DECODE_FAILED = 'E-503', // AppError: base64 decode failed after decryption
  DATABASE_TEMP_WRITE_FAILED = 'E-504', // AppError: could not write temp file
  DATABASE_OPEN_FAILED = 'E-505', // AppError: could not open source database
  DATABASE_MEMORY_FAILED = 'E-506', // AppError: could not create in-memory connection
  DATABASE_BACKUP_FAILED = 'E-507', // AppError: backup/copy failed
  DATABASE_PRAGMA_FAILED = 'E-508', // AppError: pragma execution failed
  BIOMETRIC_CANCELLED = 'E-509', // AppError: biometric authentication cancelled
  BIOMETRIC_FAILED = 'E-510', // AppError: biometric authentication failed
  KEYSTORE_KEY_NOT_FOUND = 'E-511', // AppError: encryption key not found in keystore
  KEYCHAIN_ACCESS_DENIED = 'E-512', // iOS: keychain access denied (entitlement or access group issue)
  KEYCHAIN_ITEM_NOT_FOUND = 'E-513', // iOS: keychain item not found (may need re-login)
  BIOMETRIC_NOT_AVAILABLE = 'E-514', // iOS: biometric not available on device
  BIOMETRIC_NOT_ENROLLED = 'E-515', // iOS: no biometrics enrolled on device
  BIOMETRIC_LOCKOUT = 'E-516', // iOS: biometric locked out due to too many failed attempts

  // Database/Storage errors (E-6xx) - from VaultSync.kt
  VAULT_STORE_FAILED = 'E-604', // AppError: failed to store vault

  // Merge errors (E-7xx) - from VaultSync.kt
  MERGE_FAILED = 'E-701', // AppError: vault merge failed
  MERGE_UPLOAD_FAILED = 'E-705', // AppError: upload after merge failed

  // Upload errors (E-8xx) - from VaultSync.kt
  UPLOAD_FAILED = 'E-801', // AppError: vault upload failed

  // Native module/retry errors (E-9xx)
  MAX_RETRIES_REACHED = 'E-901', // AppError: max sync retries reached
  NATIVE_UNLOCK_FAILED = 'E-902', // useVaultSync.ts: vault unlock failed
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
 * Check if an error is a vault sync error with a code property
 */
export function isAppError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    isErrorCode((error as { code: string }).code)
  );
}

/**
 * Get the vault sync error code from an error object or string
 */
export function getAppErrorCode(error: unknown): AppErrorCode | null {
  // Check if error object has code property
  if (isAppError(error)) {
    return error.code as AppErrorCode;
  }

  // Check if error message contains an error code
  if (error instanceof Error && error.message) {
    const code = extractErrorCode(error.message);
    if (code) {
      return code;
    }
  }

  // Check if it's a string that is or contains an error code
  if (typeof error === 'string') {
    if (isErrorCode(error)) {
      return error;
    }
    const code = extractErrorCode(error);
    if (code) {
      return code;
    }
  }

  return null;
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
 * Create an error with an attached code for proper error handling chain.
 */
export class AppCodedError extends Error {
  public readonly code: AppErrorCode;

  constructor(message: string, code: AppErrorCode) {
    super(formatErrorWithCode(message, code));
    this.code = code;
    this.name = 'AppCodedError';
  }
}

/**
 * Map error codes to translation keys for localized error messages.
 * Returns the translation key that should be used with t() function.
 */
export function getErrorTranslationKey(code: AppErrorCode): string {
  const codeToKeyMap: Record<AppErrorCode, string> = {
    // Generic errors
    [AppErrorCode.UNKNOWN_ERROR]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.PARSE_ERROR]: 'common.errors.unknownErrorTryAgain',

    // Authentication errors
    [AppErrorCode.AUTHENTICATION_FAILED]: 'auth.errors.sessionExpired',
    [AppErrorCode.SESSION_EXPIRED]: 'auth.errors.sessionExpired',
    [AppErrorCode.PASSWORD_CHANGED]: 'vault.errors.passwordChanged',

    // Network errors
    [AppErrorCode.SERVER_UNAVAILABLE]: 'auth.errors.serverError',
    [AppErrorCode.NETWORK_ERROR]: 'auth.errors.networkError',
    [AppErrorCode.TIMEOUT]: 'auth.errors.networkError',

    // Version errors
    [AppErrorCode.CLIENT_VERSION_NOT_SUPPORTED]: 'vault.errors.versionNotSupported',
    [AppErrorCode.SERVER_VERSION_NOT_SUPPORTED]: 'vault.errors.serverVersionNotSupported',
    [AppErrorCode.VAULT_VERSION_INCOMPATIBLE]: 'vault.errors.appOutdated',

    // Vault status errors
    [AppErrorCode.VAULT_MERGE_REQUIRED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.VAULT_OUTDATED]: 'vault.errors.vaultOutdated',
    [AppErrorCode.VAULT_NOT_FOUND]: 'common.errors.unknownErrorTryAgain',

    // Decryption/Encryption errors
    [AppErrorCode.VAULT_DECRYPT_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.ENCRYPTION_KEY_NOT_FOUND]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.BASE64_DECODE_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.DATABASE_TEMP_WRITE_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.DATABASE_OPEN_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.DATABASE_MEMORY_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.DATABASE_BACKUP_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.DATABASE_PRAGMA_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.BIOMETRIC_CANCELLED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.BIOMETRIC_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.KEYSTORE_KEY_NOT_FOUND]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.KEYCHAIN_ACCESS_DENIED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.KEYCHAIN_ITEM_NOT_FOUND]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.BIOMETRIC_NOT_AVAILABLE]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.BIOMETRIC_NOT_ENROLLED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.BIOMETRIC_LOCKOUT]: 'common.errors.unknownErrorTryAgain',

    // Database/Storage errors
    [AppErrorCode.VAULT_STORE_FAILED]: 'common.errors.unknownErrorTryAgain',

    // Merge errors
    [AppErrorCode.MERGE_FAILED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.MERGE_UPLOAD_FAILED]: 'common.errors.unknownErrorTryAgain',

    // Upload errors
    [AppErrorCode.UPLOAD_FAILED]: 'common.errors.unknownErrorTryAgain',

    // Native module/retry errors
    [AppErrorCode.MAX_RETRIES_REACHED]: 'common.errors.unknownErrorTryAgain',
    [AppErrorCode.NATIVE_UNLOCK_FAILED]: 'common.errors.unknownErrorTryAgain',
  };

  return codeToKeyMap[code] || 'common.errors.unknownErrorTryAgain';
}
