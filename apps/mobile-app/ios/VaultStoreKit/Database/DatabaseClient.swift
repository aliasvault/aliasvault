import Foundation
import SQLite

/// Type alias for SQLite bind values.
public typealias SqliteBindValue = Binding?

/// Protocol for core database operations needed by repositories.
/// Abstracts the SQLite database connection to allow for testing and flexibility.
public protocol DatabaseClient: AnyObject {
    /// Execute a SELECT query and return results as an array of dictionaries.
    /// - Parameters:
    ///   - query: The SQL query to execute
    ///   - params: The parameters to bind to the query
    /// - Returns: Array of dictionaries representing the result rows
    func executeQuery(_ query: String, params: [SqliteBindValue]) throws -> [[String: Any]]

    /// Execute an UPDATE, INSERT, or DELETE query.
    /// - Parameters:
    ///   - query: The SQL query to execute
    ///   - params: The parameters to bind to the query
    /// - Returns: Number of rows affected
    func executeUpdate(_ query: String, params: [SqliteBindValue]) throws -> Int

    /// Begin a database transaction.
    func beginTransaction() throws

    /// Commit a database transaction.
    func commitTransaction() throws

    /// Rollback a database transaction.
    func rollbackTransaction() throws
}
