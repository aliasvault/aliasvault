import Foundation
import VaultModels
import VaultUtils

/// Row structure for passkey database results.
public struct PasskeyRow {
    public let id: String
    public let itemId: String
    public let rpId: String
    public let userHandle: Data?
    public let publicKey: String
    public let privateKey: String
    public let prfKey: Data?
    public let displayName: String
    public let createdAt: String
    public let updatedAt: String
    public let isDeleted: Int64

    /// Initialize from a database row dictionary.
    public init?(from row: [String: Any]) {
        guard let id = row["Id"] as? String,
              let itemId = row["ItemId"] as? String,
              let rpId = row["RpId"] as? String,
              let publicKey = row["PublicKey"] as? String,
              let privateKey = row["PrivateKey"] as? String,
              let displayName = row["DisplayName"] as? String,
              let createdAt = row["CreatedAt"] as? String,
              let updatedAt = row["UpdatedAt"] as? String,
              let isDeleted = row["IsDeleted"] as? Int64 else {
            return nil
        }

        self.id = id
        self.itemId = itemId
        self.rpId = rpId
        self.publicKey = publicKey
        self.privateKey = privateKey
        self.displayName = displayName
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.isDeleted = isDeleted

        // Handle optional blob fields
        if let userHandleBase64 = row["UserHandle"] as? String {
            self.userHandle = Data(base64Encoded: userHandleBase64)
        } else {
            self.userHandle = nil
        }

        if let prfKeyBase64 = row["PrfKey"] as? String {
            self.prfKey = Data(base64Encoded: prfKeyBase64)
        } else {
            self.prfKey = nil
        }
    }
}

/// Row structure for passkey with item info (joined query).
public struct PasskeyWithItemInfoRow {
    public let passkeyRow: PasskeyRow
    public let serviceName: String?
    public let username: String?

    /// Initialize from a database row dictionary.
    public init?(from row: [String: Any]) {
        guard let passkeyRow = PasskeyRow(from: row) else {
            return nil
        }

        self.passkeyRow = passkeyRow
        self.serviceName = row["ServiceName"] as? String
        self.username = row["Username"] as? String
    }
}

/// Result type for passkey with item info.
public struct PasskeyWithItemInfo {
    public let passkey: Passkey
    public let serviceName: String?
    public let username: String?

    public init(passkey: Passkey, serviceName: String?, username: String?) {
        self.passkey = passkey
        self.serviceName = serviceName
        self.username = username
    }
}

/// Mapper for converting database rows to Passkey model objects.
public struct PasskeyMapper {
    /// Map a single passkey row to a Passkey object.
    /// - Parameter row: The passkey row from the database
    /// - Returns: Passkey object or nil if mapping fails
    public static func mapRow(_ row: PasskeyRow) -> Passkey? {
        // Parse UUIDs
        guard let id = UUID(uuidString: row.id),
              let parentItemId = UUID(uuidString: row.itemId) else {
            print("PasskeyMapper: Invalid UUID - id=\(row.id), itemId=\(row.itemId)")
            return nil
        }

        // Parse dates
        guard let createdAt = DateHelpers.parseDateString(row.createdAt),
              let updatedAt = DateHelpers.parseDateString(row.updatedAt) else {
            print("PasskeyMapper: Invalid date - created=\(row.createdAt), updated=\(row.updatedAt)")
            return nil
        }

        // Parse keys - stored as UTF-8 strings
        guard let publicKeyData = row.publicKey.data(using: .utf8),
              let privateKeyData = row.privateKey.data(using: .utf8) else {
            print("PasskeyMapper: Invalid key data")
            return nil
        }

        return Passkey(
            id: id,
            parentItemId: parentItemId,
            rpId: row.rpId,
            userHandle: row.userHandle,
            userName: nil, // userName not stored in DB, derived from parent credential
            publicKey: publicKeyData,
            privateKey: privateKeyData,
            prfKey: row.prfKey,
            displayName: row.displayName,
            createdAt: createdAt,
            updatedAt: updatedAt,
            isDeleted: row.isDeleted == 1
        )
    }

    /// Map multiple passkey rows to Passkey objects.
    /// - Parameter rows: Array of passkey rows
    /// - Returns: Array of Passkey objects
    public static func mapRows(_ rows: [PasskeyRow]) -> [Passkey] {
        return rows.compactMap { mapRow($0) }
    }

    /// Map a passkey with item info row to PasskeyWithItemInfo.
    /// - Parameter row: The joined row from the database
    /// - Returns: PasskeyWithItemInfo or nil if mapping fails
    public static func mapRowWithItemInfo(_ row: PasskeyWithItemInfoRow) -> PasskeyWithItemInfo? {
        guard let passkey = mapRow(row.passkeyRow) else {
            return nil
        }

        return PasskeyWithItemInfo(
            passkey: passkey,
            serviceName: row.serviceName,
            username: row.username
        )
    }

    /// Map multiple joined rows to PasskeyWithItemInfo objects.
    /// - Parameter rows: Array of joined rows
    /// - Returns: Array of PasskeyWithItemInfo objects
    public static func mapRowsWithItemInfo(_ rows: [PasskeyWithItemInfoRow]) -> [PasskeyWithItemInfo] {
        return rows.compactMap { mapRowWithItemInfo($0) }
    }
}
