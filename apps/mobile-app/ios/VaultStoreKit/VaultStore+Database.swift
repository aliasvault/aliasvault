import Foundation
import RustCoreFramework
import VaultUtils

/// Extension for the VaultStore class to handle database management
extension VaultStore {
    /// Whether the vault has been stored on the device
    public var hasEncryptedDatabase: Bool {
        return FileManager.default.fileExists(atPath: getEncryptedDbPath().path)
    }

    /// Store the encrypted database
    public func storeEncryptedDatabase(_ encryptedDb: Data) throws {
        try encryptedDb.write(to: getEncryptedDbPath(), options: .atomic)
        loadedVaultStamp = storedVaultStamp()
    }

    /// Get the encrypted database
    public func getEncryptedDatabase() -> Data? {
        return try? Data(contentsOf: getEncryptedDbPath())
    }

    /// Unlock the vault - decrypt the database and setup the database connection.
    public func unlockVault() throws {
        // Taken before the read: a write landing in between leaves the stamp behind, which only causes one extra reload.
        let stamp = storedVaultStamp()
        guard let encryptedDb = getEncryptedDatabase() else {
            throw AppError.encryptionKeyNotFound
        }

        do {
            try openDatabase(try decryptVaultBlob(encryptedDb))
            loadedVaultStamp = stamp
        } catch let vaultError as AppError {
            // Pass through AppError types
            throw vaultError
        } catch {
            // Wrap other errors as decryption failure
            throw AppError.vaultDecryptFailed
        }
    }

    /// Reload the live database when another process (the app or the autofill extension) stored the vault since this
    /// one loaded it, so a write never builds on, or a sync never pushes from, a stale copy. A no-op while locked.
    public func reloadIfStoredVaultChanged() throws {
        guard dbConnection != nil, let stamp = storedVaultStamp(), stamp != loadedVaultStamp else {
            return
        }
        print("[VaultStore] Stored vault changed in another process, reloading the live database")
        try unlockVault()
    }

    /// The modification date of the stored vault file, which every store replaces atomically.
    private func storedVaultStamp() -> Date? {
        return (try? FileManager.default.attributesOfItem(atPath: getEncryptedDbPath().path))?[.modificationDate] as? Date
    }

    /// Remove the encrypted database from the local filesystem
    public func removeEncryptedDatabase() throws {
        for fileName in [VaultConstants.encryptedDbFileName, Self.legacyBase64EncryptedDbFileName] {
            let path = sharedContainerURL().appendingPathComponent(fileName)
            guard FileManager.default.fileExists(atPath: path.path) else { continue }
            try FileManager.default.removeItem(at: path)
        }
    }

    /// Get the path to the encrypted database file
    private func getEncryptedDbPath() -> URL {
        let path = sharedContainerURL().appendingPathComponent(VaultConstants.encryptedDbFileName)
        // LEGACY: see VaultStore+LegacyVaultFileConversion.
        convertLegacyBase64Database(to: path)
        return path
    }

    /// The app group container the app and the autofill extension share.
    internal func sharedContainerURL() -> URL {
        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: VaultConstants.keychainAccessGroup) else {
            fatalError("Failed to get shared container URL")
        }
        return containerURL
    }

    /// Open the decrypted SQLite database bytes in the Rust core's memory, without persisting them to the filesystem.
    private func openDatabase(_ decryptedDbData: Data) throws {
        self.dbConnection = nil
        do {
            let opened = try SqliteMemoryDatabase.fromBytes(bytes: decryptedDbData)
            _ = try opened.queryValues(sql: "SELECT count(*) FROM sqlite_master", params: [])
            self.dbConnection = opened
        } catch {
            throw AppError.databaseOpenFailed
        }
    }
}
