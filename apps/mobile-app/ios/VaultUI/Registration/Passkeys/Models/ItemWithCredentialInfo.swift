import Foundation

/// Helper struct to pass item data with credential info (for items without passkeys)
public struct ItemWithCredentialInfo: Identifiable {
    public let id: UUID  // Alias for itemId for Identifiable conformance
    public let itemId: UUID
    public let serviceName: String?
    /// All URLs associated with this item (supports multi-value URL fields)
    public let urls: [String]
    public let username: String?
    public let email: String?
    public let hasPassword: Bool
    public let createdAt: Date
    public let updatedAt: Date

    /// The account identifier to display: the username, or the email when no username is set.
    public var accountLabel: String? {
        let name = username?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let name = name, !name.isEmpty {
            return name
        }
        let mail = email?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (mail?.isEmpty == false) ? mail : nil
    }

    public init(itemId: UUID, serviceName: String?, urls: [String], username: String?, email: String? = nil, hasPassword: Bool, createdAt: Date, updatedAt: Date) {
        self.id = itemId
        self.itemId = itemId
        self.serviceName = serviceName
        self.urls = urls
        self.username = username
        self.email = email
        self.hasPassword = hasPassword
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
