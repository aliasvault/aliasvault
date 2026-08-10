import Foundation

/// TotpCode type representing TOTP (Time-based One-Time Password) codes in the vault.
public struct TotpCode: Codable, Hashable, Equatable {
    /// The HMAC algorithm RFC 6238 assumes when an otpauth:// URI omits the `algorithm` parameter.
    public static let defaultAlgorithm = "SHA1"

    /// The code length RFC 6238 assumes when an otpauth:// URI omits the `digits` parameter.
    public static let defaultDigits = 6

    /// The time step RFC 6238 assumes when an otpauth:// URI omits the `period` parameter.
    public static let defaultPeriod = 30

    public let id: UUID
    public let name: String
    public let secretKey: String
    public let algorithm: String
    public let digits: Int
    public let period: Int
    public let itemId: UUID
    public let isDeleted: Bool

    public init(
        id: UUID,
        name: String,
        secretKey: String,
        algorithm: String = TotpCode.defaultAlgorithm,
        digits: Int = TotpCode.defaultDigits,
        period: Int = TotpCode.defaultPeriod,
        itemId: UUID,
        isDeleted: Bool = false
    ) {
        self.id = id
        self.name = name
        self.secretKey = secretKey
        self.algorithm = algorithm
        self.digits = digits
        self.period = period
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
        case algorithm = "Algorithm"
        case digits = "Digits"
        case period = "Period"
        case itemId = "ItemId"
        case isDeleted = "IsDeleted"
    }
}
