import Foundation

/// Helper struct to pass passkey data with credential info
public struct PasskeyWithCredentialInfo: Identifiable {
    public let id: UUID
    public let displayName: String
    public let serviceName: String?
    public let username: String?
    public let rpId: String
    public let userId: Data?

    public init(id: UUID, displayName: String, serviceName: String?, username: String?, rpId: String, userId: Data?) {
        self.id = id
        self.displayName = displayName
        self.serviceName = serviceName
        self.username = username
        self.rpId = rpId
        self.userId = userId
    }
}
