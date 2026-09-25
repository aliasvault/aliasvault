import Foundation
import VaultModels

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
    ///   - manifestId: The manifest the item belongs to
    ///   - action: What the user did with it
    public func recordUsage(itemId: String, manifestId: String, action: ItemUsageAction) throws {
        // Usage statistics live in their own data bucket which should be pushed without a full manifest write.
        try withTransaction(scope: VaultDataBucketCategory.stats) {
            let now = self.now()
            let columns = action.columns
            try client.executeUpdate(ItemStatsQueries.insertRow, params: [manifestId, itemId, now, now])
            try client.executeUpdate(ItemStatsQueries.forAction(lastColumn: columns.last, countColumn: columns.count), params: [now, now, now, manifestId, itemId])
        }
    }
}
