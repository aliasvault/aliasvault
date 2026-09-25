import Foundation

/// The vault's local sync bookkeeping.
public struct SyncStateResult {
    public let isDirty: Bool
    public let dirtyScopes: [String]
    public let mutationSequence: Int
    public let serverRevision: Int
    public let isSyncing: Bool

    public init(isDirty: Bool, dirtyScopes: [String] = [], mutationSequence: Int, serverRevision: Int, isSyncing: Bool) {
        self.isDirty = isDirty
        self.dirtyScopes = dirtyScopes
        self.mutationSequence = mutationSequence
        self.serverRevision = serverRevision
        self.isSyncing = isSyncing
    }
}

/// Outcome of a status check: whether the server holds newer state than this device.
public struct VaultVersionCheckResult {
    public let isNewVersionAvailable: Bool
    public let syncState: SyncStateResult
}

/// What a sync did.
public enum SyncAction: String {
    case uploaded = "uploaded"
    case downloaded = "downloaded"
    case merged = "merged"
    case alreadyInSync = "already_in_sync"
    case error = "error"
}

/// Result of a full vault sync, the shape the React Native app and the autofill extension act on.
public struct VaultSyncResult {
    public let success: Bool
    public let action: SyncAction
    public let newRevision: Int
    public let wasOffline: Bool
    public let error: String?
    public let errorMessage: String?
    public let sqliteBlobUpgradeRequired: Bool
    public let manifestMigrationRequired: Bool

    public init(
        success: Bool,
        action: SyncAction,
        newRevision: Int,
        wasOffline: Bool,
        error: String? = nil,
        errorMessage: String? = nil,
        sqliteBlobUpgradeRequired: Bool = false,
        manifestMigrationRequired: Bool = false
    ) {
        self.success = success
        self.action = action
        self.newRevision = newRevision
        self.wasOffline = wasOffline
        self.error = error
        self.errorMessage = errorMessage
        self.sqliteBlobUpgradeRequired = sqliteBlobUpgradeRequired
        self.manifestMigrationRequired = manifestMigrationRequired
    }
}

/// Result of the manifest migration the app's upgrade page drives.
public struct VaultMigrationResult {
    public let success: Bool
    public let pushed: Bool
    public let error: String?
    public let errorMessage: String?

    public init(success: Bool, pushed: Bool, error: String? = nil, errorMessage: String? = nil) {
        self.success = success
        self.pushed = pushed
        self.error = error
        self.errorMessage = errorMessage
    }
}

/// Result of a sharing operation of the sync engine (creating a shared manifest, inviting a member to one).
public struct VaultSharingResult {
    public let success: Bool
    public let apiErrorCode: String?
    public let vaultUpgradeRequired: Bool
    public let error: String?
    public let errorMessage: String?

    public init(success: Bool, apiErrorCode: String? = nil, vaultUpgradeRequired: Bool = false, error: String? = nil, errorMessage: String? = nil) {
        self.success = success
        self.apiErrorCode = apiErrorCode
        self.vaultUpgradeRequired = vaultUpgradeRequired
        self.error = error
        self.errorMessage = errorMessage
    }
}
