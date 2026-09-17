import Foundation
import VaultModels
import VaultUtils

/// The sync operations of the store, forwarded to VaultSync (the wrapper around the Rust sync engine).
extension VaultStore {
    /// Full vault sync: status check, then pull (and merge) or push as the server and local revisions decide.
    public func syncVaultWithServer(using webApiService: WebApiService) async -> VaultSyncResult {
        return await sync.syncVaultWithServer(using: webApiService)
    }

    /// One status call: whether the server holds newer state than this device.
    public func checkVaultVersion(using webApiService: WebApiService) async throws -> VaultVersionCheckResult {
        return try await sync.checkVaultVersion(using: webApiService)
    }

    /// Resolve and store the vault key right after login from the password-derived key (see VaultSync.resolveVaultKey).
    public func resolveVaultKey(using webApiService: WebApiService, derivedKeyBase64: String) async throws -> String {
        return try await sync.resolveVaultKey(using: webApiService, derivedKeyBase64: derivedKeyBase64)
    }

    /// Classify the pending manifest migration (see VaultSync.getVaultMigrationStatus).
    public func getVaultMigrationStatus(using webApiService: WebApiService) async throws -> String {
        return try await sync.getVaultMigrationStatus(using: webApiService)
    }

    /// Run the pending manifest migration and push it (see VaultSync.migrateVaultManifest).
    public func migrateVaultManifest(using webApiService: WebApiService) async -> VaultMigrationResult {
        return await sync.migrateVaultManifest(using: webApiService)
    }

    /// Push the pending local changes (after a native mutation such as an autofill link or a passkey creation).
    public func mutateVault(using webApiService: WebApiService) async throws {
        try await sync.mutateVault(using: webApiService)
    }

    /// The logs of the recent sync engine runs as JSON text, newest first, for the developer tools.
    public func getVaultSyncLogs() -> String {
        return VaultSyncRunLog.persistedLogs(in: userDefaults)
    }
}
