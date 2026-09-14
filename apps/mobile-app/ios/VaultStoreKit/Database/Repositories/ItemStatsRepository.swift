import Foundation

/// The actions whose use of an item is recorded. Each maps to its own timestamp + counter pair alongside the
/// aggregate `LastUsedAt` / `UseCount`.
public enum ItemUsageAction {
    /// A credential filled into a form.
    case autofill
    /// A value copied to the clipboard.
    case copy
    /// A passkey assertion.
    case passkey

    /// The column pair this action bumps. Closed set: nothing here is ever built from caller input.
    internal var columns: (last: String, count: String) {
        switch self {
        case .autofill:
            return ("LastAutofilledAt", "AutofillCount")
        case .copy:
            return ("LastCopiedAt", "CopyCount")
        case .passkey:
            return ("LastPasskeyAuthAt", "PasskeyAuthCount")
        }
    }
}

/// Repository for per-item usage statistics.
public class ItemStatsRepository: BaseRepository {
    /// Record one use of an item. Runs in its own transaction so the vault is persisted and marked dirty.
    /// - Parameters:
    ///   - itemId: The item that was used
    ///   - manifestId: The manifest the item belongs to, when the caller knows it
    ///   - action: What the user did with it
    /// - Returns: True when a use was recorded, false when no such item exists
    @discardableResult
    public func recordUsage(itemId: String, manifestId: String? = nil, action: ItemUsageAction) throws -> Bool {
        return try withTransaction {
            guard let scope = try manifestId ?? resolveRowManifestId(table: "Items", id: itemId) else {
                return false
            }

            let now = self.now()
            let columns = action.columns
            try client.executeUpdate(ItemStatsQueries.insertRow, params: [scope, itemId, now, now])
            try client.executeUpdate(ItemStatsQueries.forAction(lastColumn: columns.last, countColumn: columns.count), params: [now, now, now, scope, itemId])
            return true
        }
    }
}
