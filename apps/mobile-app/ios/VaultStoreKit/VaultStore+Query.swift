import Foundation
import RustCoreFramework
import VaultModels
import VaultUtils

/// A query parameter: nil, String, Int, Int64, Double, Bool, Data, SqlValue, or a base64 string behind `av-base64-to-blob:`.
public typealias SqliteBindValue = Any?

/// Extension for the VaultStore class to handle query management
extension VaultStore {
    // MARK: - Core Database Operations

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
    @discardableResult
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
    private func persistDatabaseToEncryptedStorage() throws {
        let database = try requireDatabase()
        // End any open transactions.
        _ = try? database.executeBatch(sql: "END")
        let encrypted = try encrypt(data: try exportDatabase())
        try storeEncryptedDatabase(encrypted.base64EncodedString())
    }

    /// The database as SQLite file bytes.
    public func exportDatabase() throws -> Data {
        return try requireDatabase().export()
    }

    /// Commit a transaction on the database. This is required for all database operations that modify the database.
    /// - Parameter scope: What the mutation touched, so the next sync can push only that scope
    public func commitTransaction(scope: String = VaultMutationScope.main) throws {
        try requireDatabase().executeBatch(sql: "COMMIT")
        try persistAndMarkDirty(scope: scope)
    }

    /// Rollback a transaction on the database on error.
    public func rollbackTransaction() throws {
        try requireDatabase().executeBatch(sql: "ROLLBACK")
    }

    /// Persist the in-memory database to encrypted storage and mark as dirty.
    /// - Parameter scope: What the mutation touched, so the next sync can push only that scope
    public func persistAndMarkDirty(scope: String = VaultMutationScope.main) throws {
        try persistDatabaseToEncryptedStorage()

        // Atomically mark vault as dirty and increment mutation sequence
        // This ensures sync can properly detect local changes
        markDirty(scope: scope)
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

    /// Run `operation` in a transaction whose commit persists the vault and marks it dirty for `scope`.
    internal func withTransaction<T>(scope: String = VaultMutationScope.main, _ operation: () throws -> T) throws -> T {
        try beginTransaction()
        do {
            let result = try operation()
            try commitTransaction(scope: scope)
            return result
        } catch {
            try? rollbackTransaction()
            throw error
        }
    }

    // MARK: - Items

    /// Get all active items (not deleted, trashed or archived) with their fields and folder paths, newest first.
    public func getAllItems() throws -> [Item] {
        return try requireDatabase().getAllActiveItems().compactMap(Self.item(from:))
    }

    /// Append a URL to an existing credential's `login.url` values without touching its other URLs. The caller
    /// starts `mutateVault(using:)` afterwards to push the change.
    /// - Parameters:
    ///   - itemId: The UUID of the credential to append to
    ///   - manifestId: The manifest the credential belongs to
    ///   - url: The URL or app package identifier to add
    public func appendUrl(toItemId itemId: UUID, manifestId: String, url: String) throws {
        try withTransaction {
            _ = try requireDatabase().appendFieldValue(itemId: itemId.uuidString.lowercased(), manifestId: manifestId, fieldKey: FieldKey.loginUrl, value: url)
        }
    }

    /// Record one use of an item in its ItemStats row, in its own transaction so the vault is persisted and marked dirty.
    /// - Parameters:
    ///   - itemId: The item that was used
    ///   - manifestId: The manifest the item belongs to
    ///   - action: What the user did with it
    public func recordItemUsage(itemId: UUID, manifestId: String, action: ItemUsageAction) throws {
        // Usage statistics live in their own data bucket, pushed without a full manifest write.
        try withTransaction(scope: VaultDataBucketCategory.stats) {
            _ = try requireDatabase().recordItemUse(itemId: itemId.uuidString.lowercased(), manifestId: manifestId, action: action)
        }
    }

    /// An item from the Rust core as the model the autofill layer works with.
    private static func item(from row: VaultItem) -> Item? {
        guard let id = UUID(uuidString: row.id) else { return nil }

        // A built-in logo carries no bytes: it is drawn from the shared catalog, keyed by its Source.
        let logo = row.logoKind == "builtin" ? row.logoSource.flatMap { BuiltinLogos.svg(for: $0)?.data(using: .utf8) } : row.logo
        let fields = row.fields.map {
            ItemField(
                fieldKey: $0.fieldKey,
                label: $0.label,
                fieldType: $0.fieldType,
                value: $0.value,
                isHidden: $0.isHidden,
                displayOrder: Int($0.displayOrder),
                isCustomField: $0.isCustomField,
                enableHistory: $0.enableHistory
            )
        }
        return Item(
            id: id,
            manifestId: row.manifestId,
            name: row.name,
            itemType: row.itemType,
            logo: logo,
            folderId: row.folderId.flatMap { UUID(uuidString: $0) },
            folderPath: row.folderPath.isEmpty ? nil : row.folderPath,
            fields: fields,
            hasPasskey: row.hasPasskey,
            hasAttachment: row.hasAttachment,
            hasTotp: row.hasTotp,
            createdAt: date(row.createdAtMs),
            updatedAt: date(row.updatedAtMs)
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
        let passkey = (try? getPasskeys(forItemId: item.id, manifestId: item.manifestId))?.first

        // Load the TOTP code for this item (gets first non-deleted TOTP code)
        let totpCode = (try? getFirstTotpCode(forItemId: item.id, manifestId: item.manifestId)) ?? nil

        return AutofillCredential(from: item, passkey: passkey, totp: totpCode)
    }

    /// Get all items that have passkeys for passkey autofill.
    public func getAllAutofillCredentialsWithPasskeys() throws -> [AutofillCredential] {
        return try getAllAutofillCredentials().filter { $0.hasPasskey }
    }

    // MARK: - TOTP Operations

    /// Get the first TOTP code for a specific item.
    /// - Parameters:
    ///   - itemId: The UUID of the item
    ///   - manifestId: The manifest the item belongs to
    /// - Returns: Optional TotpCode if one exists
    /// - Throws: Database errors
    public func getFirstTotpCode(forItemId itemId: UUID, manifestId: String) throws -> TotpCode? {
        guard let row = try requireDatabase().getTotpCodesForItem(itemId: itemId.uuidString.lowercased(), manifestId: manifestId).first, let id = UUID(uuidString: row.id) else {
            return nil
        }
        return TotpCode(id: id, name: row.name, secretKey: row.secretKey, algorithm: row.algorithm, digits: Int(row.digits), period: Int(row.period), itemId: itemId, isDeleted: false)
    }
}
