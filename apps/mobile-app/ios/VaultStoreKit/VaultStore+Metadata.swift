import Foundation
import VaultModels

/// Extension for the VaultStore class to handle metadata management
extension VaultStore {
    /// Store the metadata - the metadata for the vault
    public func storeMetadata(_ metadata: String) throws {
        userDefaults.set(metadata, forKey: VaultConstants.vaultMetadataKey)
        userDefaults.synchronize()
    }

    /// Get the metadata - the metadata for the vault
    public func getVaultMetadata() -> String? {
        return userDefaults.string(forKey: VaultConstants.vaultMetadataKey)
    }

    /// Get the metadata object - the metadata for the vault
    internal func getVaultMetadataObject() -> VaultMetadata? {
        guard let jsonString = getVaultMetadata(),
              let data = jsonString.data(using: .utf8),
              let metadata = try? JSONDecoder().decode(VaultMetadata.self, from: data) else {
            return nil
        }
        return metadata
    }

    /// Get the current vault revision number - the revision number of the vault
    public func getCurrentVaultRevisionNumber() -> Int {
        guard let metadata = getVaultMetadataObject() else {
            return 0
        }
        return metadata.vaultRevisionNumber
    }

    /// Set the current vault revision number - the revision number of the vault
    public func setCurrentVaultRevisionNumber(_ revisionNumber: Int) {
        var metadata: VaultMetadata

        if let existingMetadata = getVaultMetadataObject() {
            metadata = existingMetadata
        } else {
            metadata = VaultMetadata(
                publicEmailDomains: [],
                privateEmailDomains: [],
                hiddenPrivateEmailDomains: [],
                vaultRevisionNumber: revisionNumber
            )
        }

        metadata.vaultRevisionNumber = revisionNumber
        if let data = try? JSONEncoder().encode(metadata),
           let jsonString = String(data: data, encoding: .utf8) {
            userDefaults.set(jsonString, forKey: VaultConstants.vaultMetadataKey)
            userDefaults.synchronize()
        }
    }

    // MARK: - Username Storage

    /// Store the username
    public func setUsername(_ username: String) {
        userDefaults.set(username, forKey: VaultConstants.usernameKey)
        userDefaults.synchronize()
    }

    /// Get the username
    public func getUsername() -> String? {
        return userDefaults.string(forKey: VaultConstants.usernameKey)
    }

    /// Clear the username
    public func clearUsername() {
        userDefaults.removeObject(forKey: VaultConstants.usernameKey)
        userDefaults.synchronize()
    }

    // MARK: - Offline Mode Storage

    /// Set offline mode flag
    public func setOfflineMode(_ isOffline: Bool) {
        userDefaults.set(isOffline, forKey: VaultConstants.offlineModeKey)
        userDefaults.synchronize()
    }

    /// Get offline mode flag
    public func getOfflineMode() -> Bool {
        return userDefaults.bool(forKey: VaultConstants.offlineModeKey)
    }

    // MARK: - Server Version Storage

    /// Set the server API version
    public func setServerVersion(_ version: String) {
        userDefaults.set(version, forKey: VaultConstants.serverVersionKey)
        userDefaults.synchronize()
    }

    /// Get the server API version
    public func getServerVersion() -> String? {
        return userDefaults.string(forKey: VaultConstants.serverVersionKey)
    }

    /// Clear the server version
    public func clearServerVersion() {
        userDefaults.removeObject(forKey: VaultConstants.serverVersionKey)
        userDefaults.synchronize()
    }

    /// Check if the stored server version is greater than or equal to the specified version
    /// - Parameter targetVersion: The version to compare against (e.g., "0.25.0")
    /// - Returns: true if stored server version >= targetVersion, false if server version not available or less than target
    public func isServerVersionGreaterThanOrEqualTo(_ targetVersion: String) -> Bool {
        guard let serverVersion = getServerVersion() else {
            return false // No server version stored yet
        }
        return VersionComparison.isGreaterThanOrEqualTo(serverVersion, targetVersion)
    }

    // MARK: - Sync State Storage (isDirty, mutationSequence, isSyncing)

    /// Set the dirty flag indicating local changes need to be synced
    public func setIsDirty(_ isDirty: Bool) {
        userDefaults.set(isDirty, forKey: VaultConstants.isDirtyKey)
        userDefaults.synchronize()
    }

    /// Get the dirty flag
    public func getIsDirty() -> Bool {
        return userDefaults.bool(forKey: VaultConstants.isDirtyKey)
    }

    /// Get the current mutation sequence number
    public func getMutationSequence() -> Int {
        return userDefaults.integer(forKey: VaultConstants.mutationSequenceKey)
    }

    /// Set the mutation sequence number
    public func setMutationSequence(_ sequence: Int) {
        userDefaults.set(sequence, forKey: VaultConstants.mutationSequenceKey)
        userDefaults.synchronize()
    }

    /// Increment the mutation sequence and return the new value
    public func incrementMutationSequence() -> Int {
        let current = getMutationSequence()
        let newValue = current + 1
        setMutationSequence(newValue)
        return newValue
    }

    /// Set the syncing flag
    public func setIsSyncing(_ isSyncing: Bool) {
        userDefaults.set(isSyncing, forKey: VaultConstants.isSyncingKey)
        userDefaults.synchronize()
    }

    /// Get the syncing flag
    public func getIsSyncing() -> Bool {
        return userDefaults.bool(forKey: VaultConstants.isSyncingKey)
    }

    /// Get the complete sync state
    public func getSyncState() -> SyncStateResult {
        return SyncStateResult(
            isDirty: getIsDirty(),
            mutationSequence: getMutationSequence(),
            serverRevision: getCurrentVaultRevisionNumber(),
            isSyncing: getIsSyncing()
        )
    }

    /// Store encrypted vault with sync state atomically.
    /// Two modes:
    /// 1. markDirty=true: Local mutation - always succeeds, increments mutation sequence
    /// 2. expectedMutationSeq provided: Sync operation - only succeeds if no mutations happened
    ///
    /// - Parameters:
    ///   - encryptedVault: The encrypted vault blob
    ///   - markDirty: If true, marks vault as dirty and increments mutation sequence
    ///   - serverRevision: Optional server revision to set
    ///   - expectedMutationSeq: If provided, only store if current sequence matches
    /// - Returns: (success, mutationSequence) - success=false if expectedMutationSeq didn't match
    public func storeEncryptedVaultWithSyncState(
        encryptedVault: String,
        markDirty: Bool = false,
        serverRevision: Int? = nil,
        expectedMutationSeq: Int? = nil
    ) throws -> (success: Bool, mutationSequence: Int) {
        var mutationSequence = getMutationSequence()

        // Race detection for sync operations
        if let expectedSeq = expectedMutationSeq, expectedSeq != mutationSequence {
            return (success: false, mutationSequence: mutationSequence)
        }

        if markDirty {
            mutationSequence += 1
        }

        // Store vault and sync state atomically
        try storeEncryptedDatabase(encryptedVault)

        if markDirty {
            setMutationSequence(mutationSequence)
            setIsDirty(true)
        }

        if let revision = serverRevision {
            setCurrentVaultRevisionNumber(revision)
        }

        return (success: true, mutationSequence: mutationSequence)
    }

    /// Mark the vault as clean after successful sync.
    /// Only clears dirty flag if no mutations happened during sync.
    ///
    /// - Parameters:
    ///   - mutationSeqAtStart: The mutation sequence when sync started
    ///   - newServerRevision: The new server revision after successful upload
    /// - Returns: Whether the dirty flag was cleared
    public func markVaultClean(mutationSeqAtStart: Int, newServerRevision: Int) -> Bool {
        let currentMutationSeq = getMutationSequence()

        // Always update server revision
        setCurrentVaultRevisionNumber(newServerRevision)

        if currentMutationSeq == mutationSeqAtStart {
            // No mutations during sync - safe to mark as clean
            setIsDirty(false)
            return true
        }

        // Mutations happened during sync - keep dirty
        return false
    }

    /// Clear all sync state (used on logout)
    public func clearSyncState() {
        userDefaults.removeObject(forKey: VaultConstants.isDirtyKey)
        userDefaults.removeObject(forKey: VaultConstants.mutationSequenceKey)
        userDefaults.removeObject(forKey: VaultConstants.isSyncingKey)
        userDefaults.synchronize()
    }
}
