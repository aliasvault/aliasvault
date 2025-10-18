import Foundation

/// Error codes for vault sync operations
/// These error codes are language-independent and can be properly handled by the client
public enum VaultSyncError: Error {
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

    // Generic errors
    case unknownError(message: String)
    case parseError(message: String)

    /// Get the error code string for React Native bridge
    public var code: String {
        switch self {
        case .authenticationFailed:
            return "VAULT_SYNC_AUTH_FAILED"
        case .sessionExpired:
            return "VAULT_SYNC_SESSION_EXPIRED"
        case .passwordChanged:
            return "VAULT_SYNC_PASSWORD_CHANGED"
        case .serverUnavailable:
            return "VAULT_SYNC_SERVER_UNAVAILABLE"
        case .networkError:
            return "VAULT_SYNC_NETWORK_ERROR"
        case .timeout:
            return "VAULT_SYNC_TIMEOUT"
        case .clientVersionNotSupported:
            return "VAULT_SYNC_CLIENT_VERSION_NOT_SUPPORTED"
        case .serverVersionNotSupported:
            return "VAULT_SYNC_SERVER_VERSION_NOT_SUPPORTED"
        case .vaultVersionIncompatible:
            return "VAULT_SYNC_VAULT_VERSION_INCOMPATIBLE"
        case .vaultMergeRequired:
            return "VAULT_SYNC_MERGE_REQUIRED"
        case .vaultOutdated:
            return "VAULT_SYNC_OUTDATED"
        case .vaultDecryptFailed:
            return "VAULT_SYNC_DECRYPT_FAILED"
        case .unknownError:
            return "VAULT_SYNC_UNKNOWN_ERROR"
        case .parseError:
            return "VAULT_SYNC_PARSE_ERROR"
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
        case .unknownError(let message):
            return "Unknown error: \(message)"
        case .parseError(let message):
            return "Parse error: \(message)"
        }
    }
}
