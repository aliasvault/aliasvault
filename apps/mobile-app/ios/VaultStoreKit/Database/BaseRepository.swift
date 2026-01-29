import Foundation
import VaultUtils

/// Base repository class with common database operations.
/// Provides transaction handling, soft delete, and other shared functionality.
public class BaseRepository {
    /// The database client used for executing queries.
    internal let client: DatabaseClient

    /// Initialize the repository with a database client.
    /// - Parameter client: The database client to use
    public init(client: DatabaseClient) {
        self.client = client
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

    // MARK: - Soft Delete Helpers

    /// Soft delete a record by setting IsDeleted = 1.
    /// - Parameters:
    ///   - table: The table name
    ///   - id: The record ID
    /// - Returns: Number of rows affected
    @discardableResult
    public func softDelete(table: String, id: String) throws -> Int {
        let timestamp = DateHelpers.now()
        return try client.executeUpdate(
            "UPDATE \(table) SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?",
            params: [timestamp, id]
        )
    }

    /// Soft delete records by a foreign key.
    /// - Parameters:
    ///   - table: The table name
    ///   - foreignKey: The foreign key column name
    ///   - foreignKeyValue: The foreign key value
    /// - Returns: Number of rows affected
    @discardableResult
    public func softDeleteByForeignKey(table: String, foreignKey: String, foreignKeyValue: String) throws -> Int {
        let timestamp = DateHelpers.now()
        return try client.executeUpdate(
            "UPDATE \(table) SET IsDeleted = 1, UpdatedAt = ? WHERE \(foreignKey) = ?",
            params: [timestamp, foreignKeyValue]
        )
    }

    // MARK: - Hard Delete Helpers

    /// Hard delete a record permanently.
    /// - Parameters:
    ///   - table: The table name
    ///   - id: The record ID
    /// - Returns: Number of rows affected
    @discardableResult
    public func hardDelete(table: String, id: String) throws -> Int {
        return try client.executeUpdate(
            "DELETE FROM \(table) WHERE Id = ?",
            params: [id]
        )
    }

    /// Hard delete records by a foreign key.
    /// - Parameters:
    ///   - table: The table name
    ///   - foreignKey: The foreign key column name
    ///   - foreignKeyValue: The foreign key value
    /// - Returns: Number of rows affected
    @discardableResult
    public func hardDeleteByForeignKey(table: String, foreignKey: String, foreignKeyValue: String) throws -> Int {
        return try client.executeUpdate(
            "DELETE FROM \(table) WHERE \(foreignKey) = ?",
            params: [foreignKeyValue]
        )
    }

    // MARK: - Utility Methods

    /// Check if a table exists in the database.
    /// - Parameter tableName: The name of the table to check
    /// - Returns: True if the table exists
    public func tableExists(_ tableName: String) throws -> Bool {
        let results = try client.executeQuery(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            params: [tableName]
        )
        return !results.isEmpty
    }

    /// Generate a new UUID in uppercase format.
    /// - Returns: A new UUID string
    public func generateId() -> String {
        return UUID().uuidString.uppercased()
    }

    /// Get the current timestamp in the standard format.
    /// - Returns: Current timestamp string
    public func now() -> String {
        return DateHelpers.now()
    }

    /// Build a parameterized IN clause for SQL queries.
    /// - Parameter values: Array of values for the IN clause
    /// - Returns: Tuple with placeholders string and values array
    public func buildInClause(_ values: [String]) -> (placeholders: String, values: [String]) {
        let placeholders = values.map { _ in "?" }.joined(separator: ",")
        return (placeholders, values)
    }
}
