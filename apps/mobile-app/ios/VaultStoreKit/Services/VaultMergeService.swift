import Foundation
import SQLite3
import CryptoKit
import RustCoreFramework

/// Service for vault merge operations using the Rust core library.
/// Wraps UniFFI-generated bindings for LWW merge operations on SQLite vault databases.
public class VaultMergeService {
    public static let shared = VaultMergeService()

    private init() {}

    /// Error types for vault merge operations.
    public enum VaultMergeError: Error, LocalizedError {
        case jsonError(String)
        case rustError(String)
        case databaseError(String)
        case invalidInput(String)
        case encryptionError(String)

        public var errorDescription: String? {
            switch self {
            case .jsonError(let msg): return "JSON error: \(msg)"
            case .rustError(let msg): return "Rust error: \(msg)"
            case .databaseError(let msg): return "Database error: \(msg)"
            case .invalidInput(let msg): return "Invalid input: \(msg)"
            case .encryptionError(let msg): return "Encryption error: \(msg)"
            }
        }
    }

    /// Get the list of syncable table names from Rust.
    public func getTableNames() -> [String] {
        // Calls UniFFI-generated function from aliasvault_core.swift
        return getSyncableTableNames()
    }

    /// Merge local and server vaults using LWW strategy.
    ///
    /// - Parameters:
    ///   - localVaultBase64: Base64-encoded encrypted local vault (format: base64(encrypted(base64(sqlite))))
    ///   - serverVaultBase64: Base64-encoded encrypted server vault (format: base64(encrypted(base64(sqlite))))
    ///   - encryptionKey: The encryption key for decrypting vaults
    /// - Returns: Base64-encoded merged vault blob (same format as input)
    public func mergeVaults(
        localVaultBase64: String,
        serverVaultBase64: String,
        encryptionKey: Data
    ) throws -> String {
        // Decrypt both vaults
        // Format is: base64(encrypted(base64(rawSqlite)))
        // Step 1: Decode outer base64 to get encrypted bytes
        guard let localVaultData = Data(base64Encoded: localVaultBase64),
              let serverVaultData = Data(base64Encoded: serverVaultBase64) else {
            print("[VaultMergeService] Failed to decode outer base64")
            throw VaultMergeError.invalidInput("Invalid base64 vault data")
        }

        // Step 2: Decrypt to get inner base64 string
        let localDecryptedBase64 = try decrypt(data: localVaultData, using: encryptionKey)
        let serverDecryptedBase64 = try decrypt(data: serverVaultData, using: encryptionKey)

        // Step 3: Decode inner base64 to get raw SQLite bytes
        guard let localDecryptedString = String(data: localDecryptedBase64, encoding: .utf8),
              let localDecrypted = Data(base64Encoded: localDecryptedString) else {
            throw VaultMergeError.invalidInput("Invalid inner base64 in local vault")
        }
        guard let serverDecryptedString = String(data: serverDecryptedBase64, encoding: .utf8),
              let serverDecrypted = Data(base64Encoded: serverDecryptedString) else {
            throw VaultMergeError.invalidInput("Invalid inner base64 in server vault")
        }

        // Open both SQLite databases
        let localDb = try openDatabase(from: localDecrypted)
        let serverDb = try openDatabase(from: serverDecrypted)
        defer {
            sqlite3_close(localDb)
            sqlite3_close(serverDb)
        }

        // Read all syncable tables from both databases
        let tableNames = getTableNames()
        var localTables: [[String: Any]] = []
        var serverTables: [[String: Any]] = []

        for tableName in tableNames {
            let localRecords = try readTable(from: localDb, tableName: tableName)
            localTables.append([
                "name": tableName,
                "records": localRecords
            ])

            let serverRecords = try readTable(from: serverDb, tableName: tableName)
            serverTables.append([
                "name": tableName,
                "records": serverRecords
            ])
        }

        // Create merge input and call Rust
        let mergeInput: [String: Any] = [
            "local_tables": localTables,
            "server_tables": serverTables
        ]

        let inputJson = try serializeToJson(mergeInput)
        // Call UniFFI-generated function from aliasvault_core.swift
        let outputJson = try mergeVaultsJson(inputJson: inputJson)
        let output = try parseOutput(outputJson)


        // Apply SQL statements to local database
        for (index, statement) in output.statements.enumerated() {
            try executeStatement(on: localDb, sql: statement.sql, params: statement.params)
        }

        // Export, encrypt, and return in same format: base64(encrypted(base64(sqlite)))
        let mergedData = try exportDatabase(from: localDb)
        // Step 1: Base64 encode raw SQLite bytes
        let innerBase64 = mergedData.base64EncodedString()
        // Step 2: Encrypt the base64 string
        let encryptedData = try encrypt(data: Data(innerBase64.utf8), using: encryptionKey)
        // Step 3: Base64 encode the encrypted data
        return encryptedData.base64EncodedString()
    }

    /// Prune expired items from trash.
    ///
    /// - Parameters:
    ///   - vaultBase64: Base64-encoded encrypted vault (format: base64(encrypted(base64(sqlite))))
    ///   - retentionDays: Number of days to keep items in trash (default: 30)
    ///   - encryptionKey: The encryption key for decrypting vault
    /// - Returns: Tuple of (prunedVaultBase64, prunedCount) - same format as input
    public func pruneVault(
        vaultBase64: String,
        retentionDays: Int = 30,
        encryptionKey: Data
    ) throws -> (vaultBase64: String, prunedCount: Int) {
        // Decrypt vault: base64(encrypted(base64(sqlite)))
        // Step 1: Decode outer base64 to get encrypted bytes
        guard let vaultData = Data(base64Encoded: vaultBase64) else {
            throw VaultMergeError.invalidInput("Invalid base64 vault data")
        }

        // Step 2: Decrypt to get inner base64 string
        let decryptedBase64 = try decrypt(data: vaultData, using: encryptionKey)

        // Step 3: Decode inner base64 to get raw SQLite bytes
        guard let decryptedString = String(data: decryptedBase64, encoding: .utf8),
              let decrypted = Data(base64Encoded: decryptedString) else {
            throw VaultMergeError.invalidInput("Invalid inner base64 in vault")
        }

        let db = try openDatabase(from: decrypted)
        defer { sqlite3_close(db) }

        // Read tables needed for pruning
        let pruneTableNames = ["Items", "FieldValues", "Attachments", "TotpCodes", "Passkeys"]
        var tables: [[String: Any]] = []

        for tableName in pruneTableNames {
            tables.append([
                "name": tableName,
                "records": try readTable(from: db, tableName: tableName)
            ])
        }

        // Call Rust prune - use ISO8601 format: YYYY-MM-DDTHH:MM:SS.sssZ
        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let currentTime = dateFormatter.string(from: Date())

        let pruneInput: [String: Any] = [
            "tables": tables,
            "retention_days": retentionDays,
            "current_time": currentTime
        ]

        let inputJson = try serializeToJson(pruneInput)
        // Call UniFFI-generated function from aliasvault_core.swift
        let outputJson = try pruneVaultJson(inputJson: inputJson)
        let output = try parseOutput(outputJson)

        // Apply SQL statements
        for statement in output.statements {
            try executeStatement(on: db, sql: statement.sql, params: statement.params)
        }

        // Export, encrypt, and return in same format: base64(encrypted(base64(sqlite)))
        let prunedData = try exportDatabase(from: db)
        // Step 1: Base64 encode raw SQLite bytes
        let innerBase64 = prunedData.base64EncodedString()
        // Step 2: Encrypt the base64 string
        let encryptedData = try encrypt(data: Data(innerBase64.utf8), using: encryptionKey)
        // Step 3: Base64 encode the encrypted data
        return (encryptedData.base64EncodedString(), output.statements.count)
    }

    // MARK: - Encryption Helpers

    private func encrypt(data: Data, using key: Data) throws -> Data {
        let symmetricKey = SymmetricKey(data: key)
        guard let sealedBox = try? AES.GCM.seal(data, using: symmetricKey),
              let combined = sealedBox.combined else {
            throw VaultMergeError.encryptionError("Encryption failed")
        }
        return combined
    }

    private func decrypt(data: Data, using key: Data) throws -> Data {
        let symmetricKey = SymmetricKey(data: key)
        guard let sealedBox = try? AES.GCM.SealedBox(combined: data),
              let decrypted = try? AES.GCM.open(sealedBox, using: symmetricKey) else {
            throw VaultMergeError.encryptionError("Decryption failed")
        }
        return decrypted
    }

    // MARK: - Database Helpers

    private struct ParsedOutput {
        let statements: [(sql: String, params: [Any])]
    }

    private func openDatabase(from data: Data) throws -> OpaquePointer {
        var db: OpaquePointer?
        guard sqlite3_open(":memory:", &db) == SQLITE_OK else {
            throw VaultMergeError.databaseError("Failed to open in-memory database")
        }

        let count = Int32(data.count)
        let result = data.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) -> Int32 in
            guard let baseAddress = ptr.baseAddress else { return SQLITE_ERROR }
            let pData = sqlite3_malloc(count)
            memcpy(pData, baseAddress, Int(count))
            return sqlite3_deserialize(
                db,
                "main",
                pData?.assumingMemoryBound(to: UInt8.self),
                Int64(count),
                Int64(count),
                UInt32(SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE)
            )
        }

        guard result == SQLITE_OK else {
            sqlite3_close(db)
            print("[VaultMergeService] Failed to deserialize database: \(result)")
            throw VaultMergeError.databaseError("Failed to deserialize database: \(result)")
        }

        return db!
    }

    private func exportDatabase(from db: OpaquePointer) throws -> Data {
        var size: sqlite3_int64 = 0
        guard let serialized = sqlite3_serialize(db, "main", &size, 0) else {
            throw VaultMergeError.databaseError("Failed to serialize database")
        }
        let data = Data(bytes: serialized, count: Int(size))
        sqlite3_free(serialized)
        return data
    }

    private func readTable(from db: OpaquePointer, tableName: String) throws -> [[String: Any]] {
        var records: [[String: Any]] = []

        // Check if table exists
        let checkSql = "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        var checkStmt: OpaquePointer?
        let prepareResult = sqlite3_prepare_v2(db, checkSql, -1, &checkStmt, nil)
        guard prepareResult == SQLITE_OK else {
            let errorMsg = String(cString: sqlite3_errmsg(db))
            print("[VaultMergeService] Failed to prepare table check for \(tableName): \(errorMsg) (code: \(prepareResult))")
            return records
        }
        defer { sqlite3_finalize(checkStmt) }

        // Use SQLITE_TRANSIENT to ensure SQLite copies the string data
        let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(checkStmt, 1, tableName, -1, sqliteTransient)

        let stepResult = sqlite3_step(checkStmt)
        if stepResult != SQLITE_ROW {
            print("[VaultMergeService] Table '\(tableName)' does not exist (step result: \(stepResult))")
            return records
        }

        // Read all records
        let sql = "SELECT * FROM \(tableName)"
        var stmt: OpaquePointer?
        let selectPrepareResult = sqlite3_prepare_v2(db, sql, -1, &stmt, nil)
        guard selectPrepareResult == SQLITE_OK else {
            let errorMsg = String(cString: sqlite3_errmsg(db))
            print("[VaultMergeService] Failed to prepare SELECT for \(tableName): \(errorMsg) (code: \(selectPrepareResult))")
            throw VaultMergeError.databaseError("Failed to prepare statement for \(tableName): \(errorMsg)")
        }
        defer { sqlite3_finalize(stmt) }

        let columnCount = sqlite3_column_count(stmt)

        while sqlite3_step(stmt) == SQLITE_ROW {
            var record: [String: Any] = [:]
            for iVal in 0..<columnCount {
                let columnName = String(cString: sqlite3_column_name(stmt, iVal))
                switch sqlite3_column_type(stmt, iVal) {
                case SQLITE_INTEGER:
                    record[columnName] = sqlite3_column_int64(stmt, iVal)
                case SQLITE_FLOAT:
                    record[columnName] = sqlite3_column_double(stmt, iVal)
                case SQLITE_TEXT:
                    if let text = sqlite3_column_text(stmt, iVal) {
                        record[columnName] = String(cString: text)
                    }
                case SQLITE_BLOB:
                    if let blob = sqlite3_column_blob(stmt, iVal) {
                        let size = sqlite3_column_bytes(stmt, iVal)
                        record[columnName] = Data(bytes: blob, count: Int(size)).base64EncodedString()
                    }
                case SQLITE_NULL:
                    record[columnName] = NSNull()
                default:
                    break
                }
            }
            records.append(record)
        }

        return records
    }

    private func executeStatement(on db: OpaquePointer, sql: String, params: [Any]) throws {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            let error = String(cString: sqlite3_errmsg(db))
            throw VaultMergeError.databaseError("Failed to prepare statement: \(error)")
        }
        defer { sqlite3_finalize(stmt) }

        // Use SQLITE_TRANSIENT to ensure SQLite copies string data
        let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

        for (index, param) in params.enumerated() {
            let bindIndex = Int32(index + 1)
            switch param {
            case let intValue as Int:
                sqlite3_bind_int64(stmt, bindIndex, Int64(intValue))
            case let int64Value as Int64:
                sqlite3_bind_int64(stmt, bindIndex, int64Value)
            case let doubleValue as Double:
                sqlite3_bind_double(stmt, bindIndex, doubleValue)
            case let stringValue as String:
                sqlite3_bind_text(stmt, bindIndex, stringValue, -1, sqliteTransient)
            case is NSNull:
                sqlite3_bind_null(stmt, bindIndex)
            default:
                sqlite3_bind_text(stmt, bindIndex, "\(param)", -1, sqliteTransient)
            }
        }

        guard sqlite3_step(stmt) == SQLITE_DONE else {
            let error = String(cString: sqlite3_errmsg(db))
            throw VaultMergeError.databaseError("Failed to execute statement: \(error)")
        }
    }

    private func serializeToJson(_ dictionary: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: dictionary, options: [])
        guard let json = String(data: data, encoding: .utf8) else {
            throw VaultMergeError.jsonError("Failed to convert to UTF-8 string")
        }
        return json
    }

    private func parseOutput(_ json: String) throws -> ParsedOutput {
        guard let data = json.data(using: .utf8),
              let rawOutput = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let statementsArray = rawOutput["statements"] as? [[String: Any]] else {
            throw VaultMergeError.jsonError("Failed to parse output JSON")
        }

        let statements = try statementsArray.map { stmt -> (sql: String, params: [Any]) in
            guard let sql = stmt["sql"] as? String,
                  let params = stmt["params"] as? [Any] else {
                throw VaultMergeError.jsonError("Invalid statement format")
            }
            return (sql: sql, params: params)
        }

        return ParsedOutput(statements: statements)
    }

    // MARK: - Debug Helpers

    /// Debug record for FieldValue comparison
    private struct DebugFieldValue {
        let id: String
        let itemId: String
        let value: String
        let updatedAt: String
    }

    /// Query FieldValues for a specific FieldKey
    private func queryFieldValues(from db: OpaquePointer, fieldKey: String) throws -> [DebugFieldValue] {
        var results: [DebugFieldValue] = []

        let sql = "SELECT Id, ItemId, Value, UpdatedAt FROM FieldValues WHERE FieldKey = ? AND IsDeleted = 0 ORDER BY UpdatedAt DESC"
        var stmt: OpaquePointer?

        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            let error = String(cString: sqlite3_errmsg(db))
            print("[VaultMergeService] Failed to prepare debug query: \(error)")
            return results
        }
        defer { sqlite3_finalize(stmt) }

        let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(stmt, 1, fieldKey, -1, sqliteTransient)

        while sqlite3_step(stmt) == SQLITE_ROW {
            let id = sqlite3_column_text(stmt, 0).map { String(cString: $0) } ?? ""
            let itemId = sqlite3_column_text(stmt, 1).map { String(cString: $0) } ?? ""
            let value = sqlite3_column_text(stmt, 2).map { String(cString: $0) } ?? ""
            let updatedAt = sqlite3_column_text(stmt, 3).map { String(cString: $0) } ?? ""
            results.append(DebugFieldValue(id: id, itemId: itemId, value: value, updatedAt: updatedAt))
        }

        return results
    }
}
