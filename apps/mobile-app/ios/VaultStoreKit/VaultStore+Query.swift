import Foundation
import SQLite
import VaultModels
import VaultUtils

/// Extension for the VaultStore class to handle query management
extension VaultStore {
    /// Execute a SELECT query on the database
    public func executeQuery(_ query: String, params: [Binding?]) throws -> [[String: Any]] {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }

        var params = params
        for (index, param) in params.enumerated() {
            if let base64String = param as? String {
                if base64String.hasPrefix("av-base64-to-blob:") {
                    let base64 = String(base64String.dropFirst("av-base64-to-blob:".count))
                    if let data = Data(base64Encoded: base64) {
                        params[index] = Blob(bytes: [UInt8](data))
                    }
                }
            }
        }

        let statement = try dbConnection.prepare(query)
        var results: [[String: Any]] = []

        for row in try statement.run(params) {
            var rowDict: [String: Any] = [:]
            for (index, column) in statement.columnNames.enumerated() {
                let value = row[index]
                switch value {
                case let data as SQLite.Blob:
                    let binaryData = Data(data.bytes)
                    rowDict[column] = binaryData.base64EncodedString()
                case let number as Int64:
                    rowDict[column] = number
                case let number as Double:
                    rowDict[column] = number
                case let text as String:
                    rowDict[column] = text
                case .none:
                    rowDict[column] = NSNull()
                default:
                    rowDict[column] = value
                }
            }
            results.append(rowDict)
        }

        return results
    }

    /// Execute an UPDATE, INSERT, or DELETE query on the database (which will modify the database).
    public func executeUpdate(_ query: String, params: [Binding?]) throws -> Int {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }

        var params = params
        for (index, param) in params.enumerated() {
            if let base64String = param as? String {
                if base64String.hasPrefix("av-base64-to-blob:") {
                    let base64 = String(base64String.dropFirst("av-base64-to-blob:".count))
                    if let data = Data(base64Encoded: base64) {
                        params[index] = Blob(bytes: [UInt8](data))
                    }
                }
            }
        }

        let statement = try dbConnection.prepare(query)
        try statement.run(params)
        return dbConnection.changes
    }

    /// Execute a raw SQL command on the database without parameters (for DDL operations like CREATE TABLE).
    public func executeRaw(_ query: String) throws {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }

        // Split the query by semicolons to handle multiple statements
        let statements = query.components(separatedBy: ";")

        for statement in statements {
            let trimmedStatement = statement.smartTrim()

            // Skip empty statements and transaction control statements (handled externally)
            if trimmedStatement.isEmpty ||
               trimmedStatement.uppercased().hasPrefix("BEGIN TRANSACTION") ||
               trimmedStatement.uppercased().hasPrefix("COMMIT") ||
               trimmedStatement.uppercased().hasPrefix("ROLLBACK") {
                continue
            }

            try dbConnection.execute(trimmedStatement)
        }
    }

    /// Begin a transaction on the database. This is required for all database operations that modify the database.
    public func beginTransaction() throws {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }
        try dbConnection.execute("BEGIN TRANSACTION")
    }

    /// Persist the in-memory database to encrypted local storage.
    /// This method can be called independently to persist the database without committing a transaction.
    public func persistDatabaseToEncryptedStorage() throws {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }

        let tempDbPath = FileManager.default.temporaryDirectory.appendingPathComponent("temp_db.sqlite")
        try Data().write(to: tempDbPath)

        do {
            try dbConnection.attach(.uri(tempDbPath.path, parameters: [.mode(.readWrite)]), as: "target")

            let tables = try dbConnection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            try dbConnection.execute("BEGIN TRANSACTION")

            for table in tables {
                guard let tableName = table[0] as? String else {
                    continue
                }
                try dbConnection.execute("CREATE TABLE target.\(tableName) AS SELECT * FROM main.\(tableName)")
            }

            try dbConnection.execute("COMMIT")

            // Retry DETACH with delay to handle database lock after COMMIT
            // SQLite may not immediately release locks after COMMIT completes
            var detachSuccess = false
            var lastError: Error?

            for attempt in 1...5 {
                do {
                    try dbConnection.execute("DETACH DATABASE target")
                    detachSuccess = true
                    break
                } catch {
                    lastError = error
                    if "\(error)".lowercased().contains("locked") && attempt < 5 {
                        Thread.sleep(forTimeInterval: 0.1)
                    } else {
                        break
                    }
                }
            }

            if !detachSuccess {
                throw lastError ?? NSError(domain: "VaultStore", code: 5, userInfo: [NSLocalizedDescriptionKey: "Failed to detach database"])
            }
        } catch {
            try? dbConnection.execute("DETACH DATABASE target")
            throw error
        }

        let rawData = try Data(contentsOf: tempDbPath)
        let base64String = rawData.base64EncodedString()
        let encryptedBase64Data = try encrypt(data: Data(base64String.utf8))
        let encryptedBase64String = encryptedBase64Data.base64EncodedString()

        try storeEncryptedDatabase(encryptedBase64String)
        try? FileManager.default.removeItem(at: tempDbPath)
    }

    /// Commit a transaction on the database. This is required for all database operations that modify the database.
    /// Committing a transaction will also trigger a persist from the in-memory database to the encrypted database file.
    public func commitTransaction() throws {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }

        try dbConnection.execute("COMMIT")
        try persistDatabaseToEncryptedStorage()
    }

    /// Rollback a transaction on the database on error.
    public func rollbackTransaction() throws {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }
        try dbConnection.execute("ROLLBACK")
    }

    // swiftlint:disable function_body_length
    /// Get all credentials from the database.
    public func getAllCredentials() throws -> [Credential] {
        guard let dbConnection = self.dbConnection else {
            throw NSError(domain: "VaultStore", code: 4, userInfo: [NSLocalizedDescriptionKey: "Database not initialized"])
        }

        let query = """
            WITH LatestPasswords AS (
                SELECT
                    p.Id as password_id,
                    p.CredentialId,
                    p.Value,
                    p.CreatedAt,
                    p.UpdatedAt,
                    p.IsDeleted,
                    ROW_NUMBER() OVER (PARTITION BY p.CredentialId ORDER BY p.CreatedAt DESC) as rn
                FROM Passwords p
                WHERE p.IsDeleted = 0
            )
            SELECT
                c.Id,
                c.AliasId,
                c.Username,
                c.Notes,
                c.CreatedAt,
                c.UpdatedAt,
                c.IsDeleted,
                s.Id as service_id,
                s.Name as service_name,
                s.Url as service_url,
                s.Logo as service_logo,
                s.CreatedAt as service_created_at,
                s.UpdatedAt as service_updated_at,
                s.IsDeleted as service_is_deleted,
                lp.password_id,
                lp.Value as password_value,
                lp.CreatedAt as password_created_at,
                lp.UpdatedAt as password_updated_at,
                lp.IsDeleted as password_is_deleted,
                a.Id as alias_id,
                a.Gender as alias_gender,
                a.FirstName as alias_first_name,
                a.LastName as alias_last_name,
                a.NickName as alias_nick_name,
                a.BirthDate as alias_birth_date,
                a.Email as alias_email,
                a.CreatedAt as alias_created_at,
                a.UpdatedAt as alias_updated_at,
                a.IsDeleted as alias_is_deleted
            FROM Credentials c
            LEFT JOIN Services s ON s.Id = c.ServiceId AND s.IsDeleted = 0
            LEFT JOIN LatestPasswords lp ON lp.CredentialId = c.Id AND lp.rn = 1
            LEFT JOIN Aliases a ON a.Id = c.AliasId AND a.IsDeleted = 0
            WHERE c.IsDeleted = 0
            ORDER BY c.CreatedAt DESC
        """

        var result: [Credential] = []
        for row in try dbConnection.prepare(query) {
            guard let idString = row[0] as? String else {
                continue
            }

            let createdAtString = row[4] as? String
            let updatedAtString = row[5] as? String

            guard let createdAtString = createdAtString,
                let updatedAtString = updatedAtString else {
                continue
            }

            guard let createdAt = DateHelpers.parseDateString(createdAtString),
                let updatedAt = DateHelpers.parseDateString(updatedAtString) else {
                continue
            }

            guard let isDeletedInt64 = row[6] as? Int64 else { continue }
            let isDeleted = isDeletedInt64 == 1

            guard let serviceId = row[7] as? String,
                let serviceCreatedAtString = row[11] as? String,
                let serviceUpdatedAtString = row[12] as? String,
                let serviceIsDeletedInt64 = row[13] as? Int64,
                let serviceCreatedAt = DateHelpers.parseDateString(serviceCreatedAtString),
                let serviceUpdatedAt = DateHelpers.parseDateString(serviceUpdatedAtString) else {
                continue
            }

            let serviceIsDeleted = serviceIsDeletedInt64 == 1

            let service = Service(
                id: UUID(uuidString: serviceId)!,
                name: row[8] as? String,
                url: row[9] as? String,
                logo: (row[10] as? SQLite.Blob).map { Data($0.bytes) },
                createdAt: serviceCreatedAt,
                updatedAt: serviceUpdatedAt,
                isDeleted: serviceIsDeleted
            )

            var alias: Alias?
            if let aliasIdString = row[19] as? String,
                let aliasCreatedAtString = row[26] as? String,
                let aliasUpdatedAtString = row[27] as? String,
                let aliasIsDeletedInt64 = row[28] as? Int64,
                let aliasCreatedAt = DateHelpers.parseDateString(aliasCreatedAtString),
                let aliasUpdatedAt = DateHelpers.parseDateString(aliasUpdatedAtString) {

                let aliasIsDeleted = aliasIsDeletedInt64 == 1

                let aliasBirthDate: Date
                if let aliasBirthDateString = row[24] as? String,
                   let parsedBirthDate = DateHelpers.parseDateString(aliasBirthDateString) {
                    aliasBirthDate = parsedBirthDate
                } else {
                    // Use 0001-01-01 00:00 as the default date if birthDate is null
                    var dateComponents = DateComponents()
                    dateComponents.year = 1
                    dateComponents.month = 1
                    dateComponents.day = 1
                    dateComponents.hour = 0
                    dateComponents.minute = 0
                    dateComponents.second = 0
                    aliasBirthDate = Calendar(identifier: .gregorian).date(from: dateComponents)!
                }

                alias = Alias(
                    id: UUID(uuidString: aliasIdString)!,
                    gender: row[20] as? String,
                    firstName: row[21] as? String,
                    lastName: row[22] as? String,
                    nickName: row[23] as? String,
                    birthDate: aliasBirthDate,
                    email: row[25] as? String,
                    createdAt: aliasCreatedAt,
                    updatedAt: aliasUpdatedAt,
                    isDeleted: aliasIsDeleted
                )
            }

            var password: Password?
            if let passwordIdString = row[14] as? String,
            let passwordValue = row[15] as? String,
            let passwordCreatedAtString = row[16] as? String,
            let passwordUpdatedAtString = row[17] as? String,
            let passwordIsDeletedInt64 = row[18] as? Int64,
            let passwordCreatedAt = DateHelpers.parseDateString(passwordCreatedAtString),
            let passwordUpdatedAt = DateHelpers.parseDateString(passwordUpdatedAtString) {

                let passwordIsDeleted = passwordIsDeletedInt64 == 1

                password = Password(
                    id: UUID(uuidString: passwordIdString)!,
                    credentialId: UUID(uuidString: idString)!,
                    value: passwordValue,
                    createdAt: passwordCreatedAt,
                    updatedAt: passwordUpdatedAt,
                    isDeleted: passwordIsDeleted
                )
            }

            // Load passkeys for this credential
            let passkeys = try getPasskeys(forCredentialId: UUID(uuidString: idString)!)

            let credential = Credential(
                id: UUID(uuidString: idString)!,
                alias: alias,
                service: service,
                username: row[2] as? String,
                notes: row[3] as? String,
                password: password,
                passkeys: passkeys,
                createdAt: createdAt,
                updatedAt: updatedAt,
                isDeleted: isDeleted
            )
            result.append(credential)
        }

        return result
    }
    // swiftlint:enable function_body_length

    /// Get all credentials that have passkeys by filtering the result of getAllCredentials.
    public func getAllCredentialsWithPasskeys() throws -> [Credential] {
        var credentials = try getAllCredentials()

        // Filter to only include credentials that actually have passkeys
        credentials = credentials.filter { credential in
            guard let passkeys = credential.passkeys else { return false }
            return !passkeys.isEmpty
        }

        return credentials
    }
}
