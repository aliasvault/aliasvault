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

    /// Unlock the vault - decrypt the database and setup the database connection.
    public func unlockVault() throws {
        guard let encryptedDbBase64 = getEncryptedDatabase() else {
            throw AppError.encryptionKeyNotFound
        }

        guard let encryptedDbData = Data(base64Encoded: encryptedDbBase64) else {
            throw AppError.base64DecodeFailed
        }

        do {
            let decrypted = try decrypt(data: encryptedDbData)
            try setupDatabaseWithDecryptedData(decrypted)
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

    /// The bytes every SQLite database file begins with.
    private static let sqliteHeader = Data("SQLite format 3\0".utf8)

    /// Setup the database connection with the decrypted data.
    private func setupDatabaseWithDecryptedData(_ decrypted: Data) throws {
        // Step 1: Take the SQLite bytes as-is, or decode the legacy base64 text.
        let decryptedDbData: Data
        if decrypted.starts(with: Self.sqliteHeader) {
            decryptedDbData = decrypted
        } else {
            guard let decoded = Data(base64Encoded: decrypted) else {
                throw AppError.base64DecodeFailed
            }
            decryptedDbData = decoded
        }

        // Step 2: Open the bytes in the Rust core's memory directly without persisting to the filesystem.
        self.dbConnection = nil
        let opened: SqliteMemoryDatabase
        do {
            opened = try SqliteMemoryDatabase.fromBytes(bytes: decryptedDbData)
            _ = try opened.queryValues(sql: "SELECT count(*) FROM sqlite_master", params: [])
        } catch {
            throw AppError.databaseOpenFailed
        }

        // Step 3: Set pragmas
        do {
            try opened.executeBatch(sql: "PRAGMA foreign_keys = ON")
        } catch {
            throw AppError.databasePragmaFailed
        }
        self.dbConnection = opened
    }
}
