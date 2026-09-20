import Foundation
import VaultModels
import VaultUtils

/// The vault sync wrapper: one method per engine operation, adoption of what the engine reported, and the mapping of
/// its failures into the native error. The driver below it is VaultSyncEngine, which turns the Rust engine's
/// commands into host actions.
///
/// When updating this logic, make sure to update the same logic on the other platforms:
/// - core/client/src/sync/VaultSync.ts (shared core client for web apps)
/// - apps/mobile-app/ios/VaultStoreKit/Services/VaultSync.swift (this file)
/// - apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/VaultSync.kt
internal final class VaultSync {
    private let vaultStore: VaultStore

    init(vaultStore: VaultStore) {
        self.vaultStore = vaultStore
    }

    /// Full vault sync: status check, then pull (and merge) or push as the server and local revisions decide. Never throws.
    func syncVaultWithServer(using webApiService: WebApiService) async -> VaultSyncResult {
        let startedAt = Date()
        vaultStore.setIsSyncing(true)
        defer {
            vaultStore.setIsSyncing(false)
            print("[VaultSync] Sync finished in \(VaultSyncRunLog.elapsedMs(since: startedAt))ms")
        }

        let wasDirty = vaultStore.getIsDirty()
        let result: [String: Any]
        do {
            result = try await run("fullSync", using: webApiService)
        } catch {
            return failedSync(Self.driverError(error), wasOffline: vaultStore.getOfflineMode())
        }

        let wasOffline = result["wasOffline"] as? Bool ?? false
        guard result["success"] as? Bool == true else {
            return failedSync(Self.syncError(from: result), wasOffline: wasOffline)
        }
        if wasOffline {
            let offlineCode = AppError.networkError(underlyingError: NSError(domain: "VaultSync", code: 0)).code
            return VaultSyncResult(success: false, action: .error, newRevision: vaultStore.getCurrentVaultRevisionNumber(), wasOffline: true, error: offlineCode)
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
            newRevision: vaultStore.getCurrentVaultRevisionNumber(),
            wasOffline: false,
            sqliteBlobUpgradeRequired: result["sqliteBlobUpgradeRequired"] as? Bool ?? false,
            manifestMigrationRequired: result["manifestMigrationRequired"] as? Bool ?? false
        )
    }

    /// One status call: whether the server holds newer state than this device.
    func checkVaultVersion(using webApiService: WebApiService) async throws -> VaultVersionCheckResult {
        let result = try await run("statusCheck", using: webApiService)
        if result["isOffline"] as? Bool == true {
            vaultStore.setOfflineMode(true)
            throw AppError.serverUnavailable(statusCode: 0)
        }
        if result["requiresLogout"] as? Bool == true || result["success"] as? Bool != true {
            throw Self.syncError(from: result)
        }
        vaultStore.setOfflineMode(false)
        return VaultVersionCheckResult(isNewVersionAvailable: result["hasNewerVault"] as? Bool ?? false, syncState: vaultStore.getSyncState())
    }

    /// Resolve the vault key right after login: the account's key chain is opened with the password-derived key (KEK)
    /// and cached as-is. The session then opens from that chain like every later unlock, and the keychain keeps the
    /// KEK; a legacy account has no chain and its KEK is the vault key. Returns the vault key (base64).
    func resolveVaultKey(using webApiService: WebApiService, derivedKeyBase64: String) async throws -> String {
        let result = try await run("resolveVaultKey", using: webApiService, encryptionKey: derivedKeyBase64)
        guard result["success"] as? Bool == true else {
            throw Self.syncError(from: result)
        }
        try vaultStore.storeUnlockKey(base64Key: derivedKeyBase64)
        return try vaultStore.getEncryptionKeyBase64()
    }

    /// Classify the pending manifest migration as the engine sees it: `none`, `schema-rebuild` (runs unattended) or
    /// `storage-format-upgrade` (the app asks first). A vault still on the sqlite-blob chain classifies as `none`.
    func getVaultMigrationStatus(using webApiService: WebApiService) async throws -> String {
        let status = try await run("migrationStatus", using: webApiService)
        return status["kind"] as? String ?? "storage-format-upgrade"
    }

    /// Bring the local vault onto the current storage model (a schema rebuild after an app update, or the one-time
    /// account-key upgrade of a legacy vault) and push it. Driven by the app's upgrade page only: a sync never runs
    /// it on its own, because the storage format move signs out every other client that predates the format. Never throws.
    func migrateVaultManifest(using webApiService: WebApiService) async -> VaultMigrationResult {
        let result: [String: Any]
        do {
            result = try await run("migrateManifest", using: webApiService)
        } catch {
            return failedMigration(Self.driverError(error))
        }
        guard result["success"] as? Bool == true else {
            return failedMigration(Self.syncError(from: result))
        }
        let pushed = result["pushed"] as? Bool ?? false
        print("[VaultSync] Manifest migration complete: pushed=\(pushed)")
        return VaultMigrationResult(success: true, pushed: pushed)
    }

    /// Run a sharing operation of the engine.
    func runSharingOperation(_ operation: String, params: [String: Any], using webApiService: WebApiService) async -> VaultSharingResult {
        guard Self.sharingOperations.contains(operation) else {
            return failedSharing(.syncEngineFailed(message: "Unknown sharing operation \(operation)"))
        }
        let result: [String: Any]
        do {
            result = try await run(operation, using: webApiService, sharing: params)
        } catch {
            return failedSharing(Self.driverError(error))
        }
        if result["success"] as? Bool == true {
            return VaultSharingResult(success: true)
        }
        let apiErrorCode = result["apiErrorCode"] as? String
        let vaultUpgradeRequired = result["vaultUpgradeRequired"] as? Bool ?? false
        if apiErrorCode != nil || vaultUpgradeRequired {
            return VaultSharingResult(success: false, apiErrorCode: apiErrorCode, vaultUpgradeRequired: vaultUpgradeRequired)
        }
        return failedSharing(Self.syncError(from: result))
    }

    /// Push the pending local changes (after a native mutation such as an autofill link or a passkey creation).
    func mutateVault(using webApiService: WebApiService) async throws {
        let result = await syncVaultWithServer(using: webApiService)
        if !result.success && !result.wasOffline {
            throw AppError.vaultUploadFailed(message: result.errorMessage ?? result.error ?? "Vault sync failed")
        }
    }

    /// Run one engine operation and adopt what it reported. A driver failure surfaces as the native error.
    private func run(_ operation: String, using webApiService: WebApiService, encryptionKey: String? = nil, sharing: [String: Any]? = nil) async throws -> [String: Any] {
        let result: [String: Any]
        do {
            result = try await VaultSyncEngine(vaultStore: vaultStore, webApiService: webApiService).run(operation: operation, encryptionKey: encryptionKey, sharing: sharing)
        } catch {
            throw Self.driverError(error)
        }
        adoptSyncResult(result)
        return result
    }

    /// Persist what the engine reported: server version and capabilities, offline mode, session values it changed,
    /// and the email routing a pulled vault came with.
    private func adoptSyncResult(_ result: [String: Any]) {
        if let serverVersion = result["serverVersion"] as? String, !serverVersion.isEmpty {
            vaultStore.setServerVersion(serverVersion)
        }
        if let capabilities = result["capabilities"] as? [String: String], let data = try? JSONSerialization.data(withJSONObject: capabilities), let json = String(data: data, encoding: .utf8) {
            vaultStore.setCapabilities(json)
        }
        if let offline = result["isOfflineMode"] as? Bool {
            vaultStore.setOfflineMode(offline)
        }
        if let routing = result["emailRouting"] as? [String: Any] {
            let metadata = VaultMetadata(
                publicEmailDomains: routing["publicEmailDomainList"] as? [String] ?? [],
                privateEmailDomains: routing["privateEmailDomainList"] as? [String] ?? [],
                hiddenPrivateEmailDomains: routing["hiddenPrivateEmailDomainList"] as? [String] ?? [],
                vaultRevisionNumber: result["pulledRevision"] as? Int ?? vaultStore.getCurrentVaultRevisionNumber()
            )
            if let data = try? JSONEncoder().encode(metadata), let json = String(data: data, encoding: .utf8) {
                try? vaultStore.storeMetadata(json)
            }
        }
    }

    /// A failed sync return.
    private func failedSync(_ error: AppError, wasOffline: Bool) -> VaultSyncResult {
        print("[VaultSync] Sync failed (\(error.code)): \(error.message)")
        return VaultSyncResult(success: false, action: .error, newRevision: vaultStore.getCurrentVaultRevisionNumber(), wasOffline: wasOffline, error: error.code, errorMessage: error.message)
    }

    /// A failed migration return.
    private func failedMigration(_ error: AppError) -> VaultMigrationResult {
        print("[VaultSync] Manifest migration failed (\(error.code)): \(error.message)")
        return VaultMigrationResult(success: false, pushed: false, error: error.code, errorMessage: error.message)
    }

    /// A failed sharing operation return.
    private func failedSharing(_ error: AppError) -> VaultSharingResult {
        print("[VaultSync] Sharing operation failed (\(error.code)): \(error.message)")
        return VaultSharingResult(success: false, error: error.code, errorMessage: error.message)
    }

    /// An error the driver itself threw (a request it could not build, a command it could not decode).
    private static func driverError(_ error: Error) -> AppError {
        if let appError = error as? AppError {
            return appError
        }
        return .syncEngineFailed(message: "\(error)")
    }

    /// The engine's failure as the native error: a forced logout by its reason, else by its error code.
    private static func syncError(from result: [String: Any]) -> AppError {
        if let reason = result["errorKey"] as? String, let error = logoutErrors[reason] {
            return error
        }
        // The engine's message is diagnostic detail; the code decides what the user sees.
        let message = result["error"] as? String ?? "Vault sync failed"
        let code = result["errorCode"] as? String ?? ""
        return (codedErrors[code] ?? { .unknownError(message: $0) })(message)
    }

    /// The engine operations the sharing screen may ask for.
    private static let sharingOperations: Set<String> = ["createSharedManifest", "inviteToSharedManifest", "updateSharedManifest"]

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
        "E-805": { _ in .vaultSyncTimeout },
        "E-901": { .migrationCheckFailed(message: $0) },
        "E-903": { _ in .serverUpdateRequired }
    ]
}
