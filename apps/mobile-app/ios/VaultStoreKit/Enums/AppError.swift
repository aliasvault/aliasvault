import Foundation

/// App error codes for mobile app operations.
/// These error codes are language-independent and can be properly handled by the client.
public enum AppError: Error {
    // Authentication errors
    case authenticationFailed
    case sessionExpired
    case passwordChanged

    // Network/connectivity errors
    case serverUnavailable(statusCode: Int)
    case networkError(underlyingError: Error)
    case timeout

    // Version/compatibility errors
    case clientVersionNotSupported
    case serverVersionNotSupported
    case vaultVersionIncompatible

    // Vault status errors
    case vaultMergeRequired
    case vaultOutdated

    // Decryption errors
    case vaultDecryptFailed
    case base64DecodeFailed
    case databaseTempWriteFailed
    case databaseOpenFailed
    case databaseMemoryFailed
    case databaseBackupFailed
    case databasePragmaFailed
    case biometricCancelled
    case biometricFailed
    case keystoreKeyNotFound
    case keychainAccessDenied(status: OSStatus)
    case keychainItemNotFound
    case biometricNotAvailable
    case biometricNotEnrolled
    case biometricLockout

    // Storage errors
    case encryptionKeyNotFound
    case vaultStoreFailed(message: String)

    // Merge errors
    case vaultMergeFailed(message: String)
    case mergeUploadFailed(message: String)

    // Upload errors
    case vaultUploadFailed(message: String)

    // Retry errors
    case maxRetriesReached

    // Generic errors
    case unknownError(message: String)
    case parseError(message: String)

    /// Get the error code string for React Native bridge
    ///
    /// Error codes use the E-XXX format for easy user reporting:
    /// - E-1xx: Authentication errors
    /// - E-2xx: Network/connectivity errors
    /// - E-3xx: Version/compatibility errors
    /// - E-4xx: Vault status errors
    /// - E-5xx: Decryption/Encryption errors
    /// - E-6xx: Database/Storage errors
    /// - E-7xx: Merge errors
    /// - E-8xx: Upload errors
    /// - E-9xx: Native module errors
    /// - E-0xx: Generic errors
    public var code: String {
        switch self {
        case .authenticationFailed:
            return "E-101"
        case .sessionExpired:
            return "E-102"
        case .passwordChanged:
            return "E-103"
        case .serverUnavailable:
            return "E-201"
        case .networkError:
            return "E-202"
        case .timeout:
            return "E-203"
        case .clientVersionNotSupported:
            return "E-301"
        case .serverVersionNotSupported:
            return "E-302"
        case .vaultVersionIncompatible:
            return "E-303"
        case .vaultMergeRequired:
            return "E-401"
        case .vaultOutdated:
            return "E-402"
        case .vaultDecryptFailed:
            return "E-501"
        case .encryptionKeyNotFound:
            return "E-502"
        case .base64DecodeFailed:
            return "E-503"
        case .databaseTempWriteFailed:
            return "E-504"
        case .databaseOpenFailed:
            return "E-505"
        case .databaseMemoryFailed:
            return "E-506"
        case .databaseBackupFailed:
            return "E-507"
        case .databasePragmaFailed:
            return "E-508"
        case .biometricCancelled:
            return "E-509"
        case .biometricFailed:
            return "E-510"
        case .keystoreKeyNotFound:
            return "E-511"
        case .keychainAccessDenied:
            return "E-512"
        case .keychainItemNotFound:
            return "E-513"
        case .biometricNotAvailable:
            return "E-514"
        case .biometricNotEnrolled:
            return "E-515"
        case .biometricLockout:
            return "E-516"
        case .vaultStoreFailed:
            return "E-604"
        case .vaultMergeFailed:
            return "E-701"
        case .mergeUploadFailed:
            return "E-705"
        case .vaultUploadFailed:
            return "E-801"
        case .maxRetriesReached:
            return "E-901"
        case .unknownError:
            return "E-001"
        case .parseError:
            return "E-002"
        }
    }

    /// Get a user-friendly message (for logging/debugging)
    public var message: String {
        switch self {
        case .authenticationFailed:
            return "Authentication failed"
        case .sessionExpired:
            return "Session expired"
        case .passwordChanged:
            return "Password has changed"
        case .serverUnavailable(let statusCode):
            return "Server unavailable (status: \(statusCode))"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .timeout:
            return "Request timeout"
        case .clientVersionNotSupported:
            return "Client version not supported"
        case .serverVersionNotSupported:
            return "Server version not supported"
        case .vaultVersionIncompatible:
            return "Vault version incompatible"
        case .vaultMergeRequired:
            return "Vault merge required"
        case .vaultOutdated:
            return "Vault outdated"
        case .vaultDecryptFailed:
            return "Failed to decrypt vault"
        case .encryptionKeyNotFound:
            return "Encryption key not available"
        case .base64DecodeFailed:
            return "Base64 decode failed after decryption"
        case .databaseTempWriteFailed:
            return "Database setup failed: could not write temp file"
        case .databaseOpenFailed:
            return "Database setup failed: could not open source database"
        case .databaseMemoryFailed:
            return "Database setup failed: could not create in-memory connection"
        case .databaseBackupFailed:
            return "Database setup failed: backup/copy failed"
        case .databasePragmaFailed:
            return "Database setup failed: pragma execution failed"
        case .biometricCancelled:
            return "Biometric authentication cancelled"
        case .biometricFailed:
            return "Biometric authentication failed"
        case .keystoreKeyNotFound:
            return "Encryption key not found in keychain"
        case .keychainAccessDenied(let status):
            return "Keychain access denied (status: \(status))"
        case .keychainItemNotFound:
            return "Keychain item not found - may need to log out and back in"
        case .biometricNotAvailable:
            return "Biometric authentication not available on this device"
        case .biometricNotEnrolled:
            return "No biometrics enrolled on device"
        case .biometricLockout:
            return "Biometric authentication locked out"
        case .vaultStoreFailed(let message):
            return "Failed to store vault: \(message)"
        case .vaultMergeFailed(let message):
            return "Vault merge failed: \(message)"
        case .mergeUploadFailed(let message):
            return "Upload after merge failed: \(message)"
        case .vaultUploadFailed(let message):
            return "Vault upload failed: \(message)"
        case .maxRetriesReached:
            return "Max sync retries reached"
        case .unknownError(let message):
            return "Unknown error: \(message)"
        case .parseError(let message):
            return "Parse error: \(message)"
        }
    }
}
