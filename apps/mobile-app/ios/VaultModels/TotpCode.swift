import Foundation

/// TotpCode type representing TOTP (Time-based One-Time Password) codes in the vault.
public struct TotpCode: Codable, Hashable, Equatable {
    public let id: UUID
    public let name: String
    public let secretKey: String
    public let itemId: UUID
    public let isDeleted: Bool

    public init(
        id: UUID,
        name: String,
        secretKey: String,
        itemId: UUID,
        isDeleted: Bool = false
    ) {
        self.id = id
        self.name = name
        self.secretKey = secretKey
        self.itemId = itemId
        self.isDeleted = isDeleted
    }

    public static func == (lhs: TotpCode, rhs: TotpCode) -> Bool {
        return lhs.id == rhs.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    // MARK: - Database Column Mapping

    enum CodingKeys: String, CodingKey {
        case id = "Id"
        case name = "Name"
        case secretKey = "SecretKey"
        case itemId = "ItemId"
        case isDeleted = "IsDeleted"
    }
}
