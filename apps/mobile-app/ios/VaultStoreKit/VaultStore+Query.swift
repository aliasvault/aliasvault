import Foundation
import SQLite
import VaultModels
import VaultUtils

/// Extension for the VaultStore class to handle query management
extension VaultStore {
    // MARK: - Core Database Operations (DatabaseClient Protocol)

    /// Execute a SELECT query on the database
    public func executeQuery(_ query: String, params: [Binding?]) throws -> [[String: Any]] {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }

        var params = params
        for (index, param) in params.enumerated() {
            if let base64String = param as? String {
                if base64String.hasPrefix("av-base64-to-blob:") {
                    let base64 = String(base64String.dropFirst("av-base64-to-blob:".count))
                    if let data = Data(base64Encoded: base64) {
                        params[index] = Blob(bytes: [UInt8](data))
                    }
                }
            }
        }

        let statement = try dbConnection.prepare(query)
        var results: [[String: Any]] = []

        for row in try statement.run(params) {
            var rowDict: [String: Any] = [:]
            for (index, column) in statement.columnNames.enumerated() {
                let value = row[index]
                switch value {
                case let data as SQLite.Blob:
                    let binaryData = Data(data.bytes)
                    rowDict[column] = binaryData.base64EncodedString()
                case let number as Int64:
                    rowDict[column] = number
                case let number as Double:
                    rowDict[column] = number
                case let text as String:
                    rowDict[column] = text
                case .none:
                    rowDict[column] = NSNull()
                default:
                    rowDict[column] = value
                }
            }
            results.append(rowDict)
        }

        return results
    }

    /// Execute an UPDATE, INSERT, or DELETE query on the database (which will modify the database).
    public func executeUpdate(_ query: String, params: [Binding?]) throws -> Int {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }

        var params = params
        for (index, param) in params.enumerated() {
            if let base64String = param as? String {
                if base64String.hasPrefix("av-base64-to-blob:") {
                    let base64 = String(base64String.dropFirst("av-base64-to-blob:".count))
                    if let data = Data(base64Encoded: base64) {
                        params[index] = Blob(bytes: [UInt8](data))
                    }
                }
            }
        }

        let statement = try dbConnection.prepare(query)
        try statement.run(params)
        return dbConnection.changes
    }

    /// Execute a raw SQL command on the database without parameters (for DDL operations like CREATE TABLE).
    public func executeRaw(_ query: String) throws {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }

        // Split the query by semicolons to handle multiple statements
        let statements = query.components(separatedBy: ";")

        for statement in statements {
            let trimmedStatement = statement.smartTrim()

            // Skip empty statements and transaction control statements (handled externally)
            if trimmedStatement.isEmpty ||
               trimmedStatement.uppercased().hasPrefix("BEGIN TRANSACTION") ||
               trimmedStatement.uppercased().hasPrefix("COMMIT") ||
               trimmedStatement.uppercased().hasPrefix("ROLLBACK") {
                continue
            }

            try dbConnection.execute(trimmedStatement)
        }
    }

    /// Begin a transaction on the database. This is required for all database operations that modify the database.
    public func beginTransaction() throws {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }
        try dbConnection.execute("BEGIN TRANSACTION")
    }

    /// Persist the in-memory database to encrypted local storage using VACUUM INTO.
    /// Produces a fully faithful, compact copy (schema + data), unlike CTAS copies.
    public func persistDatabaseToEncryptedStorage() throws {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }

        // Make sure we are not inside an explicit transaction; VACUUM INTO must run outside.
        // If you have your own transaction management, ensure it's committed before calling this.
        // Optional: give SQLite time to resolve locks
        try? dbConnection.execute("PRAGMA busy_timeout=5000")

        // End any lingering transaction (no-op if none).
       _ = try? dbConnection.execute("END")

        // Prepare a fresh temp file path for VACUUM INTO; it must NOT already exist.
        let tempDbURL = FileManager.default.temporaryDirectory.appendingPathComponent("temp_db.sqlite")
        if FileManager.default.fileExists(atPath: tempDbURL.path) {
            try FileManager.default.removeItem(at: tempDbURL)
        }

        // Quote the target path safely for SQL (VACUUM INTO does not accept parameters in some builds).
        // Escape single quotes per SQL rules.
        let quotedPath = "'" + tempDbURL.path.replacingOccurrences(of: "'", with: "''") + "'"

        // Run VACUUM INTO to create a compact, faithful copy of the current DB.
        // Must be executed with no active transaction and no attached target needed.
        // This preserves schema, indexes, triggers, views, pragmas like page_size, auto_vacuum, encoding, user_version, etc.
        // Retry VACUUM INTO a few times if we hit "statements in progress"
        var lastError: Error?
        for attempt in 1...5 {
            do {
                try dbConnection.execute("VACUUM INTO \(quotedPath)")
                lastError = nil
                break
            } catch {
                lastError = error
                let msg = String(describing: error).lowercased()
                if msg.contains("statements in progress") || msg.contains("locked") {
                    Thread.sleep(forTimeInterval: 0.15 * Double(attempt)) // backoff
                    continue
                } else {
                    break
                }
            }
        }
        if let err = lastError {
            print("❌ VACUUM INTO failed after retries:", err)
            throw NSError(domain: "VaultStore", code: 6,
                          userInfo: [NSLocalizedDescriptionKey:
                            "VACUUM INTO failed: \(err.localizedDescription)"])
        }

        // Read -> encrypt -> store the compact copy
        let rawData = try Data(contentsOf: tempDbURL)
        let base64String = rawData.base64EncodedString()
        let encryptedBase64Data = try encrypt(data: Data(base64String.utf8))
        let encryptedBase64String = encryptedBase64Data.base64EncodedString()
        try storeEncryptedDatabase(encryptedBase64String)

        // Clean up temp file
        try? FileManager.default.removeItem(at: tempDbURL)
    }

    /// Commit a transaction on the database. This is required for all database operations that modify the database.
    /// Committing a transaction will also trigger a persist from the in-memory database to the encrypted database file.
    /// It also atomically marks the vault as dirty and increments the mutation sequence for proper sync tracking.
    public func commitTransaction() throws {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }

        try dbConnection.execute("COMMIT")
        try persistDatabaseToEncryptedStorage()

        // Atomically mark vault as dirty and increment mutation sequence
        // This ensures sync can properly detect local changes
        setIsDirty(true)
        _ = incrementMutationSequence()
    }

    /// Rollback a transaction on the database on error.
    public func rollbackTransaction() throws {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }
        try dbConnection.execute("ROLLBACK")
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
        return try itemRepository.getById(itemId.uuidString.uppercased())
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

    /// Move an item to trash.
    /// - Parameter itemId: The UUID of the item to trash
    /// - Returns: Number of rows affected
    @discardableResult
    public func trashItem(_ itemId: UUID) throws -> Int {
        return try itemRepository.trash(itemId.uuidString.uppercased())
    }

    /// Restore an item from trash.
    /// - Parameter itemId: The UUID of the item to restore
    /// - Returns: Number of rows affected
    @discardableResult
    public func restoreItem(_ itemId: UUID) throws -> Int {
        return try itemRepository.restore(itemId.uuidString.uppercased())
    }

    /// Permanently delete an item.
    /// - Parameter itemId: The UUID of the item to permanently delete
    /// - Returns: Number of rows affected
    @discardableResult
    public func permanentlyDeleteItem(_ itemId: UUID) throws -> Int {
        return try itemRepository.permanentlyDelete(itemId.uuidString.uppercased())
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

        return AutofillCredential(from: item, passkey: passkey)
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
}
