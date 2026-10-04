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
    case serverError(message: String)

    // Version/compatibility errors
    case clientVersionNotSupported
    case serverVersionNotSupported
    case vaultVersionIncompatible
    case serverUpdateRequired

    // Vault status errors
    case vaultMergeRequired
    case vaultOutdated
    case syncVaultFetchFailed(message: String)

    // Decryption errors
    /// The locally stored vault does not decrypt with the Account Key.
    case vaultDecryptFailed
    /// The unlock key does not open the account key (wrong password or PIN).
    case unlockKeyRejected
    /// The account key opened, the vault encryption key under it did not.
    case keyChainUnreadable(message: String)
    /// The Account Key does not open the key chain the server holds; only a re-login recovers.
    case keyOutOfSync
    /// A server manifest or bucket fails its hash check or does not decrypt.
    case serverVaultDecryptFailed(message: String)
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
    case storageReadFailed(message: String)
    case storageWriteFailed(message: String)
    case databaseInitFailed(message: String)
    case vaultStoreFailed(message: String)
    case manifestNotRecorded

    // Merge errors
    case vaultMergeFailed(message: String)
    case mergeUploadFailed(message: String)

    // Upload errors
    case vaultUploadFailed(message: String)

    /// Server rejected the vault upload with HTTP 413 because the encrypted vault
    /// exceeds the configured MAX_UPLOAD_SIZE_MB limit on the server.
    case vaultTooLarge

    /// A vault transfer exceeded its request timeout (large vault or slow connection).
    case vaultSyncTimeout

    // Retry errors
    case maxRetriesReached
    case migrationCheckFailed(message: String)

    // Generic errors
    case unknownError(message: String)
    case parseError(message: String)

    // Sync engine failures that name their cause in the message
    case syncResponseInvalid(message: String)
    case syncCodecFailed(message: String)
    case syncEngineFailed(message: String)

    /// Get the error code string for React Native bridge, in the E-XXX format for easy user reporting.
    /// The codes are shared by every client: `AppErrorCode` in core/client/src/api/errors/AppErrorCodes.ts is the registry,
    /// so add a new code there first and never reuse a number.
    public var code: String {
        switch self {
        case .authenticationFailed:
            return "E-104"
        case .sessionExpired:
            return "E-105"
        case .passwordChanged:
            return "E-106"
        case .serverUnavailable:
            return "E-505"
        case .networkError:
            return "E-003"
        case .serverError:
            return "E-506"
        case .clientVersionNotSupported:
            return "E-904"
        case .serverVersionNotSupported:
            return "E-905"
        case .vaultVersionIncompatible:
            return "E-902"
        case .serverUpdateRequired:
            return "E-903"
        case .vaultMergeRequired:
            return "E-907"
        case .vaultOutdated:
            return "E-906"
        case .syncVaultFetchFailed:
            return "E-502"
        case .vaultDecryptFailed:
            return "E-203"
        case .encryptionKeyNotFound:
            return "E-202"
        case .base64DecodeFailed:
            return "E-606"
        case .databaseTempWriteFailed:
            return "E-607"
        case .databaseOpenFailed:
            return "E-608"
        case .databaseMemoryFailed:
            return "E-609"
        case .databaseBackupFailed:
            return "E-610"
        case .databasePragmaFailed:
            return "E-611"
        case .biometricCancelled:
            return "E-209"
        case .biometricFailed:
            return "E-210"
        case .keystoreKeyNotFound:
            return "E-211"
        case .keychainAccessDenied:
            return "E-212"
        case .keychainItemNotFound:
            return "E-213"
        case .biometricNotAvailable:
            return "E-214"
        case .biometricNotEnrolled:
            return "E-215"
        case .biometricLockout:
            return "E-216"
        case .unlockKeyRejected:
            return "E-206"
        case .keyChainUnreadable:
            return "E-207"
        case .keyOutOfSync:
            return "E-208"
        case .serverVaultDecryptFailed:
            return "E-503"
        case .storageReadFailed:
            return "E-601"
        case .storageWriteFailed:
            return "E-602"
        case .databaseInitFailed:
            return "E-603"
        case .vaultStoreFailed:
            return "E-504"
        case .manifestNotRecorded:
            return "E-605"
        case .vaultMergeFailed:
            return "E-701"
        case .mergeUploadFailed:
            return "E-703"
        case .vaultUploadFailed:
            return "E-801"
        case .vaultTooLarge:
            return "E-804"
        case .vaultSyncTimeout:
            return "E-805"
        case .maxRetriesReached:
            return "E-702"
        case .migrationCheckFailed:
            return "E-901"
        case .unknownError:
            return "E-001"
        case .parseError:
            return "E-004"
        case .syncResponseInvalid:
            return "E-507"
        case .syncCodecFailed:
            return "E-508"
        case .syncEngineFailed:
            return "E-509"
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
        case .serverError(let message):
            return "Server error: \(message)"
        case .clientVersionNotSupported:
            return "Client version not supported"
        case .serverVersionNotSupported:
            return "Server version not supported"
        case .vaultVersionIncompatible:
            return "Vault version incompatible"
        case .serverUpdateRequired:
            return "Server update required"
        case .vaultMergeRequired:
            return "Vault merge required"
        case .vaultOutdated:
            return "Vault outdated"
        case .syncVaultFetchFailed(let message):
            return "Server vault could not be assembled: \(message)"
        case .vaultDecryptFailed:
            return "Failed to decrypt vault"
        case .unlockKeyRejected:
            return "The unlock key does not open the account key"
        case .keyChainUnreadable(let message):
            return "The account key does not open the vault encryption key: \(message)"
        case .keyOutOfSync:
            return "Vault encryption key out of sync with the server; log in again"
        case .serverVaultDecryptFailed(let message):
            return "Server vault could not be opened: \(message)"
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
        case .storageReadFailed(let message):
            return "Storage read failed: \(message)"
        case .storageWriteFailed(let message):
            return "Storage write failed: \(message)"
        case .databaseInitFailed(let message):
            return "Database init failed: \(message)"
        case .vaultStoreFailed(let message):
            return "Failed to store vault: \(message)"
        case .manifestNotRecorded:
            return "No personal manifest recorded yet; sync once before writing"
        case .vaultMergeFailed(let message):
            return "Vault merge failed: \(message)"
        case .mergeUploadFailed(let message):
            return "Upload after merge failed: \(message)"
        case .vaultUploadFailed(let message):
            return "Vault upload failed: \(message)"
        case .vaultTooLarge:
            return "Vault too large for server"
        case .vaultSyncTimeout:
            return "Vault sync timed out"
        case .maxRetriesReached:
            return "Max sync retries reached"
        case .migrationCheckFailed(let message):
            return "Migration check failed: \(message)"
        case .unknownError(let message):
            return "Unknown error: \(message)"
        case .parseError(let message):
            return "Parse error: \(message)"
        case .syncResponseInvalid(let message):
            return "Invalid server response: \(message)"
        case .syncCodecFailed(let message):
            return "Vault codec failed: \(message)"
        case .syncEngineFailed(let message):
            return "Sync engine failed: \(message)"
        }
    }

    /// Check if this is an authentication error that requires logout.
    public var isAuthenticationError: Bool {
        switch self {
        case .authenticationFailed, .sessionExpired, .passwordChanged:
            return true
        default:
            return false
        }
    }

    /// Check if this is a version/compatibility error that requires logout.
    public var isVersionError: Bool {
        switch self {
        case .clientVersionNotSupported, .serverVersionNotSupported, .vaultVersionIncompatible:
            return true
        default:
            return false
        }
    }

    /// Check if this is a network error (offline mode). A timeout is not: the sync engine reports it as a failed sync.
    public var isNetworkError: Bool {
        switch self {
        case .serverUnavailable, .networkError:
            return true
        default:
            return false
        }
    }
}
