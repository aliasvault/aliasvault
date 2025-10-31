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
            throw NSError(domain: "VaultStore", code: 1, userInfo: [NSLocalizedDescriptionKey: "No encrypted database found"])
        }

        guard let encryptedDbData = Data(base64Encoded: encryptedDbBase64) else {
            throw NSError(domain: "VaultStore", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not base64 decode encrypted database"])
        }

        do {
            let decryptedDbBase64 = try decrypt(data: encryptedDbData)
            try setupDatabaseWithDecryptedData(decryptedDbBase64)
        } catch let error as NSError {
            // If it's already a VaultStore error with detailed info, pass it through
            if error.domain == "VaultStore" && error.code >= 10 {
                throw error
            }

            // Otherwise, it's a decryption error
            throw NSError(
                domain: "VaultStore",
                code: 5,
                userInfo: [
                    NSLocalizedDescriptionKey: "Could not unlock vault: Decryption failed",
                    NSUnderlyingErrorKey: error
                ]
            )
        }
    }

    /// Remove the encrypted database from the local filesystem
    internal func removeEncryptedDatabase() throws {
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
            throw NSError(
                domain: "VaultStore",
                code: 10,
                userInfo: [NSLocalizedDescriptionKey: "Database setup failed: Could not decode base64 data after decryption"]
            )
        }

        // Step 2: Clean up any existing connection
        self.dbConnection = nil

        // Step 3: Write decrypted data to temp file
        let tempDbPath = FileManager.default.temporaryDirectory.appendingPathComponent("temp_db.sqlite")
        do {
            try decryptedDbData.write(to: tempDbPath)
        } catch {
            throw NSError(
                domain: "VaultStore",
                code: 11,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not write decrypted data to temp file",
                    NSUnderlyingErrorKey: error
                ]
            )
        }

        // Step 4: Open source database from temp file
        let sourceConnection: Connection
        do {
            sourceConnection = try Connection(tempDbPath.path)
        } catch {
            try? FileManager.default.removeItem(at: tempDbPath)
            throw NSError(
                domain: "VaultStore",
                code: 12,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not open source database (file may be corrupt)",
                    NSUnderlyingErrorKey: error
                ]
            )
        }

        // Step 5: Create in-memory database connection
        do {
            self.dbConnection = try Connection(":memory:")
        } catch {
            try? FileManager.default.removeItem(at: tempDbPath)
            throw NSError(
                domain: "VaultStore",
                code: 13,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not create in-memory database connection",
                    NSUnderlyingErrorKey: error
                ]
            )
        }

        // Step 6: Use SQLite backup API to copy entire database with full schema preservation
        // This preserves foreign keys, indexes, triggers, views, and all other schema objects
        do {
            let backup = try sourceConnection.backup(usingConnection: self.dbConnection!)
            try backup.step()
            backup.finish()
        } catch {
            try? FileManager.default.removeItem(at: tempDbPath)
            throw NSError(
                domain: "VaultStore",
                code: 14,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not backup database to memory",
                    NSUnderlyingErrorKey: error
                ]
            )
        }

        // Clean up temp file
        try? FileManager.default.removeItem(at: tempDbPath)

        // Step 7: Set pragmas
        do {
            try self.dbConnection?.execute("PRAGMA journal_mode = WAL")
            try self.dbConnection?.execute("PRAGMA synchronous = NORMAL")
            try self.dbConnection?.execute("PRAGMA foreign_keys = ON")
        } catch {
            throw NSError(
                domain: "VaultStore",
                code: 15,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not set database pragmas",
                    NSUnderlyingErrorKey: error
                ]
            )
        }
    }
}
