import Foundation

/// Helper struct to pass passkey data with credential info
public struct PasskeyWithCredentialInfo: Identifiable {
    public let id: UUID
    public let displayName: String
    public let serviceName: String?
    public let username: String?
    public let email: String?
    public let rpId: String
    public let userId: Data?

    /// The account identifier to display: the username, or the email when no username is set.
    public var accountLabel: String? {
        let name = username?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let name = name, !name.isEmpty {
            return name
        }
        let mail = email?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (mail?.isEmpty == false) ? mail : nil
    }

    public init(id: UUID, displayName: String, serviceName: String?, username: String?, email: String? = nil, rpId: String, userId: Data?) {
        self.id = id
        self.displayName = displayName
        self.serviceName = serviceName
        self.username = username
        self.email = email
        self.rpId = rpId
        self.userId = userId
    }
}
