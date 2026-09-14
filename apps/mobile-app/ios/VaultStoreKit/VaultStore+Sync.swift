import Foundation
import VaultModels
import VaultUtils

/// Vault sync through the Rust sync engine. Every decision (pull, merge, push, migrations) is mae by the shared Rust engine.
extension VaultStore {
    /// Full vault sync: status check, then pull (and merge) or push as the server and local revisions decide.
    public func syncVaultWithServer(using webApiService: WebApiService) async -> VaultSyncResult {
        let startedAt = Date()
        setIsSyncing(true)
        defer {
            setIsSyncing(false)
            print("[VaultSync] Sync finished in \(VaultSyncRunLog.elapsedMs(since: startedAt))ms")
        }

        let wasDirty = getIsDirty()
        let result: [String: Any]
        do {
            result = try await VaultSyncEngine(vaultStore: self, webApiService: webApiService).run(operation: "fullSync")
        } catch {
            return failedSync(Self.driverError(error), wasOffline: getOfflineMode())
        }

        adoptSyncSideEffects(result)

        let wasOffline = result["wasOffline"] as? Bool ?? false
        guard result["success"] as? Bool == true else {
            return failedSync(Self.syncError(from: result), wasOffline: wasOffline)
        }

        if wasOffline {
            return VaultSyncResult(success: false, action: .error, newRevision: getCurrentVaultRevisionNumber(), wasOffline: true, error: AppError.networkError(underlyingError: NSError(domain: "VaultSync", code: 0)).code)
        }

        /*
         * A vault that still has to be upgraded is reported, never migrated here: the app routes it to the upgrade
         * page, which asks first when the migration signs out every other pre-format client (see migrateVaultManifest).
         */
        let hasNewVault = result["hasNewVault"] as? Bool ?? false
        let action: SyncAction = hasNewVault ? (wasDirty ? .merged : .downloaded) : (wasDirty ? .uploaded : .alreadyInSync)
        return VaultSyncResult(
            success: true,
            action: action,
            newRevision: getCurrentVaultRevisionNumber(),
            wasOffline: false,
            sqliteBlobUpgradeRequired: result["sqliteBlobUpgradeRequired"] as? Bool ?? false,
            manifestMigrationRequired: result["manifestMigrationRequired"] as? Bool ?? false
        )
    }

    /// Resolve the vault key right after login.
    public func resolveVaultKey(using webApiService: WebApiService, derivedKeyBase64: String) async throws -> String {
        let result: [String: Any]
        do {
            result = try await VaultSyncEngine(vaultStore: self, webApiService: webApiService).run(operation: "resolveVaultKey", encryptionKey: derivedKeyBase64)
        } catch {
            throw Self.driverError(error)
        }
        guard result["success"] as? Bool == true else {
            throw Self.syncError(from: result)
        }
        let key = result["encryptionKey"] as? String ?? derivedKeyBase64
        try storeEncryptionKey(base64Key: key)
        if let updates = result["sessionUpdates"] as? [String: Any], let privateKey = updates["accountPrivateKey"] as? String {
            accountPrivateKey = privateKey
        }
        return key
    }

    /// Adopt the session key the engine reports.
    public func adoptEncryptionKey(base64Key: String) throws {
        if let current = encryptionKey, current == Data(base64Encoded: base64Key) {
            return
        }
        try storeEncryptionKey(base64Key: base64Key)
    }

    /// Report a failed sync.
    private func failedSync(_ error: AppError, wasOffline: Bool) -> VaultSyncResult {
        print("[VaultSync] Sync failed (\(error.code)): \(error.message)")
        return VaultSyncResult(success: false, action: .error, newRevision: getCurrentVaultRevisionNumber(), wasOffline: wasOffline, error: error.code, errorMessage: error.message)
    }

    /// Report an error thrown by the Rust core.
    private static func driverError(_ error: Error) -> AppError {
        if let appError = error as? AppError {
            return appError
        }
        return .syncEngineFailed(message: "\(error)")
    }

    /// Push the pending local changes (after a native mutation such as an autofill link or a passkey creation).
    public func mutateVault(using webApiService: WebApiService) async throws {
        let result = await syncVaultWithServer(using: webApiService)
        if !result.success && !result.wasOffline {
            throw AppError.vaultUploadFailed(message: result.errorMessage ?? result.error ?? "Vault sync failed")
        }
    }

    /// Check the server's vault revision number via a status check.
    public func checkVaultVersion(using webApiService: WebApiService) async throws -> VaultVersionCheckResult {
        let result: [String: Any]
        do {
            result = try await VaultSyncEngine(vaultStore: self, webApiService: webApiService).run(operation: "statusCheck")
        } catch {
            throw Self.driverError(error)
        }

        if let serverVersion = result["serverVersion"] as? String, !serverVersion.isEmpty {
            setServerVersion(serverVersion)
        }
        if result["isOffline"] as? Bool == true {
            setOfflineMode(true)
            throw AppError.serverUnavailable(statusCode: 0)
        }
        if result["requiresLogout"] as? Bool == true || result["success"] as? Bool != true {
            throw Self.syncError(from: result)
        }
        setOfflineMode(false)
        return VaultVersionCheckResult(isNewVersionAvailable: result["hasNewerVault"] as? Bool ?? false, syncState: getSyncState())
    }

    /// The logs of the recent sync engine runs as JSON text, newest first, for the developer tools.
    public func getVaultSyncLogs() -> String {
        return VaultSyncRunLog.persistedLogs(in: userDefaults)
    }

    /// Persist sync results.
    private func adoptSyncSideEffects(_ result: [String: Any]) {
        if let serverVersion = result["serverVersion"] as? String, !serverVersion.isEmpty {
            setServerVersion(serverVersion)
        }
        if let offline = result["isOfflineMode"] as? Bool {
            setOfflineMode(offline)
        }
        if let updates = result["sessionUpdates"] as? [String: Any] {
            if let newKey = updates["encryptionKey"] as? String {
                try? adoptEncryptionKey(base64Key: newKey)
            }
            if let privateKey = updates["accountPrivateKey"] as? String {
                accountPrivateKey = privateKey
            }
        }
        if let routing = result["emailRouting"] as? [String: Any] {
            let metadata = VaultMetadata(
                publicEmailDomains: routing["publicEmailDomainList"] as? [String] ?? [],
                privateEmailDomains: routing["privateEmailDomainList"] as? [String] ?? [],
                hiddenPrivateEmailDomains: routing["hiddenPrivateEmailDomainList"] as? [String] ?? [],
                vaultRevisionNumber: result["pulledRevision"] as? Int ?? getCurrentVaultRevisionNumber()
            )
            if let data = try? JSONEncoder().encode(metadata), let json = String(data: data, encoding: .utf8) {
                try? storeMetadata(json)
            }
        }
    }

    /// Classify the pending manifest migration as the engine sees it: `none`, `schema-rebuild` (runs unattended) or
    /// `storage-format-upgrade` (the app asks first). A vault still on the sqlite-blob chain classifies as `none`.
    public func getVaultMigrationStatus(using webApiService: WebApiService) async throws -> String {
        let status: [String: Any]
        do {
            status = try await VaultSyncEngine(vaultStore: self, webApiService: webApiService).run(operation: "migrationStatus")
        } catch {
            throw Self.driverError(error)
        }
        return status["kind"] as? String ?? "storage-format-upgrade"
    }

    /// Bring the local vault onto the current storage model (a schema rebuild after an app update, or the one-time
    /// account-key upgrade of a legacy vault) and push it. Driven by the app's upgrade page only: a sync never runs
    /// it on its own, because the storage format move signs out every other client that predates the format.
    public func migrateVaultManifest(using webApiService: WebApiService) async -> VaultMigrationResult {
        let result: [String: Any]
        do {
            result = try await VaultSyncEngine(vaultStore: self, webApiService: webApiService).run(operation: "migrateManifest")
        } catch {
            return failedMigration(Self.driverError(error))
        }
        adoptSyncSideEffects(result)
        guard result["success"] as? Bool == true else {
            return failedMigration(Self.syncError(from: result))
        }
        let pushed = result["pushed"] as? Bool ?? false
        print("[VaultSync] Manifest migration complete: pushed=\(pushed)")
        return VaultMigrationResult(success: true, pushed: pushed)
    }

    /// A failed migration as the app reads it: the native error code plus the technical detail, logged once here.
    private func failedMigration(_ error: AppError) -> VaultMigrationResult {
        print("[VaultSync] Manifest migration failed (\(error.code)): \(error.message)")
        return VaultMigrationResult(success: false, pushed: false, error: error.code, errorMessage: error.message)
    }

    /// Report sync engine failure.
    private static func syncError(from result: [String: Any]) -> AppError {
        if let reason = result["errorKey"] as? String, let error = logoutErrors[reason] {
            return error
        }
        let message = result["error"] as? String ?? "Vault sync failed"
        let code = result["errorCode"] as? String ?? ""
        return (codedErrors[code] ?? { .unknownError(message: $0) })(message)
    }

    /// The forced logouts by the engine's reason.
    private static let logoutErrors: [String: AppError] = [
        "clientVersionNotSupported": .clientVersionNotSupported,
        "serverVersionNotSupported": .serverVersionNotSupported,
        "sessionExpired": .sessionExpired,
        "passwordChanged": .passwordChanged,
        "vaultVersionIncompatible": .vaultVersionIncompatible
    ]

    /// The native error for each engine error code, given the engine's message.
    private static let codedErrors: [String: (String) -> AppError] = [
        "E-202": { _ in .encryptionKeyNotFound },
        "E-203": { _ in .vaultDecryptFailed },
        "E-502": { .syncVaultFetchFailed(message: $0) },
        "E-503": { _ in .vaultDecryptFailed },
        "E-505": { _ in .serverUnavailable(statusCode: 0) },
        "E-506": { .serverError(message: $0) },
        "E-507": { .syncResponseInvalid(message: $0) },
        "E-508": { .syncCodecFailed(message: $0) },
        "E-509": { .syncEngineFailed(message: $0) },
        "E-601": { .storageReadFailed(message: $0) },
        "E-602": { .storageWriteFailed(message: $0) },
        "E-603": { .databaseInitFailed(message: $0) },
        "E-701": { .vaultMergeFailed(message: $0) },
        "E-702": { _ in .maxRetriesReached },
        "E-801": { .vaultUploadFailed(message: $0) },
        "E-804": { _ in .vaultTooLarge },
        "E-805": { _ in .timeout },
        "E-901": { .migrationCheckFailed(message: $0) },
        "E-903": { _ in .serverVersionNotSupported }
    ]
}
