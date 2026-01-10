import Foundation
import Security

/// Extension for the VaultStore class to handle cache management
extension VaultStore {
    /// Clear the memory - remove the encryption key and decrypted database from memory
    public func clearCache() {
        print("Clearing cache - removing encryption key and decrypted database from memory")
        self.encryptionKey = nil
        self.dbConnection = nil
    }

    /// Clear the vault storage - remove the encryption key and encrypted database from the device
    public func clearVault() throws {
        print("Clearing vault - removing all stored data")

        do {
            try removeKeyFromKeychain()
            print("Successfully removed encryption key from keychain")
        } catch {
            print("Failed to remove encryption key from keychain: \(error)")
        }

        do {
            try removeEncryptedDatabase()
            print("Successfully removed encrypted database file")
        } catch {
            print("Failed to remove encrypted database file: \(error)")
            throw error
        }

        // Clear the UserDefaults to remove all locally persisted data
        self.userDefaults.removeObject(forKey: VaultConstants.vaultMetadataKey)
        self.userDefaults.removeObject(forKey: VaultConstants.authMethodsKey)
        self.userDefaults.removeObject(forKey: VaultConstants.autoLockTimeoutKey)
        self.userDefaults.removeObject(forKey: VaultConstants.encryptionKeyDerivationParamsKey)

        // Clear sync state
        self.userDefaults.removeObject(forKey: VaultConstants.isDirtyKey)
        self.userDefaults.removeObject(forKey: VaultConstants.mutationSequenceKey)
        self.userDefaults.removeObject(forKey: VaultConstants.isSyncingKey)

        self.userDefaults.synchronize()
        print("Cleared UserDefaults")

        // Clear the cache to remove all in-memory data
        self.encryptionKey = nil
        self.dbConnection = nil
        self.enabledAuthMethods = []
        self.autoLockTimeout = VaultConstants.defaultAutoLockTimeout
        self.keyDerivationParams = nil
    }

    /// Set the auto-lock timeout - the number of seconds after which the vault will be locked automatically
    public func setAutoLockTimeout(_ timeout: Int) {
        print("Setting auto-lock timeout to \(timeout) seconds")
        self.autoLockTimeout = timeout
        self.userDefaults.set(timeout, forKey: VaultConstants.autoLockTimeoutKey)
        self.userDefaults.synchronize()
    }

    /// Get the auto-lock timeout - the number of seconds after which the vault will be locked automatically
    public func getAutoLockTimeout() -> Int {
        return self.autoLockTimeout
    }
}
