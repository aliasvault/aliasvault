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
     * Error indicating request timeout.
     */
    class Timeout(
        message: String = "Request timeout",
        cause: Throwable? = null,
    ) : AppError(message, cause)

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

    // Decryption errors
    /**
     * Error indicating failed to decrypt vault.
     */
    class VaultDecryptFailed(
        message: String = "Failed to decrypt vault",
        cause: Throwable? = null,
    ) : AppError(message, cause)

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

    // Storage errors
    /**
     * Error indicating encryption key not available.
     */
    class EncryptionKeyNotFound(
        message: String = "Encryption key not available",
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
     * Error indicating max sync retries reached.
     */
    class MaxRetriesReached(
        message: String = "Max sync retries reached",
        cause: Throwable? = null,
    ) : AppError(message, cause)

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

    /**
     * Get the error code string for React Native bridge.
     *
     * Error codes use the E-XXX format for easy user reporting:
     * - E-1xx: Authentication errors
     * - E-2xx: Network/connectivity errors
     * - E-3xx: Version/compatibility errors
     * - E-4xx: Vault status errors
     * - E-5xx: Decryption/Encryption errors
     * - E-6xx: Database/Storage errors
     * - E-7xx: Merge errors
     * - E-8xx: Upload errors
     * - E-9xx: Native module errors
     * - E-0xx: Generic errors
     */
    val code: String
        get() = when (this) {
            is AuthenticationFailed -> "E-101"
            is SessionExpired -> "E-102"
            is PasswordChanged -> "E-103"
            is ServerUnavailable -> "E-201"
            is NetworkError -> "E-202"
            is Timeout -> "E-203"
            is ClientVersionNotSupported -> "E-301"
            is ServerVersionNotSupported -> "E-302"
            is VaultVersionIncompatible -> "E-303"
            is VaultMergeRequired -> "E-401"
            is VaultOutdated -> "E-402"
            is VaultDecryptFailed -> "E-501"
            is EncryptionKeyNotFound -> "E-502"
            is Base64DecodeFailed -> "E-503"
            is DatabaseTempWriteFailed -> "E-504"
            is DatabaseOpenFailed -> "E-505"
            is DatabaseMemoryFailed -> "E-506"
            is DatabaseBackupFailed -> "E-507"
            is DatabasePragmaFailed -> "E-508"
            is BiometricCancelled -> "E-509"
            is BiometricFailed -> "E-510"
            is KeystoreKeyNotFound -> "E-511"
            is VaultStoreFailed -> "E-604"
            is VaultMergeFailed -> "E-701"
            is MergeUploadFailed -> "E-705"
            is VaultUploadFailed -> "E-801"
            is MaxRetriesReached -> "E-901"
            is UnknownError -> "E-001"
            is ParseError -> "E-002"
        }
}
