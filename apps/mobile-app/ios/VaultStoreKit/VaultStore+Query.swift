import Foundation
import RustCoreFramework
import VaultModels
import VaultUtils

/// Extension for the VaultStore class to handle query management
extension VaultStore {
    // MARK: - Core Database Operations (DatabaseClient Protocol)

    /// Prefix repositories put in front of base64 text to bind it as a BLOB.
    private static let blobParamPrefix = "av-base64-to-blob:"

    /// Execute a SELECT query on the database
    public func executeQuery(_ query: String, params: [SqliteBindValue]) throws -> [[String: Any]] {
        return try executeQuery(query, params: params, blobPrefix: "")
    }

    /// Execute a SELECT query on the database, returning BLOB columns as base64 behind `blobPrefix`.
    public func executeQuery(_ query: String, params: [SqliteBindValue], blobPrefix: String) throws -> [[String: Any]] {
        let result = try requireDatabase().queryValues(sql: query, params: params.map(Self.toSqlValue))
        return result.rows.map { row in
            var rowDict: [String: Any] = [:]
            for (index, column) in result.columns.enumerated() {
                rowDict[column] = Self.fromSqlValue(row[index], blobPrefix: blobPrefix)
            }
            return rowDict
        }
    }

    /// Execute an UPDATE, INSERT, or DELETE query on the database (which will modify the database).
    public func executeUpdate(_ query: String, params: [SqliteBindValue]) throws -> Int {
        return Int(try requireDatabase().execute(sql: query, params: params.map(Self.toSqlValue)))
    }

    /// Execute a raw SQL script (one or more statements) without parameters.
    /// Migration SQL scripts handle their own transactions and PRAGMA statements.
    public func executeRaw(_ query: String) throws {
        try requireDatabase().executeBatch(sql: query)
    }

    /// Begin a transaction on the database. This is required for all database operations that modify the database.
    public func beginTransaction() throws {
        try requireDatabase().executeBatch(sql: "BEGIN TRANSACTION")
    }

    /// Persist the in-memory database to encrypted local storage.
    public func persistDatabaseToEncryptedStorage() throws {
        let database = try requireDatabase()
        // End any open transactions.
        _ = try? database.executeBatch(sql: "END")
        let encrypted = try encrypt(data: try exportDatabase())
        try storeEncryptedDatabase(encrypted.base64EncodedString())
    }

    /// The database as SQLite file bytes, compacted first when no transaction is open.
    public func exportDatabase() throws -> Data {
        let database = try requireDatabase()
        _ = try? database.executeBatch(sql: "VACUUM")
        return try database.export()
    }

    /// Commit a transaction on the database. This is required for all database operations that modify the database.
    public func commitTransaction() throws {
        try requireDatabase().executeBatch(sql: "COMMIT")
        try persistDatabaseToEncryptedStorage()

        // Atomically mark vault as dirty and increment mutation sequence
        // This ensures sync can properly detect local changes
        setIsDirty(true)
        _ = incrementMutationSequence()
    }

    /// Rollback a transaction on the database on error.
    public func rollbackTransaction() throws {
        try requireDatabase().executeBatch(sql: "ROLLBACK")
    }

    /// Persist the in-memory database to encrypted storage and mark as dirty.
    public func persistAndMarkDirty() throws {
        try persistDatabaseToEncryptedStorage()

        // Atomically mark vault as dirty and increment mutation sequence
        // This ensures sync can properly detect local changes
        setIsDirty(true)
        _ = incrementMutationSequence()
    }

    /// The open database, or the error every query path reports while the vault is locked.
    internal func requireDatabase() throws -> SqliteMemoryDatabase {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }
        return dbConnection
    }

    private static func toSqlValue(_ param: SqliteBindValue) -> SqlValue {
        switch param {
        case nil:
            return .null
        case let value as SqlValue:
            return value
        case let value as Data:
            return .blob(value)
        case let value as String:
            if value.hasPrefix(blobParamPrefix), let bytes = Data(base64Encoded: String(value.dropFirst(blobParamPrefix.count))) {
                return .blob(bytes)
            }
            return .text(value)
        case let value as Bool:
            return .integer(value ? 1 : 0)
        case let value as Int:
            return .integer(Int64(value))
        case let value as Int64:
            return .integer(value)
        case let value as Double:
            return .real(value)
        default:
            return .text(String(describing: param!))
        }
    }

    private static func fromSqlValue(_ value: SqlValue, blobPrefix: String) -> Any {
        switch value {
        case .null:
            return NSNull()
        case .integer(let number):
            return number
        case .real(let number):
            return number
        case .text(let text):
            return text
        case .blob(let bytes):
            return blobPrefix + bytes.base64EncodedString()
        }
    }

    // MARK: - Items (Using Repository Pattern)

    /// Get all items from the database using the new field-based model.
    /// Delegates to ItemRepository for the actual query logic.
    public func getAllItems() throws -> [Item] {
        return try itemRepository.getAll()
    }

    /// Get a single item by ID.
    /// - Parameter itemId: The UUID of the item to fetch
    /// - Returns: Item object or nil if not found
    public func getItemById(_ itemId: UUID) throws -> Item? {
        return try itemRepository.getById(itemId.uuidString.lowercased())
    }

    /// Get all items that have passkeys.
    public func getAllItemsWithPasskeys() throws -> [Item] {
        return try getAllItems().filter { $0.hasPasskey }
    }

    /// Get all unique email addresses from items.
    /// - Returns: Array of email addresses
    public func getAllItemEmailAddresses() throws -> [String] {
        return try itemRepository.getAllEmailAddresses()
    }

    /// Get recently deleted items (in trash).
    /// - Returns: Array of items
    public func getRecentlyDeletedItems() throws -> [Item] {
        return try itemRepository.getRecentlyDeleted()
    }

    /// Get count of items in trash.
    /// - Returns: Number of items in trash
    public func getRecentlyDeletedCount() throws -> Int {
        return try itemRepository.getRecentlyDeletedCount()
    }

    /// Get archived items.
    /// - Returns: Array of items
    public func getArchivedItems() throws -> [Item] {
        return try itemRepository.getArchived()
    }

    /// Get count of archived items.
    /// - Returns: Number of archived items
    public func getArchivedCount() throws -> Int {
        return try itemRepository.getArchivedCount()
    }

    /// Archive an item, hiding it from the main list and from autofill.
    /// - Parameter itemId: The UUID of the item to archive
    /// - Returns: Number of rows affected
    @discardableResult
    public func archiveItem(_ itemId: UUID) throws -> Int {
        return try itemRepository.archive(itemId.uuidString.lowercased())
    }

    /// Unarchive an item.
    /// - Parameter itemId: The UUID of the item to unarchive
    /// - Returns: Number of rows affected
    @discardableResult
    public func unarchiveItem(_ itemId: UUID) throws -> Int {
        return try itemRepository.unarchive(itemId.uuidString.lowercased())
    }

    /// Move an item to trash.
    /// - Parameter itemId: The UUID of the item to trash
    /// - Returns: Number of rows affected
    @discardableResult
    public func trashItem(_ itemId: UUID) throws -> Int {
        return try itemRepository.trash(itemId.uuidString.lowercased())
    }

    /// Restore an item from trash.
    /// - Parameter itemId: The UUID of the item to restore
    /// - Returns: Number of rows affected
    @discardableResult
    public func restoreItem(_ itemId: UUID) throws -> Int {
        return try itemRepository.restore(itemId.uuidString.lowercased())
    }

    /// Permanently delete an item.
    /// - Parameter itemId: The UUID of the item to permanently delete
    /// - Returns: Number of rows affected
    @discardableResult
    public func permanentlyDeleteItem(_ itemId: UUID) throws -> Int {
        return try itemRepository.permanentlyDelete(itemId.uuidString.lowercased())
    }

    /// Create a new item.
    /// - Parameter item: The item to create
    /// - Returns: The ID of the created item
    @discardableResult
    public func createItem(_ item: Item) throws -> String {
        return try itemRepository.create(item)
    }

    /// Update an existing item.
    /// - Parameter item: The item to update
    /// - Returns: Number of rows affected
    @discardableResult
    public func updateItem(_ item: Item) throws -> Int {
        return try itemRepository.update(item)
    }

    /// Append a URL to an existing credential's `login.url` multi-value field
    /// without disturbing existing URLs on the credential. Caller is responsible
    /// for kicking off `mutateVault(using:)` afterwards to push the change.
    /// - Parameters:
    ///   - itemId: The UUID of the credential to append to
    ///   - url: The URL or app package identifier to add
    public func appendUrl(toItemId itemId: UUID, url: String) throws {
        try itemRepository.appendFieldValue(
            itemId: itemId.uuidString.lowercased(),
            fieldKey: FieldKey.loginUrl,
            value: url
        )
    }

    // MARK: - Autofill Credentials

    /// Get all items for autofill from the database.
    /// This method converts Items to AutofillCredential for iOS Autofill extension.
    public func getAllAutofillCredentials() throws -> [AutofillCredential] {
        let items = try getAllItems()
        return items.compactMap { convertItemToAutofillCredential($0) }
    }

    /// Convert an Item to an AutofillCredential for iOS Autofill.
    private func convertItemToAutofillCredential(_ item: Item) -> AutofillCredential? {
        // Load passkey for this item (gets first non-deleted passkey)
        let passkeys = try? getPasskeys(forItemId: item.id)
        let passkey = passkeys?.first

        // Load the TOTP code for this item (gets first non-deleted TOTP code)
        let totpCode = try? getFirstTotpCode(forItemId: item.id)

        return AutofillCredential(from: item, passkey: passkey, totp: totpCode ?? nil)
    }

    /// Get all items that have passkeys for passkey autofill.
    public func getAllAutofillCredentialsWithPasskeys() throws -> [AutofillCredential] {
        var credentials = try getAllAutofillCredentials()

        // Filter to only include credentials that actually have a passkey
        credentials = credentials.filter { credential in
            return credential.hasPasskey
        }

        return credentials
    }

    // MARK: - TOTP Operations

    /// Get the first TOTP code for a specific item.
    /// - Parameter itemId: The UUID of the item
    /// - Returns: Optional TotpCode if one exists
    /// - Throws: Database errors
    public func getFirstTotpCode(forItemId itemId: UUID) throws -> TotpCode? {
        return try totpRepository.getFirstTotpCodeForItem(itemId)
    }
}
