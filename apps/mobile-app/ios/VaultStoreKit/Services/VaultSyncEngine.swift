import Foundation
import SQLite3
import RustCoreFramework
import VaultModels
import VaultUtils

/// Drives one operation of the Rust vault sync engine against this vault store.
///
/// The engine owns the sync algorithm and emits commands (HTTP, state, SQLite, vault storage); this class
/// carries each one out and feeds the response back until the engine reports `done`. See the `vault_sync`
/// module in `core/rust` for the command and response contract.
public final class VaultSyncEngine {
    /// Prefix of the UserDefaults keys the engine's persisted state lives under.
    private static let statePrefix = "aliasvault_sync_state:"

    /// Engine state keys mirrored into the native account-key chain, so the native password unlock can unwrap it.
    private static let encryptedAccountKeyStateKey = "encryptedAccountKey"
    private static let encryptedVekStateKey = "encryptedVek"

    /// Engine state key that lives in the native store instead (the login writes it there), routed on read and write.
    private static let derivationParamsStateKey = "encryptionKeyDerivationParams"

    /// Engine state key holding the id of the user's personal manifest, which every new row is stamped with.
    public static let personalManifestIdStateKey = "vaultPersonalManifestId"

    private let vaultStore: VaultStore
    private let webApiService: WebApiService
    private var staging: OpaquePointer?

    public init(vaultStore: VaultStore, webApiService: WebApiService) {
        self.vaultStore = vaultStore
        self.webApiService = webApiService
    }

    deinit {
        closeStaging()
    }

    /// Run one engine operation (`fullSync`, `statusCheck`, `migrationStatus`, `migrateManifest`, `resolveVaultKey`) and
    /// return its result. `encryptionKey` overrides the store's key for the one operation that runs before it is known.
    public func run(operation: String, forcePull: Bool = false, encryptionKey: String? = nil) async throws -> [String: Any] {
        let session = try VaultSyncSession(requestJson: try buildRequest(operation: operation, forcePull: forcePull, encryptionKey: encryptionKey))
        defer { closeStaging() }

        while true {
            let command = try Self.parseJson(try session.nextCommand())
            let kind = command["kind"] as? String ?? ""
            if kind == "done" {
                return command["result"] as? [String: Any] ?? [:]
            }
            let response = await handle(kind: kind, command: command)
            try session.resume(responseJson: try Self.serializeJson(response))
        }
    }

    // MARK: - Request

    private func buildRequest(operation: String, forcePull: Bool, encryptionKey: String?) throws -> String {
        let metadata = vaultStore.getVaultMetadataObject()
        let syncState = vaultStore.getSyncState()
        var request: [String: Any] = [
            "operation": operation,
            "username": vaultStore.getUsername() ?? "",
            "isDirty": syncState.isDirty,
            "mutationSequence": syncState.mutationSequence,
            "dirtyScopes": syncState.isDirty ? ["Main"] : [],
            "privateEmailDomains": metadata?.privateEmailDomains ?? [],
            "forcePull": forcePull,
            "minServerVersion": AppInfo.minServerVersion,
            "isOfflineMode": vaultStore.getOfflineMode(),
            "unnamedSharedVaultName": NSLocalizedString("unnamed_shared_vault", value: "Shared vault", comment: "Name of a shared vault without a name")
        ]
        if let key = encryptionKey ?? (try? vaultStore.getEncryptionKeyBase64()) {
            request["encryptionKey"] = key
        }
        if let publicKey = state(forKey: "accountPublicKey") as? String {
            request["accountPublicKey"] = publicKey
        }
        if let privateKey = vaultStore.accountPrivateKey {
            request["accountPrivateKey"] = privateKey
        }
        return try Self.serializeJson(request)
    }

    // MARK: - Commands

    private func handle(kind: String, command: [String: Any]) async -> [String: Any] {
        do {
            switch kind {
            case "http":
                return await http(command)
            case "stateGet":
                return ["value": state(forKey: command["key"] as? String ?? "") ?? NSNull()]
            case "stateSet":
                setState(command["value"] ?? NSNull(), forKey: command["key"] as? String ?? "")
                return [:]
            case "stateRemove":
                setState(nil, forKey: command["key"] as? String ?? "")
                return [:]
            case "dbOpen":
                try openStaging(bytesBase64: command["bytes"] as? String)
                return [:]
            case "dbQuery":
                let db = try database(named: command["db"] as? String ?? "")
                return ["rows": try Self.query(db, sql: command["sql"] as? String ?? "", params: command["params"] as? [Any] ?? [])]
            case "dbExec":
                let db = try database(named: command["db"] as? String ?? "")
                try Self.exec(db, statements: command["statements"] as? [[String: Any]] ?? [])
                return [:]
            case "dbExport":
                let db = try database(named: command["db"] as? String ?? "")
                return ["bytes": try Self.serialize(db).base64EncodedString()]
            case "vaultStore":
                return try storeVault(command)
            case "vaultLoad":
                return ["encryptedBlob": vaultStore.getEncryptedDatabase() ?? NSNull()]
            case "markClean":
                let cleared = vaultStore.markVaultClean(mutationSeqAtStart: command["mutationSeqAtStart"] as? Int ?? 0, newServerRevision: vaultStore.getCurrentVaultRevisionNumber())
                return ["cleared": cleared]
            case "log":
                print("[VaultSyncEngine] [\(command["level"] as? String ?? "log")] \(command["message"] as? String ?? "")")
                return [:]
            default:
                return ["error": "Unknown engine command \(kind)"]
            }
        } catch let error as AppError {
            return ["error": error.message]
        } catch {
            return ["error": "\(error)"]
        }
    }

    private func http(_ command: [String: Any]) async -> [String: Any] {
        let method = command["method"] as? String ?? "GET"
        let path = command["path"] as? String ?? ""
        let body = command["body"] as? String
        let auth = command["auth"] as? Bool ?? true
        var headers: [String: String] = ["Accept": "application/json"]
        if body != nil {
            headers["Content-Type"] = "application/json"
        }
        do {
            let response = try await webApiService.executeVersionedRequest(method: method, path: path, body: body, headers: headers, requiresAuth: auth)
            return ["status": response.statusCode, "body": response.body]
        } catch {
            let timedOut = (error as? URLError)?.code == .timedOut
            return ["status": 0, "transportError": error.localizedDescription, "timedOut": timedOut]
        }
    }

    // MARK: - State

    private func state(forKey key: String) -> Any? {
        if key == Self.derivationParamsStateKey {
            guard let json = vaultStore.getEncryptionKeyDerivationParams(), let data = json.data(using: .utf8) else { return nil }
            return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        }
        return Self.persistedState(forKey: key, in: vaultStore.userDefaults)
    }

    /// One persisted engine value, decoded from the JSON text it is stored as.
    public static func persistedState(forKey key: String, in userDefaults: UserDefaults) -> Any? {
        guard let json = userDefaults.string(forKey: statePrefix + key), let data = json.data(using: .utf8) else {
            return nil
        }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    private func setState(_ value: Any?, forKey key: String) {
        if key == Self.derivationParamsStateKey {
            if let value = value, !(value is NSNull), let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) {
                try? vaultStore.storeEncryptionKeyDerivationParams(json)
            }
            return
        }
        if let value = value, !(value is NSNull), let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) {
            vaultStore.userDefaults.set(String(data: data, encoding: .utf8), forKey: Self.statePrefix + key)
        } else {
            vaultStore.userDefaults.removeObject(forKey: Self.statePrefix + key)
        }
        if key == Self.encryptedAccountKeyStateKey || key == Self.encryptedVekStateKey {
            mirrorAccountKeyChain()
        }
    }

    /// Forget every persisted engine value: revisions, fingerprints, blob cache and the cached key chain.
    public static func clearPersistedState(in userDefaults: UserDefaults) {
        for key in userDefaults.dictionaryRepresentation().keys where key.hasPrefix(statePrefix) {
            userDefaults.removeObject(forKey: key)
        }
    }

    /// Keep the native account-key chain in step with the engine's cached key blobs.
    private func mirrorAccountKeyChain() {
        guard let encryptedAccountKey = state(forKey: Self.encryptedAccountKeyStateKey) as? String, let encryptedVek = state(forKey: Self.encryptedVekStateKey) as? String else {
            vaultStore.storeAccountKeyChain(nil)
            return
        }
        let chain: [String: String] = ["encryptedAccountKey": encryptedAccountKey, "encryptedVek": encryptedVek]
        vaultStore.storeAccountKeyChain(try? Self.serializeJson(chain))
    }

    // MARK: - Vault storage

    private func storeVault(_ command: [String: Any]) throws -> [String: Any] {
        guard let encryptedBlob = command["encryptedBlob"] as? String else {
            throw AppError.vaultStoreFailed(message: "vaultStore command without a blob")
        }
        if let newKey = command["encryptionKey"] as? String {
            // The blob is encrypted under a key this session did not start with (KEK to VEK migration): adopt it first.
            try vaultStore.adoptEncryptionKey(base64Key: newKey)
        }
        let result = try vaultStore.storeEncryptedVaultWithSyncState(
            encryptedVault: encryptedBlob,
            markDirty: command["markDirty"] as? Bool ?? false,
            serverRevision: command["revision"] as? Int,
            expectedMutationSeq: command["expectedMutationSeq"] as? Int
        )
        if result.success && vaultStore.isVaultUnlocked {
            // The contract: after a store, the live database is the vault just stored.
            try vaultStore.unlockVault()
        }
        return ["success": result.success, "mutationSequence": result.mutationSequence]
    }

    // MARK: - SQLite

    private func database(named name: String) throws -> OpaquePointer {
        switch name {
        case "local":
            guard let connection = vaultStore.dbConnection else {
                throw AppError.unknownError(message: "The vault is not unlocked")
            }
            return connection.handle
        case "staging":
            guard let staging = staging else {
                throw AppError.unknownError(message: "The staging database is not open")
            }
            return staging
        default:
            throw AppError.unknownError(message: "Unknown database \(name)")
        }
    }

    /// Open the staging database: from SQLite bytes, or fresh with the current client schema.
    private func openStaging(bytesBase64: String?) throws {
        closeStaging()
        var db: OpaquePointer?
        guard sqlite3_open(":memory:", &db) == SQLITE_OK, let opened = db else {
            throw AppError.databaseMemoryFailed
        }
        staging = opened

        if let bytesBase64 = bytesBase64, let bytes = Data(base64Encoded: bytesBase64) {
            let count = Int32(bytes.count)
            let result = bytes.withUnsafeBytes { (pointer: UnsafeRawBufferPointer) -> Int32 in
                guard let base = pointer.baseAddress, let buffer = sqlite3_malloc(count) else { return SQLITE_ERROR }
                memcpy(buffer, base, Int(count))
                return sqlite3_deserialize(opened, "main", buffer.assumingMemoryBound(to: UInt8.self), Int64(count), Int64(count), UInt32(SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE))
            }
            guard result == SQLITE_OK else {
                throw AppError.databaseOpenFailed
            }
            try Self.execute(opened, "PRAGMA foreign_keys = OFF")
        } else {
            try Self.execute(opened, VaultSql.completeSchema)
            // The schema script ends by turning foreign keys on; the engine inserts rows in codec order, not FK order.
            try Self.execute(opened, "PRAGMA foreign_keys = OFF")
        }
    }

    private func closeStaging() {
        if let staging = staging {
            sqlite3_close(staging)
        }
        staging = nil
    }

    private static func execute(_ db: OpaquePointer, _ sql: String) throws {
        var errorMessage: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(db, sql, nil, nil, &errorMessage) == SQLITE_OK else {
            let message = errorMessage.map { String(cString: $0) } ?? "unknown error"
            sqlite3_free(errorMessage)
            throw AppError.unknownError(message: "SQL failed: \(message)")
        }
    }

    private static func serialize(_ db: OpaquePointer) throws -> Data {
        var size: sqlite3_int64 = 0
        guard let serialized = sqlite3_serialize(db, "main", &size, 0) else {
            throw AppError.unknownError(message: "Failed to serialize database")
        }
        let data = Data(bytes: serialized, count: Int(size))
        sqlite3_free(serialized)
        return data
    }

    private static let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private static func bind(_ statement: OpaquePointer, params: [Any]) {
        for (index, param) in params.enumerated() {
            let position = Int32(index + 1)
            switch param {
            case is NSNull:
                sqlite3_bind_null(statement, position)
            case let value as Bool:
                sqlite3_bind_int64(statement, position, value ? 1 : 0)
            case let value as Int:
                sqlite3_bind_int64(statement, position, Int64(value))
            case let value as Int64:
                sqlite3_bind_int64(statement, position, value)
            case let value as Double:
                sqlite3_bind_double(statement, position, value)
            case let value as String:
                sqlite3_bind_text(statement, position, value, -1, sqliteTransient)
            case let value as [String: Any]:
                if let base64 = value["__b64"] as? String, let bytes = Data(base64Encoded: base64) {
                    bytes.withUnsafeBytes { pointer in
                        _ = sqlite3_bind_blob(statement, position, pointer.baseAddress, Int32(bytes.count), sqliteTransient)
                    }
                } else {
                    sqlite3_bind_text(statement, position, (try? serializeJson(value)) ?? "{}", -1, sqliteTransient)
                }
            case let value as NSNumber:
                if CFNumberIsFloatType(value) {
                    sqlite3_bind_double(statement, position, value.doubleValue)
                } else {
                    sqlite3_bind_int64(statement, position, value.int64Value)
                }
            default:
                sqlite3_bind_text(statement, position, "\(param)", -1, sqliteTransient)
            }
        }
    }

    private static func query(_ db: OpaquePointer, sql: String, params: [Any]) throws -> [[String: Any]] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let prepared = statement else {
            throw AppError.unknownError(message: "Failed to prepare query: \(String(cString: sqlite3_errmsg(db))) (\(sql))")
        }
        defer { sqlite3_finalize(prepared) }
        bind(prepared, params: params)

        let columnCount = sqlite3_column_count(prepared)
        let columns = (0..<columnCount).map { String(cString: sqlite3_column_name(prepared, $0)) }
        var rows: [[String: Any]] = []
        while true {
            let step = sqlite3_step(prepared)
            if step == SQLITE_DONE {
                break
            }
            guard step == SQLITE_ROW else {
                throw AppError.unknownError(message: "Query failed: \(String(cString: sqlite3_errmsg(db))) (\(sql))")
            }
            var row: [String: Any] = [:]
            for index in 0..<columnCount {
                switch sqlite3_column_type(prepared, index) {
                case SQLITE_INTEGER:
                    row[columns[Int(index)]] = sqlite3_column_int64(prepared, index)
                case SQLITE_FLOAT:
                    row[columns[Int(index)]] = sqlite3_column_double(prepared, index)
                case SQLITE_TEXT:
                    row[columns[Int(index)]] = sqlite3_column_text(prepared, index).map { String(cString: $0) } ?? ""
                case SQLITE_BLOB:
                    let size = Int(sqlite3_column_bytes(prepared, index))
                    let bytes = sqlite3_column_blob(prepared, index).map { Data(bytes: $0, count: size) } ?? Data()
                    row[columns[Int(index)]] = ["__b64": bytes.base64EncodedString()]
                default:
                    row[columns[Int(index)]] = NSNull()
                }
            }
            rows.append(row)
        }
        return rows
    }

    private static func exec(_ db: OpaquePointer, statements: [[String: Any]]) throws {
        try execute(db, "BEGIN")
        do {
            for entry in statements {
                let sql = entry["sql"] as? String ?? ""
                var statement: OpaquePointer?
                guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let prepared = statement else {
                    throw AppError.unknownError(message: "Failed to prepare statement: \(String(cString: sqlite3_errmsg(db))) (\(sql))")
                }
                defer { sqlite3_finalize(prepared) }
                bind(prepared, params: entry["params"] as? [Any] ?? [])
                guard sqlite3_step(prepared) == SQLITE_DONE else {
                    throw AppError.unknownError(message: "Statement failed: \(String(cString: sqlite3_errmsg(db))) (\(sql))")
                }
            }
            try execute(db, "COMMIT")
        } catch {
            try? execute(db, "ROLLBACK")
            throw error
        }
    }

    // MARK: - JSON

    private static func parseJson(_ json: String) throws -> [String: Any] {
        guard let data = json.data(using: .utf8), let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AppError.parseError(message: "Engine command is not a JSON object")
        }
        return object
    }

    private static func serializeJson(_ object: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed])
        guard let json = String(data: data, encoding: .utf8) else {
            throw AppError.parseError(message: "Failed to encode JSON")
        }
        return json
    }
}
