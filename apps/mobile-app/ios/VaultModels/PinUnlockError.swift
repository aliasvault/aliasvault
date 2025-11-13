import Foundation

/// Error types for PIN unlock operations
/// This is in VaultModels so both VaultStoreKit and VaultUI can access it without circular dependencies
public enum PinUnlockError: Error {
    /// PIN is locked after too many failed attempts
    case locked

    /// Incorrect PIN with remaining attempts
    case incorrectPin(attemptsRemaining: Int)

    /// Get error code for React Native bridge compatibility
    public var code: String {
        switch self {
        case .locked: return "PIN_LOCKED"
        case .incorrectPin: return "INCORRECT_PIN"
        }
    }

    /// Get attempts remaining (if applicable)
    public var attemptsRemaining: Int? {
        switch self {
        case .incorrectPin(let remaining): return remaining
        default: return nil
        }
    }
}
