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

        // Step 2: Clean up any existing connection to prevent leftover attachments
        if self.dbConnection != nil {
            // Try to detach any existing "source" database from previous failed attempts
            try? self.dbConnection?.execute("DETACH DATABASE source")
            self.dbConnection = nil
        }

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

        // Step 4: Create in-memory database connection
        do {
            self.dbConnection = try Connection(":memory:")
        } catch {
            try? FileManager.default.removeItem(at: tempDbPath)
            throw NSError(
                domain: "VaultStore",
                code: 12,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not create in-memory database connection",
                    NSUnderlyingErrorKey: error
                ]
            )
        }

        // Step 4: Attach temp database
        do {
            try self.dbConnection?.attach(.uri(tempDbPath.path, parameters: [.mode(.readOnly)]), as: "source")
        } catch {
            try? FileManager.default.removeItem(at: tempDbPath)
            throw NSError(
                domain: "VaultStore",
                code: 13,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not attach temp database (file may be corrupt)",
                    NSUnderlyingErrorKey: error
                ]
            )
        }

        // Step 5: Begin transaction
        do {
            try self.dbConnection?.execute("BEGIN TRANSACTION")
        } catch {
            try? FileManager.default.removeItem(at: tempDbPath)
            throw NSError(
                domain: "VaultStore",
                code: 14,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not begin transaction",
                    NSUnderlyingErrorKey: error
                ]
            )
        }

        // Step 6: Copy tables
        do {
            // Collect table names first, then iterate
            // This ensures the prepared statement is finalized before we start creating tables
            var tableNames: [String] = []
            let tables = try self.dbConnection?.prepare("SELECT name FROM source.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            for table in tables! {
                guard let tableName = table[0] as? String else {
                    continue
                }
                tableNames.append(tableName)
            }

            // Now create tables from the collected names
            for tableName in tableNames {
                try self.dbConnection?.execute("CREATE TABLE \(tableName) AS SELECT * FROM source.\(tableName)")
            }
        } catch {
            try? self.dbConnection?.execute("ROLLBACK")
            try? FileManager.default.removeItem(at: tempDbPath)
            throw NSError(
                domain: "VaultStore",
                code: 15,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not copy tables from source database",
                    NSUnderlyingErrorKey: error
                ]
            )
        }

        // Step 7: Commit transaction
        do {
            try self.dbConnection?.execute("COMMIT")
        } catch {
            try? self.dbConnection?.execute("ROLLBACK")
            try? FileManager.default.removeItem(at: tempDbPath)
            throw NSError(
                domain: "VaultStore",
                code: 16,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not commit transaction",
                    NSUnderlyingErrorKey: error
                ]
            )
        }

        // Step 8: Detach source database with retry logic
        var detachSuccess = false
        var lastDetachError: Error?

        for attempt in 1...5 {
            do {
                // First check if source database is still attached by collecting database names
                // We collect names first to ensure the statement is finalized before detaching
                var isSourceAttached = false
                if let attachedDbs = try self.dbConnection?.prepare("PRAGMA database_list") {
                    let dbNames = attachedDbs.map { row -> String? in
                        row[1] as? String
                    }
                    isSourceAttached = dbNames.contains("source")
                }

                if !isSourceAttached {
                    // Source is already detached (shouldn't happen, but handle gracefully)
                    detachSuccess = true
                    break
                }

                // Try to detach
                try self.dbConnection?.execute("DETACH DATABASE source")
                detachSuccess = true
                break
            } catch let error as NSError {
                // Check if error is "no such database" - means it's already detached
                if error.localizedDescription.lowercased().contains("no such database") {
                    detachSuccess = true
                    break
                }

                lastDetachError = error
                if attempt < 5 {
                    // Small delay before retry
                    Thread.sleep(forTimeInterval: Double(attempt) * 0.01)
                }
            }
        }

        if !detachSuccess {
            try? FileManager.default.removeItem(at: tempDbPath)
            throw NSError(
                domain: "VaultStore",
                code: 17,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not detach source database after 5 attempts",
                    NSUnderlyingErrorKey: lastDetachError as Any
                ]
            )
        }

        // Clean up temp file
        try? FileManager.default.removeItem(at: tempDbPath)

        // Step 9: Set pragmas
        do {
            try self.dbConnection?.execute("PRAGMA journal_mode = WAL")
            try self.dbConnection?.execute("PRAGMA synchronous = NORMAL")
            try self.dbConnection?.execute("PRAGMA foreign_keys = ON")
        } catch {
            throw NSError(
                domain: "VaultStore",
                code: 18,
                userInfo: [
                    NSLocalizedDescriptionKey: "Database setup failed: Could not set database pragmas",
                    NSUnderlyingErrorKey: error
                ]
            )
        }
    }
}
