import Foundation
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
    private static let encryptedAccountPrivateKeyStateKey = "encryptedAccountPrivateKey"

    /// Engine state key that lives in the native store instead (the login writes it there), routed on read and write.
    private static let derivationParamsStateKey = "encryptionKeyDerivationParams"

    /// Engine state key holding the id of the user's personal manifest, which every new row is stamped with.
    public static let personalManifestIdStateKey = "vaultPersonalManifestId"

    private let vaultStore: VaultStore
    private let webApiService: WebApiService
    /// The engine's staging database, held in the Rust core's memory.
    private var staging: SqliteMemoryDatabase?
    private var runLog = VaultSyncRunLog(operation: "")

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
        let log = VaultSyncRunLog(operation: operation)
        runLog = log
        var finalResult: [String: Any]?
        let session = try VaultSyncSession(requestJson: try buildRequest(operation: operation, forcePull: forcePull, encryptionKey: encryptionKey))
        defer {
            closeStaging()
            log.finish(result: finalResult, userDefaults: vaultStore.userDefaults)
        }

        while true {
            let commandJson = try log.engine { try session.nextCommand() }
            let command = try log.json { try Self.parseJson(commandJson) }
            let kind = command["kind"] as? String ?? ""
            if kind == "done" {
                let result = command["result"] as? [String: Any] ?? [:]
                finalResult = result
                return result
            }
            let commandStartedAt = Date()
            let response = await handle(kind: kind, command: command)
            log.recordCommand(kind, command: command, response: response, since: commandStartedAt)
            let responseJson = try log.json { try Self.serializeJson(response) }
            try log.engine { try session.resume(responseJson: responseJson) }
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
                let rowsJson = try db.query(sql: command["sql"] as? String ?? "", paramsJson: try Self.serializeJson(command["params"] ?? []))
                return ["rows": try Self.parseJsonArray(rowsJson)]
            case "dbExec":
                let db = try database(named: command["db"] as? String ?? "")
                try db.exec(statementsJson: try Self.serializeJson(command["statements"] ?? []))
                return [:]
            case "dbExport":
                let bytes: Data
                switch command["db"] as? String ?? "" {
                case "local":
                    bytes = try vaultStore.exportDatabase()
                case "staging":
                    bytes = try database(named: "staging").export()
                case let name:
                    throw AppError.unknownError(message: "Unknown database \(name)")
                }
                return ["bytes": bytes.base64EncodedString()]
            case "vaultStore":
                return try storeVault(command)
            case "vaultLoad":
                return ["encryptedBlob": vaultStore.getEncryptedDatabase() ?? NSNull()]
            case "markClean":
                let cleared = vaultStore.markVaultClean(mutationSeqAtStart: command["mutationSeqAtStart"] as? Int ?? 0, newServerRevision: vaultStore.getCurrentVaultRevisionNumber())
                return ["cleared": cleared]
            case "log":
                runLog.engineLine(level: command["level"] as? String ?? "log", message: command["message"] as? String ?? "")
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
            let response = try await webApiService.executeRequest(method: method, endpoint: path, body: body, headers: headers, requiresAuth: auth)
            return ["status": response.statusCode, "body": response.body]
        } catch {
            let timedOut = (error as? URLError)?.code == .timedOut
            return ["status": 0, "transportError": error.localizedDescription, "timedOut": timedOut]
        }
    }

    // MARK: - State

    private func state(forKey key: String) -> Any? {
        if key == Self.derivationParamsStateKey {
            guard let json = vaultStore.getUnlockKeyDerivationParams(), let data = json.data(using: .utf8) else { return nil }
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
                try? vaultStore.storeUnlockKeyDerivationParams(json)
            }
            return
        }
        if let value = value, !(value is NSNull), let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) {
            vaultStore.userDefaults.set(String(data: data, encoding: .utf8), forKey: Self.statePrefix + key)
        } else {
            vaultStore.userDefaults.removeObject(forKey: Self.statePrefix + key)
        }
        if [Self.encryptedAccountKeyStateKey, Self.encryptedVekStateKey, Self.encryptedAccountPrivateKeyStateKey].contains(key) {
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
        var chain: [String: String] = ["encryptedAccountKey": encryptedAccountKey, "encryptedVek": encryptedVek]
        if let encryptedAccountPrivateKey = state(forKey: Self.encryptedAccountPrivateKeyStateKey) as? String {
            chain["encryptedAccountPrivateKey"] = encryptedAccountPrivateKey
        }
        vaultStore.storeAccountKeyChain(try? Self.serializeJson(chain))
    }

    // MARK: - Vault storage

    private func storeVault(_ command: [String: Any]) throws -> [String: Any] {
        guard let encryptedBlob = command["encryptedBlob"] as? String else {
            throw AppError.vaultStoreFailed(message: "vaultStore command without a blob")
        }
        let result = try vaultStore.storeEncryptedVaultWithSyncState(
            encryptedVault: encryptedBlob,
            markDirty: command["markDirty"] as? Bool ?? false,
            serverRevision: command["revision"] as? Int,
            expectedMutationSeq: command["expectedMutationSeq"] as? Int
        )
        if result.success && vaultStore.isVaultUnlocked {
            // The contract: after a store, the live database is the vault just stored.
            let reloadStartedAt = Date()
            try vaultStore.unlockVault()
            runLog.note("Live vault reloaded (decrypt and open) in \(VaultSyncRunLog.elapsedMs(since: reloadStartedAt))ms")
        }
        return ["success": result.success, "mutationSequence": result.mutationSequence]
    }

    // MARK: - SQLite

    private func database(named name: String) throws -> SqliteMemoryDatabase {
        switch name {
        case "local":
            guard let connection = vaultStore.dbConnection else {
                throw AppError.unknownError(message: "The vault is not unlocked")
            }
            return connection
        case "staging":
            guard let staging = staging else {
                throw AppError.unknownError(message: "The staging database is not open")
            }
            return staging
        default:
            throw AppError.unknownError(message: "Unknown database \(name)")
        }
    }

    /// Open the staging database in memory: from SQLite bytes, or fresh with the current client schema.
    private func openStaging(bytesBase64: String?) throws {
        closeStaging()
        let opened: SqliteMemoryDatabase
        if let bytesBase64 = bytesBase64, let bytes = Data(base64Encoded: bytesBase64) {
            opened = try SqliteMemoryDatabase.fromBytes(bytes: bytes)
        } else {
            opened = try SqliteMemoryDatabase.withSchema(schemaSql: VaultSql.completeSchema)
        }
        // The schema script ends by turning foreign keys on; the engine inserts rows in codec order, not FK order.
        try opened.executeBatch(sql: "PRAGMA foreign_keys = OFF")
        staging = opened
    }

    private func closeStaging() {
        staging = nil
    }

    // MARK: - JSON

    private static func parseJson(_ json: String) throws -> [String: Any] {
        guard let data = json.data(using: .utf8), let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AppError.parseError(message: "Engine command is not a JSON object")
        }
        return object
    }

    private static func parseJsonArray(_ json: String) throws -> [Any] {
        guard let data = json.data(using: .utf8), let array = try JSONSerialization.jsonObject(with: data) as? [Any] else {
            throw AppError.parseError(message: "Engine rows are not a JSON array")
        }
        return array
    }

    private static func serializeJson(_ object: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed])
        guard let json = String(data: data, encoding: .utf8) else {
            throw AppError.parseError(message: "Failed to encode JSON")
        }
        return json
    }
}
