import Foundation
import VaultModels

/// Repository for reading TOTP codes from the vault database.
public class TotpRepository: BaseRepository {
    /// An item's TOTP codes, scoped by manifest as well as item (core/client `TotpCodeQueries.GET_BY_ITEM_ID`).
    private static let getByItemId = """
        SELECT Id, Name, SecretKey, Algorithm, Digits, Period, ItemId
        FROM TotpCodes
        WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0
        """

    /// Get all TOTP codes for a specific item.
    /// - Parameters:
    ///   - itemId: The UUID of the item
    ///   - manifestId: The manifest the item belongs to, when the caller knows it
    /// - Returns: Array of TotpCode objects for the item
    public func getTotpCodesForItem(_ itemId: UUID, manifestId: String? = nil) throws -> [TotpCode] {
        let itemIdString = itemId.uuidString.lowercased()
        guard let scope = try manifestId ?? resolveRowManifestId(table: "Items", id: itemIdString) else {
            return []
        }

        let results = try client.executeQuery(Self.getByItemId, params: [itemIdString, scope])
        return results.compactMap { row -> TotpCode? in
            guard let idString = row["Id"] as? String, let id = UUID(uuidString: idString), let name = row["Name"] as? String, let secretKey = row["SecretKey"] as? String else {
                return nil
            }
            guard let rowItemId = row["ItemId"] as? String, let itemIdParsed = UUID(uuidString: rowItemId) else {
                return nil
            }

            return TotpCode(
                id: id,
                name: name,
                secretKey: secretKey,
                algorithm: row["Algorithm"] as? String ?? TotpCode.defaultAlgorithm,
                digits: Int(row["Digits"] as? Int64 ?? Int64(TotpCode.defaultDigits)),
                period: Int(row["Period"] as? Int64 ?? Int64(TotpCode.defaultPeriod)),
                itemId: itemIdParsed,
                isDeleted: false
            )
        }
    }

    /// Get the first TOTP code for a specific item (convenience method).
    /// - Parameters:
    ///   - itemId: The UUID of the item
    ///   - manifestId: The manifest the item belongs to, when the caller knows it
    /// - Returns: Optional TotpCode if one exists
    public func getFirstTotpCodeForItem(_ itemId: UUID, manifestId: String? = nil) throws -> TotpCode? {
        return try getTotpCodesForItem(itemId, manifestId: manifestId).first
    }
}
