import Foundation
import VaultModels

/// Repository for managing TOTP codes in the vault database.
public class TotpRepository: BaseRepository {
    /// Get all TOTP codes for a specific item.
    /// - Parameter itemId: The UUID of the item
    /// - Returns: Array of TotpCode objects for the item
    /// - Throws: Database errors
    public func getTotpCodesForItem(_ itemId: UUID) throws -> [TotpCode] {
        let query = """
        SELECT Id, Name, SecretKey, ItemId, COALESCE(IsDeleted, 0) as IsDeleted
        FROM TotpCodes
        WHERE ItemId = ? AND IsDeleted = 0
        ORDER BY Name ASC
        """

        let results = try client.executeQuery(query, params: [itemId.uuidString])
        var totpCodes: [TotpCode] = []

        for row in results {
            guard let idString = row["Id"] as? String,
                  let id = UUID(uuidString: idString),
                  let name = row["Name"] as? String,
                  let secretKey = row["SecretKey"] as? String,
                  let itemIdString = row["ItemId"] as? String,
                  let itemIdParsed = UUID(uuidString: itemIdString) else {
                continue
            }

            let isDeleted = (row["IsDeleted"] as? Int64 ?? 0) != 0

            let totpCode = TotpCode(
                id: id,
                name: name,
                secretKey: secretKey,
                itemId: itemIdParsed,
                isDeleted: isDeleted
            )

            totpCodes.append(totpCode)
        }

        return totpCodes
    }

    /// Get the first TOTP code for a specific item (convenience method).
    /// - Parameter itemId: The UUID of the item
    /// - Returns: Optional TotpCode if one exists
    /// - Throws: Database errors
    public func getFirstTotpCodeForItem(_ itemId: UUID) throws -> TotpCode? {
        let codes = try getTotpCodesForItem(itemId)
        return codes.first
    }
}
