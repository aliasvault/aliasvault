import Foundation
import VaultUtils

/// The grouping key of a manifest-scoped row (same id can exist in several manifests by design).
internal func scopedKey(manifestId: String, id: String) -> String {
    return manifestId + id
}

/// Base repository class with common database operations.
public class BaseRepository {
    /// The database client used for executing queries.
    internal let client: DatabaseClient

    /// Initialize the repository with a database client.
    /// - Parameter client: The database client to use
    public init(client: DatabaseClient) {
        self.client = client
    }

    /// The manifest new rows outside any folder or item are stamped with: the personal manifest. Rows inside a
    /// folder or item take that parent's manifest through the SQL instead. An unrecorded manifest is an error,
    /// never the empty (unstamped) scope, which every later push would reject.
    public func writeManifestId() throws -> String {
        guard let manifestId = client.personalManifestId(), !manifestId.isEmpty else {
            throw AppError.manifestNotRecorded
        }
        return manifestId
    }

    // MARK: - Transaction Helpers

    /// Execute a function within a transaction.
    /// Automatically handles begin, commit, and rollback.
    /// - Parameter operation: The function to execute within the transaction
    /// - Returns: The result of the function
    public func withTransaction<T>(_ operation: () throws -> T) throws -> T {
        try client.beginTransaction()
        do {
            let result = try operation()
            try client.commitTransaction()
            return result
        } catch {
            try? client.rollbackTransaction()
            throw error
        }
    }

    // MARK: - Utility Methods

    /// Generate a new id.
    /// - Returns: A new UUID string
    public func generateId() -> String {
        return UUID().uuidString.lowercased()
    }

    /// Get the current timestamp in the standard format.
    /// - Returns: Current timestamp string
    public func now() -> String {
        return DateHelpers.now()
    }
}
