import Foundation

/// A query parameter: nil, String, Int, Int64, Double, Bool, Data, or a base64 string behind `av-base64-to-blob:`.
public typealias SqliteBindValue = Any?

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
    @discardableResult
    func executeUpdate(_ query: String, params: [SqliteBindValue]) throws -> Int

    /// Begin a database transaction.
    func beginTransaction() throws

    /// Commit a database transaction.
    /// - Parameter scope: What the mutation touched, so the next sync can push only that scope
    func commitTransaction(scope: String) throws

    /// Rollback a database transaction.
    func rollbackTransaction() throws

    /// The id of the user's personal manifest, or nil before the first pull recorded one.
    func personalManifestId() -> String?
}
