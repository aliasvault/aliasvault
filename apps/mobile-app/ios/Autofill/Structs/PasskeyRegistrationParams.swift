import Foundation
import VaultStoreKit

/// Parameters for passkey registration
public struct PasskeyRegistrationParams {
    /// The relying party identifier (domain)
    public let rpId: String
    /// The user name
    public let userName: String?
    /// The user display name
    public let userDisplayName: String?
    /// The user ID
    public let userId: Data?
    /// The client data hash
    public let clientDataHash: Data
    /// Whether PRF is enabled
    public let enablePrf: Bool
    /// The PRF inputs
    public let prfInputs: PrfInputs?
    /// The chosen COSE credential algorithm (-7 ES256, -257 RS256)
    public let algorithm: Int
}
