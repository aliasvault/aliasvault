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
}
