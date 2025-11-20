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
}
