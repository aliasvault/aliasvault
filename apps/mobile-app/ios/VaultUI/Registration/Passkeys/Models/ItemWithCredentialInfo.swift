import Foundation

/// Helper struct to pass item data with credential info (for items without passkeys)
public struct ItemWithCredentialInfo: Identifiable {
    public let id: UUID  // Alias for itemId for Identifiable conformance
    public let itemId: UUID
    public let serviceName: String?
    public let url: String?
    public let username: String?
    public let hasPassword: Bool
    public let createdAt: Date
    public let updatedAt: Date

    public init(itemId: UUID, serviceName: String?, url: String?, username: String?, hasPassword: Bool, createdAt: Date, updatedAt: Date) {
        self.id = itemId
        self.itemId = itemId
        self.serviceName = serviceName
        self.url = url
        self.username = username
        self.hasPassword = hasPassword
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
