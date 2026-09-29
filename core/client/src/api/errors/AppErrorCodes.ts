import type { TranslationKey } from '@aliasvault/i18n';

/**
 * The main registry for error codes of all AliasVault clients: web app, browser extension and mobile app and the Rust sync engine.
 * 
 * When adding or changing any error codes, also make sure to apply them to:
 * - apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/AppError.kt
 * - apps/mobile-app/ios/VaultStoreKit/Enums/AppError.swift
 * 
 * These codes serve two purposes:
 * 1. Enable multi-language support by mapping codes to translation keys
 * 2. Provide debugging information for additional context when a user reports an error
 *
 * Code ranges:
 * - E-0xx: Generic errors
 * - E-1xx: Authentication errors
 * - E-2xx: Vault retrieval and unlock errors
 * - E-3xx: Item/credential operations
 * - E-4xx: Passkey operations
 * - E-5xx: Sync operations
 * - E-6xx: Storage read/write errors
 * - E-7xx: Merge operations
 * - E-8xx: Upload operations
 * - E-9xx: Migration/version errors
 */
export enum AppErrorCode {
  // Generic errors (E-0xx)
  UNKNOWN_ERROR = 'E-001',
  BACKGROUND_UNRESPONSIVE = 'E-002', // Background service worker did not answer in time
  NETWORK_ERROR = 'E-003', // The request did not reach the server (offline, DNS, TLS)
  PARSE_ERROR = 'E-004', // Native glue could not encode or decode a JSON payload

  // Authentication errors (E-1xx)
  AUTH_STATUS_CHECK_FAILED = 'E-101',
  AUTH_STATUS_MIGRATION_CHECK_FAILED = 'E-102',
  AUTH_VERSION_CHECK_FAILED = 'E-103',
  AUTHENTICATION_FAILED = 'E-104', // The server refused the session tokens
  SESSION_EXPIRED = 'E-105', // The session expired; log in again
  PASSWORD_CHANGED = 'E-106', // The password was changed on another device

  // Vault retrieval and unlock errors (E-2xx)
  VAULT_NOT_FOUND = 'E-201', // No encrypted vault in storage
  VAULT_LOCKED = 'E-202', // No encryption key available
  VAULT_DECRYPT_FAILED = 'E-203', // The locally stored vault does not decrypt with the session key
  VAULT_METADATA_READ_FAILED = 'E-204', // Failed to read vault metadata
  VAULT_UNLOCK_FAILED = 'E-205', // The vault could not be unlocked for a reason without its own code
  UNLOCK_KEY_REJECTED = 'E-206', // The unlock key does not open the account key (wrong password or PIN)
  KEY_CHAIN_UNREADABLE = 'E-207', // The account key opened, the vault encryption key under it did not
  KEY_OUT_OF_SYNC = 'E-208', // The session key does not open the key chain the server holds (re-login needed)
  BIOMETRIC_CANCELLED = 'E-209', // The user cancelled biometric authentication
  BIOMETRIC_FAILED = 'E-210',
  KEYSTORE_KEY_NOT_FOUND = 'E-211', // The device keystore holds no key for this vault
  KEYCHAIN_ACCESS_DENIED = 'E-212', // iOS: keychain access denied (entitlement or access group issue)
  KEYCHAIN_ITEM_NOT_FOUND = 'E-213', // Keychain or keystore item not found (may need re-login)
  BIOMETRIC_NOT_AVAILABLE = 'E-214',
  BIOMETRIC_NOT_ENROLLED = 'E-215',
  BIOMETRIC_LOCKOUT = 'E-216', // Too many failed biometric attempts

  // Item/credential operations (E-3xx)
  ITEM_CREATE_FAILED = 'E-301',
  ITEM_UPDATE_FAILED = 'E-302',
  ITEM_DELETE_FAILED = 'E-303',
  ITEM_READ_FAILED = 'E-304',

  // Passkey operations (E-4xx)
  PASSKEY_CREATE_FAILED = 'E-401',
  PASSKEY_GET_FAILED = 'E-402',

  // Sync operations (E-5xx)
  SYNC_STATUS_CHECK_FAILED = 'E-501', // Failed to get server status
  SYNC_VAULT_FETCH_FAILED = 'E-502', // The server's vault snapshot cannot be assembled into a vault
  SYNC_VAULT_DECRYPT_FAILED = 'E-503', // A server manifest or bucket fails its hash check or does not decrypt
  SYNC_STORE_FAILED = 'E-504', // Failed to store synced vault locally
  SYNC_SERVER_UNREACHABLE = 'E-505', // Server unreachable and no local vault to fall back on
  SYNC_SERVER_ERROR = 'E-506', // The server answered a sync request with an unexpected HTTP failure
  SYNC_RESPONSE_INVALID = 'E-507', // A server response is not the JSON shape this client expects
  SYNC_CODEC_FAILED = 'E-508', // The core library (codec, merge or crypto) refused the vault data
  SYNC_ENGINE_FAILED = 'E-509', // The sync engine hit a state it has no rule for (the detail says which)

  // Storage read/write errors (E-6xx)
  STORAGE_READ_FAILED = 'E-601',
  STORAGE_WRITE_FAILED = 'E-602',
  DATABASE_INIT_FAILED = 'E-603',
  ENCRYPTION_KEY_NOT_FOUND = 'E-604',
  MANIFEST_NOT_RECORDED = 'E-605', // A write was attempted before a personal manifest id was recorded
  BASE64_DECODE_FAILED = 'E-606', // Base64 decode failed after decryption
  DATABASE_TEMP_WRITE_FAILED = 'E-607',
  DATABASE_OPEN_FAILED = 'E-608',
  DATABASE_MEMORY_FAILED = 'E-609',
  DATABASE_BACKUP_FAILED = 'E-610',
  DATABASE_PRAGMA_FAILED = 'E-611',

  // Merge operations (E-7xx)
  MERGE_FAILED = 'E-701',
  MERGE_CONFLICT = 'E-702', // The server kept refusing the write as outdated after the re-sync limit
  MERGE_UPLOAD_FAILED = 'E-703',

  // Upload operations (E-8xx)
  UPLOAD_FAILED = 'E-801',
  UPLOAD_OUTDATED = 'E-802', // Server has newer version
  UPLOAD_ENCRYPT_FAILED = 'E-803',
  UPLOAD_TOO_LARGE = 'E-804', // Server rejected upload with HTTP 413 (vault exceeds MAX_UPLOAD_SIZE_MB)
  UPLOAD_TIMEOUT = 'E-805', // Vault transfer exceeded the request timeout (large vault and/or slow connection)

  // Migration/version errors (E-9xx)
  MIGRATION_CHECK_FAILED = 'E-901',
  VAULT_VERSION_INCOMPATIBLE = 'E-902', // The vault is newer than this client can read
  SERVER_UPDATE_REQUIRED = 'E-903',
  CLIENT_VERSION_NOT_SUPPORTED = 'E-904', // The server no longer supports this client version
  SERVER_VERSION_NOT_SUPPORTED = 'E-905', // The server is too old for this client
  VAULT_OUTDATED = 'E-906', // The vault has to be upgraded before this client can use it
  VAULT_MERGE_REQUIRED = 'E-907',
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
 * The error code an error carries: the `code` of a native module rejection, or an E-XXX code in its message.
 * @param err - the error (can be Error, string, or unknown)
 */
export function getAppErrorCode(err: unknown): AppErrorCode | null {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' && isErrorCode(err.code)) {
    return err.code;
  }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : null;
  return message ? extractErrorCode(message) : null;
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
 * The translation key of each code with a message of its own.
 */
const ERROR_TRANSLATION_KEYS: Partial<Record<AppErrorCode, TranslationKey>> = {
  [AppErrorCode.BACKGROUND_UNRESPONSIVE]: 'common.errors.backgroundUnresponsive',
  [AppErrorCode.NETWORK_ERROR]: 'auth.errors.networkError',

  [AppErrorCode.AUTHENTICATION_FAILED]: 'common.errors.sessionExpired',
  [AppErrorCode.SESSION_EXPIRED]: 'common.errors.sessionExpired',
  [AppErrorCode.PASSWORD_CHANGED]: 'common.errors.passwordChanged',

  [AppErrorCode.VAULT_NOT_FOUND]: 'common.errors.vaultNotAvailable',
  [AppErrorCode.VAULT_LOCKED]: 'common.errors.vaultIsLocked',
  [AppErrorCode.VAULT_DECRYPT_FAILED]: 'common.errors.vaultDataUnreadable',
  [AppErrorCode.UNLOCK_KEY_REJECTED]: 'common.errors.wrongPassword',
  [AppErrorCode.KEY_CHAIN_UNREADABLE]: 'common.errors.keyChainUnreadable',
  [AppErrorCode.KEY_OUT_OF_SYNC]: 'common.errors.sessionExpired',

  [AppErrorCode.SYNC_VAULT_FETCH_FAILED]: 'common.errors.vaultDataUnreadable',
  [AppErrorCode.SYNC_VAULT_DECRYPT_FAILED]: 'common.errors.vaultDataUnreadable',
  [AppErrorCode.SYNC_SERVER_UNREACHABLE]: 'common.errors.serverNotAvailable',
  [AppErrorCode.SYNC_CODEC_FAILED]: 'common.errors.vaultDataUnreadable',

  [AppErrorCode.ENCRYPTION_KEY_NOT_FOUND]: 'common.errors.vaultIsLocked',

  [AppErrorCode.MERGE_FAILED]: 'common.errors.mergeFailed',
  [AppErrorCode.MERGE_CONFLICT]: 'common.errors.syncConflictMaxRetries',

  [AppErrorCode.UPLOAD_TOO_LARGE]: 'common.errors.vaultTooLarge',
  [AppErrorCode.UPLOAD_TIMEOUT]: 'common.errors.vaultSyncTimeout',

  [AppErrorCode.VAULT_VERSION_INCOMPATIBLE]: 'common.errors.clientOutdated',
  [AppErrorCode.SERVER_UPDATE_REQUIRED]: 'common.errors.serverOutdated',
  [AppErrorCode.CLIENT_VERSION_NOT_SUPPORTED]: 'common.errors.clientNotSupported',
  [AppErrorCode.SERVER_VERSION_NOT_SUPPORTED]: 'common.errors.serverOutdated',
  [AppErrorCode.VAULT_OUTDATED]: 'content.vaultUpgradeRequired',
};

/**
 * Map an error code to the translation key of its message. Codes without a message of their own share the generic
 * "unexpected error" message; the code shown next to it tells them apart.
 * @param code - the error code
 */
export function getErrorTranslationKey(code: AppErrorCode): TranslationKey {
  return ERROR_TRANSLATION_KEYS[code] ?? 'common.errors.unexpectedErrorContactSupport';
}

/**
 * The translated message for an error that carries a code, with the code appended, or null when it carries none.
 *
 * @param err - The error (can be Error, string, or unknown)
 * @param t - The renderer's translation function
 */
export function translateCodedError(err: unknown, t: (key: string) => string): string | null {
  const code = getAppErrorCode(err);
  return code ? formatErrorWithCode(t(getErrorTranslationKey(code)), code) : null;
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
