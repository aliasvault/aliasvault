package net.aliasvault.app.vaultstore

/**
 * App error codes for mobile app operations.
 * These error codes are language-independent and can be properly handled by the client.
 *
 * This is a Kotlin port of the iOS Swift implementation:
 * - Reference: apps/mobile-app/ios/VaultStoreKit/Enums/AppErrorCodes.swift
 *
 * IMPORTANT: Keep all implementations synchronized. Changes to the public interface must be
 * reflected in all ports. Error types and codes should remain consistent.
 */
sealed class AppError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    // Authentication errors
    /**
     * Error indicating authentication failed.
     */
    class AuthenticationFailed(
        message: String = "Authentication failed",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating session expired.
     */
    class SessionExpired(
        message: String = "Session expired",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating password has changed.
     */
    class PasswordChanged(
        message: String = "Password has changed",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    // Network/connectivity errors
    /**
     * Error indicating server unavailable.
     */
    class ServerUnavailable(
        /** The HTTP status code. */
        val statusCode: Int,
        message: String = "Server unavailable (status: $statusCode)",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating network error.
     */
    class NetworkError(
        /** The underlying error. */
        val underlyingError: Throwable,
    ) : AppError("Network error: ${underlyingError.message}", underlyingError)

    /**
     * Error indicating the server answered a request with an unexpected HTTP failure.
     */
    class ServerError(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Server error: $message", cause)

    // Version/compatibility errors
    /**
     * Error indicating client version not supported.
     */
    class ClientVersionNotSupported(
        message: String = "Client version not supported",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating server version not supported.
     */
    class ServerVersionNotSupported(
        message: String = "Server version not supported",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating vault version incompatible.
     */
    class VaultVersionIncompatible(
        message: String = "Vault version incompatible",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating the server predates the API this app needs; shown as an error, not a logout.
     */
    class ServerUpdateRequired(
        message: String = "Server update required",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    // Vault status errors
    /**
     * Error indicating vault merge required.
     */
    class VaultMergeRequired(
        message: String = "Vault merge required",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating vault outdated.
     */
    class VaultOutdated(
        message: String = "Vault outdated",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating the server's vault snapshot could not be assembled into a vault.
     */
    class SyncVaultFetchFailed(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Server vault could not be assembled: $message", cause)

    // Decryption errors
    /**
     * Error indicating the locally stored vault does not decrypt with the session key.
     */
    class VaultDecryptFailed(
        message: String = "Failed to decrypt vault",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating the unlock key does not open the account key (wrong password or PIN).
     */
    class UnlockKeyRejected(
        message: String = "The unlock key does not open the account key",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating the account key opened, the vault encryption key under it did not.
     */
    class KeyChainUnreadable(
        message: String,
        cause: Throwable? = null,
    ) : AppError("The account key does not open the vault encryption key: $message", cause)

    /**
     * Error indicating the session key does not open the key chain the server holds; only a re-login recovers.
     */
    class KeyOutOfSync(
        message: String = "Vault encryption key out of sync with the server; log in again",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating a server manifest or bucket fails its hash check or does not decrypt.
     */
    class ServerVaultDecryptFailed(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Server vault could not be opened: $message", cause)

    /**
     * Error indicating base64 decode failed after decryption.
     */
    class Base64DecodeFailed(
        message: String = "Base64 decode failed after decryption",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating database setup failed - could not write temp file.
     */
    class DatabaseTempWriteFailed(
        message: String = "Database setup failed: could not write temp file",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating database setup failed - could not open source database.
     */
    class DatabaseOpenFailed(
        message: String = "Database setup failed: could not open source database",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating database setup failed - could not create in-memory connection.
     */
    class DatabaseMemoryFailed(
        message: String = "Database setup failed: could not create in-memory connection",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating database setup failed - backup/copy failed.
     */
    class DatabaseBackupFailed(
        message: String = "Database setup failed: backup/copy failed",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating database setup failed - pragma execution failed.
     */
    class DatabasePragmaFailed(
        message: String = "Database setup failed: pragma execution failed",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating biometric authentication was cancelled by user.
     */
    class BiometricCancelled(
        message: String = "Biometric authentication cancelled",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating biometric authentication failed.
     */
    class BiometricFailed(
        message: String = "Biometric authentication failed",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating encryption key not found in keystore.
     */
    class KeystoreKeyNotFound(
        message: String = "Encryption key not found in keystore",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating keystore access was denied (permission or key invalidation).
     */
    class KeystoreAccessDenied(
        message: String = "Keystore access denied",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating keystore item was not found (may need re-login).
     */
    class KeystoreItemNotFound(
        message: String = "Keystore item not found - may need to log out and back in",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating biometric authentication is not available on the device.
     */
    class BiometricNotAvailable(
        message: String = "Biometric authentication not available on this device",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating no biometrics are enrolled on the device.
     */
    class BiometricNotEnrolled(
        message: String = "No biometrics enrolled on device",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating biometric authentication is locked out due to too many failed attempts.
     */
    class BiometricLockout(
        message: String = "Biometric authentication locked out",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    // Storage errors
    /**
     * Error indicating encryption key not available.
     */
    class EncryptionKeyNotFound(
        message: String = "Encryption key not available",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating a storage read (state, database, at-rest vault) failed.
     */
    class StorageReadFailed(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Storage read failed: $message", cause)

    /**
     * Error indicating a storage write (state, database, at-rest vault) failed.
     */
    class StorageWriteFailed(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Storage write failed: $message", cause)

    /**
     * Error indicating the staging database could not be opened.
     */
    class DatabaseInitFailed(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Database init failed: $message", cause)

    /**
     * Error indicating no manifest is recorded yet, so nothing can be written until the vault has synced once.
     */
    class ManifestNotRecorded(
        message: String = "No personal manifest recorded yet; sync once before writing",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating failed to store vault.
     */
    class VaultStoreFailed(
        message: String = "Failed to store vault",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    // Merge errors
    /**
     * Error indicating vault merge failed.
     */
    class VaultMergeFailed(
        message: String = "Vault merge failed",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating upload after merge failed.
     */
    class MergeUploadFailed(
        message: String = "Upload after merge failed",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    // Upload errors
    /**
     * Error indicating vault upload failed.
     */
    class VaultUploadFailed(
        message: String = "Vault upload failed",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating the server rejected the vault upload with HTTP 413
     * because the encrypted vault exceeds the configured MAX_UPLOAD_SIZE_MB limit.
     */
    class VaultTooLarge(
        message: String = "Vault too large for server",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating a vault transfer exceeded its request timeout (large vault or slow connection).
     */
    class VaultSyncTimeout(
        message: String = "Vault sync timed out",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating max sync retries reached.
     */
    class MaxRetriesReached(
        message: String = "Max sync retries reached",
        cause: Throwable? = null,
    ) : AppError(message, cause)

    /**
     * Error indicating the vault migration check failed.
     */
    class MigrationCheckFailed(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Migration check failed: $message", cause)

    // Generic errors
    /**
     * Error indicating unknown error.
     */
    class UnknownError(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Unknown error: $message", cause)

    /**
     * Error indicating parse error.
     */
    class ParseError(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Parse error: $message", cause)

    // Sync engine failures that name their cause in the message
    /**
     * Error indicating a server response is not the JSON shape this client expects.
     */
    class SyncResponseInvalid(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Invalid server response: $message", cause)

    /**
     * Error indicating the core library (codec, merge or crypto) refused the vault data.
     */
    class SyncCodecFailed(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Vault codec failed: $message", cause)

    /**
     * Error indicating the sync engine hit a state it has no rule for.
     */
    class SyncEngineFailed(
        message: String,
        cause: Throwable? = null,
    ) : AppError("Sync engine failed: $message", cause)

    /**
     * Get the error code string for React Native bridge, in the E-XXX format for easy user reporting.
     * The codes are shared by every client: `AppErrorCode` in core/client/src/api/errors/AppErrorCodes.ts is the registry,
     * so add a new code there first and never reuse a number.
     */
    val code: String
        get() = when (this) {
            is AuthenticationFailed -> "E-104"
            is SessionExpired -> "E-105"
            is PasswordChanged -> "E-106"
            is ServerUnavailable -> "E-505"
            is NetworkError -> "E-003"
            is ServerError -> "E-506"
            is ClientVersionNotSupported -> "E-904"
            is ServerVersionNotSupported -> "E-905"
            is VaultVersionIncompatible -> "E-902"
            is ServerUpdateRequired -> "E-903"
            is VaultMergeRequired -> "E-907"
            is VaultOutdated -> "E-906"
            is SyncVaultFetchFailed -> "E-502"
            is VaultDecryptFailed -> "E-203"
            is EncryptionKeyNotFound -> "E-202"
            is Base64DecodeFailed -> "E-606"
            is DatabaseTempWriteFailed -> "E-607"
            is DatabaseOpenFailed -> "E-608"
            is DatabaseMemoryFailed -> "E-609"
            is DatabaseBackupFailed -> "E-610"
            is DatabasePragmaFailed -> "E-611"
            is BiometricCancelled -> "E-209"
            is BiometricFailed -> "E-210"
            is KeystoreKeyNotFound -> "E-211"
            is KeystoreAccessDenied -> "E-212"
            is KeystoreItemNotFound -> "E-213"
            is BiometricNotAvailable -> "E-214"
            is BiometricNotEnrolled -> "E-215"
            is BiometricLockout -> "E-216"
            is UnlockKeyRejected -> "E-206"
            is KeyChainUnreadable -> "E-207"
            is KeyOutOfSync -> "E-208"
            is ServerVaultDecryptFailed -> "E-503"
            is StorageReadFailed -> "E-601"
            is StorageWriteFailed -> "E-602"
            is DatabaseInitFailed -> "E-603"
            is VaultStoreFailed -> "E-504"
            is ManifestNotRecorded -> "E-605"
            is VaultMergeFailed -> "E-701"
            is MergeUploadFailed -> "E-703"
            is VaultUploadFailed -> "E-801"
            is VaultTooLarge -> "E-804"
            is VaultSyncTimeout -> "E-805"
            is MaxRetriesReached -> "E-702"
            is MigrationCheckFailed -> "E-901"
            is UnknownError -> "E-001"
            is ParseError -> "E-004"
            is SyncResponseInvalid -> "E-507"
            is SyncCodecFailed -> "E-508"
            is SyncEngineFailed -> "E-509"
        }

    /**
     * Check if this is an authentication error that requires logout.
     */
    val isAuthenticationError: Boolean
        get() = when (this) {
            is AuthenticationFailed, is SessionExpired, is PasswordChanged -> true
            else -> false
        }

    /**
     * Check if this is a version/compatibility error that requires logout.
     */
    val isVersionError: Boolean
        get() = when (this) {
            is ClientVersionNotSupported, is ServerVersionNotSupported, is VaultVersionIncompatible -> true
            else -> false
        }

    /**
     * Check if this is a network error (offline mode). A timeout is not: the sync engine reports it as a failed sync.
     */
    val isNetworkError: Boolean
        get() = when (this) {
            is ServerUnavailable, is NetworkError -> true
            else -> false
        }
}
