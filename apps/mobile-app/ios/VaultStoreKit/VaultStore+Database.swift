import Foundation
import SQLite

/// Extension for the VaultStore class to handle database management
extension VaultStore {
    /// Whether the vault has been stored on the device
    public var hasEncryptedDatabase: Bool {
        return FileManager.default.fileExists(atPath: getEncryptedDbPath().path)
    }

    /// Store the encrypted database
    public func storeEncryptedDatabase(_ base64EncryptedDb: String) throws {
        try base64EncryptedDb.write(to: getEncryptedDbPath(), atomically: true, encoding: .utf8)
    }

    /// Get the encrypted database
    public func getEncryptedDatabase() -> String? {
        do {
            return try String(contentsOf: getEncryptedDbPath(), encoding: .utf8)
        } catch {
            return nil
        }
    }

    /// Unlock the vault - decrypt the database and setup the database with the decrypted data
    public func unlockVault() throws {
        guard let encryptedDbBase64 = getEncryptedDatabase() else {
            throw AppError.encryptionKeyNotFound
        }

        guard let encryptedDbData = Data(base64Encoded: encryptedDbBase64) else {
            throw AppError.base64DecodeFailed
        }

        do {
            let decryptedDbBase64 = try decrypt(data: encryptedDbData)
            try setupDatabaseWithDecryptedData(decryptedDbBase64)
        } catch let vaultError as AppError {
            // Pass through AppError types
            throw vaultError
        } catch {
            // Wrap other errors as decryption failure
            throw AppError.vaultDecryptFailed
        }
    }

    /// Remove the encrypted database from the local filesystem
    public func removeEncryptedDatabase() throws {
        try FileManager.default.removeItem(at: getEncryptedDbPath())
    }

    /// Get the path to the encrypted database file
    private func getEncryptedDbPath() -> URL {
        guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: VaultConstants.keychainAccessGroup) else {
            fatalError("Failed to get shared container URL")
        }
        return containerURL.appendingPathComponent(VaultConstants.encryptedDbFileName)
    }

    /// Setup the database with the decrypted data
    private func setupDatabaseWithDecryptedData(_ decryptedDbBase64: Data) throws {
        // Step 1: Decode base64
        guard let decryptedDbData = Data(base64Encoded: decryptedDbBase64) else {
            throw AppError.base64DecodeFailed
        }

        // Step 2: Clean up any existing connection
        self.dbConnection = nil

        // Step 3: Write decrypted data to temp file
        let tempDbPath = FileManager.default.temporaryDirectory.appendingPathComponent("temp_db.sqlite")
        do {
            try decryptedDbData.write(to: tempDbPath)
        } catch {
            throw AppError.databaseTempWriteFailed
        }

        // Step 4: Open source database from temp file
        let sourceConnection: Connection
        do {
            sourceConnection = try Connection(tempDbPath.path)
        } catch {
            try? FileManager.default.removeItem(at: tempDbPath)
            throw AppError.databaseOpenFailed
        }

        // Step 5: Create in-memory database connection
        do {
            self.dbConnection = try Connection(":memory:")
        } catch {
            try? FileManager.default.removeItem(at: tempDbPath)
            throw AppError.databaseMemoryFailed
        }

        // Step 6: Use SQLite backup API to copy entire database with full schema preservation
        // This preserves foreign keys, indexes, triggers, views, and all other schema objects
        do {
            let backup = try sourceConnection.backup(usingConnection: self.dbConnection!)
            try backup.step()
            backup.finish()
        } catch {
            try? FileManager.default.removeItem(at: tempDbPath)
            throw AppError.databaseBackupFailed
        }

        // Clean up temp file
        try? FileManager.default.removeItem(at: tempDbPath)

        // Step 7: Set pragmas
        do {
            try self.dbConnection?.execute("PRAGMA journal_mode = WAL")
            try self.dbConnection?.execute("PRAGMA synchronous = NORMAL")
            try self.dbConnection?.execute("PRAGMA foreign_keys = ON")
        } catch {
            throw AppError.databasePragmaFailed
        }
    }
}
