import Foundation
import SQLite
import VaultModels

/**
 * VaultStore+Passkey
 * Extension to VaultStore for passkey operations
 */
extension VaultStore {

    // MARK: - Column Expressions

    private static let passkeysTable = Table("Passkeys")

    private static let colId = Expression<String>("Id")
    private static let colCredentialId = Expression<String>("CredentialId")
    private static let colRpId = Expression<String>("RpId")
    private static let colUserId = Expression<String?>("UserId")
    private static let colPublicKey = Expression<String>("PublicKey")
    private static let colPrivateKey = Expression<String>("PrivateKey")
    private static let colPrfKey = Expression<Blob?>("PrfKey")
    private static let colDisplayName = Expression<String>("DisplayName")
    private static let colAdditionalData = Expression<Blob?>("AdditionalData")
    private static let colCreatedAt = Expression<String>("CreatedAt")
    private static let colUpdatedAt = Expression<String>("UpdatedAt")
    private static let colIsDeleted = Expression<Int64>("IsDeleted")

    // MARK: - Passkey Queries

    /**
     * Get a passkey by its credential ID (the WebAuthn credential ID, not the parent Credential UUID)
     */
    public func getPasskey(byCredentialId credentialId: Data) throws -> Passkey? {
        guard let dbConn = dbConnection else {
            throw VaultStoreError.vaultNotUnlocked
        }

        print("VaultStore+Passkey: Looking up passkey by credentialId: \(credentialId.base64EncodedString().prefix(20))...")

        // The Passkeys.Id column is a string UUID (not a blob), so we need to convert the credentialId bytes to a UUID string.
        // Use PasskeyHelper to convert the credentialId (Data) to a UUID string for lookup.
        guard let credentialIdString = try? PasskeyHelper.bytesToGuid(credentialId) else {
            print("VaultStore+Passkey: Failed to convert credentialId bytes to UUID string")
            return nil
        }
        let query = Self.passkeysTable
            .filter(Self.colId == credentialIdString)
            .filter(Self.colIsDeleted == 0)
            .limit(1)

        for row in try dbConn.prepare(query) {
            if let passkey = try parsePasskeyRow(row) {
                print("VaultStore+Passkey: Found passkey - rpId=\(passkey.rpId), displayName=\(passkey.displayName), userId=\(passkey.userHandle?.base64EncodedString().prefix(20) ?? "(nil)")...")
                return passkey
            }
        }

        print("VaultStore+Passkey: No passkey found with matching credentialId")
        return nil
    }

    /**
     * Get all passkeys for a credential
     */
    public func getPasskeys(forCredentialId credentialId: UUID) throws -> [Passkey] {
        guard let dbConn = dbConnection else {
            throw VaultStoreError.vaultNotUnlocked
        }

        let query = Self.passkeysTable
            .filter(Self.colCredentialId == credentialId.uuidString)
            .filter(Self.colIsDeleted == 0)
            .order(Self.colCreatedAt.desc)

        var passkeys: [Passkey] = []
        for row in try dbConn.prepare(query) {
            if let passkey = try parsePasskeyRow(row) {
                passkeys.append(passkey)
            }
        }

        return passkeys
    }

    /**
     * Get all passkeys for a specific relying party identifier (RP ID)
     */
    public func getPasskeys(forRpId rpId: String) throws -> [Passkey] {
        guard let dbConn = dbConnection else {
            throw VaultStoreError.vaultNotUnlocked
        }

        print("VaultStore+Passkey: Looking up passkeys for rpId: \(rpId)")

        let query = Self.passkeysTable
            .filter(Self.colRpId == rpId)
            .filter(Self.colIsDeleted == 0)
            .order(Self.colCreatedAt.desc)

        var passkeys: [Passkey] = []
        for row in try dbConn.prepare(query) {
            if let passkey = try parsePasskeyRow(row) {
                passkeys.append(passkey)
            }
        }

        print("VaultStore+Passkey: Found \(passkeys.count) passkeys for rpId: \(rpId)")
        return passkeys
    }

    /**
     * Get all credentials that have passkeys attached
     */
    // swiftlint:disable:next function_body_length
    public func getAllCredentialsWithPasskeys() throws -> [Credential] {
        guard let dbConn = dbConnection else {
            throw VaultStoreError.vaultNotUnlocked
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
            INNER JOIN Passkeys pk ON pk.CredentialId = c.Id AND pk.IsDeleted = 0
            LEFT JOIN Services s ON s.Id = c.ServiceId AND s.IsDeleted = 0
            LEFT JOIN LatestPasswords lp ON lp.CredentialId = c.Id AND lp.rn = 1
            LEFT JOIN Aliases a ON a.Id = c.AliasId AND a.IsDeleted = 0
            WHERE c.IsDeleted = 0
            GROUP BY c.Id
            ORDER BY c.CreatedAt DESC
        """

        var credentials: [Credential] = []
        for row in try dbConn.prepare(query) {
            guard let idString = row[0] as? String else {
                continue
            }

            let createdAtString = row[4] as? String
            let updatedAtString = row[5] as? String

            guard let createdAtString = createdAtString,
                  let updatedAtString = updatedAtString else {
                continue
            }

            guard let createdAt = parseDateString(createdAtString),
                  let updatedAt = parseDateString(updatedAtString) else {
                continue
            }

            guard let isDeletedInt64 = row[6] as? Int64 else { continue }
            let isDeleted = isDeletedInt64 == 1

            guard let serviceId = row[7] as? String,
                  let serviceCreatedAtString = row[11] as? String,
                  let serviceUpdatedAtString = row[12] as? String,
                  let serviceIsDeletedInt64 = row[13] as? Int64,
                  let serviceCreatedAt = parseDateString(serviceCreatedAtString),
                  let serviceUpdatedAt = parseDateString(serviceUpdatedAtString) else {
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
               let aliasCreatedAt = parseDateString(aliasCreatedAtString),
               let aliasUpdatedAt = parseDateString(aliasUpdatedAtString) {

                let aliasIsDeleted = aliasIsDeletedInt64 == 1

                let aliasBirthDate: Date
                if let aliasBirthDateString = row[24] as? String,
                   let parsedBirthDate = parseDateString(aliasBirthDateString) {
                    aliasBirthDate = parsedBirthDate
                } else {
                    var dateComponents = DateComponents()
                    dateComponents.year = 1
                    dateComponents.month = 1
                    dateComponents.day = 1
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
               let passwordCreatedAt = parseDateString(passwordCreatedAtString),
               let passwordUpdatedAt = parseDateString(passwordUpdatedAtString) {

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

            credentials.append(credential)
        }

        return credentials
    }

    // MARK: - Helper Methods

    /**
     * Parse a passkey row from database query using type-safe column expressions
     */
    private func parsePasskeyRow(_ row: Row) throws -> Passkey? {
        // Extract required fields using column expressions
        let idString = try row.get(Self.colId)
        let parentCredentialIdString = try row.get(Self.colCredentialId)
        let rpId = try row.get(Self.colRpId)
        let userIdBase64url = try? row.get(Self.colUserId)
        let publicKeyString = try row.get(Self.colPublicKey)
        let privateKeyString = try row.get(Self.colPrivateKey)
        let displayName = try row.get(Self.colDisplayName)
        let createdAtString = try row.get(Self.colCreatedAt)
        let updatedAtString = try row.get(Self.colUpdatedAt)
        let isDeletedInt64 = try row.get(Self.colIsDeleted)

        // Parse UUIDs
        guard let id = UUID(uuidString: idString),
              let parentCredentialId = UUID(uuidString: parentCredentialIdString) else {
            print("VaultStore+Passkey: Invalid UUID in passkey row - id=\(idString), credentialId=\(parentCredentialIdString)")
            return nil
        }

        // Parse dates
        guard let createdAt = parseDateString(createdAtString),
              let updatedAt = parseDateString(updatedAtString) else {
            print("VaultStore+Passkey: Invalid date in passkey row - created=\(createdAtString), updated=\(updatedAtString)")
            return nil
        }

        // Parse public/private keys
        guard let publicKeyData = publicKeyString.data(using: .utf8),
              let privateKeyData = privateKeyString.data(using: .utf8) else {
            print("VaultStore+Passkey: Invalid key data in passkey row")
            return nil
        }

        // Parse userId (stored as base64url-encoded string in DB, decode to raw bytes for iOS)
        let userId: Data?
        if let userIdBase64url = userIdBase64url, !userIdBase64url.isEmpty {
            do {
                userId = try PasskeyHelper.base64urlToBytes(userIdBase64url)
            } catch {
                print("VaultStore+Passkey: Failed to decode userId from base64url: \(error)")
                userId = nil
            }
        } else {
            userId = nil
        }

        // Parse PrfKey (stored as blob)
        let prfKey: Data?
        if let prfKeyBlob = try? row.get(Self.colPrfKey) {
            prfKey = Data(prfKeyBlob.bytes)
        } else {
            prfKey = nil
        }

        let isDeleted = isDeletedInt64 == 1

        return Passkey(
            id: id,
            parentCredentialId: parentCredentialId,  // Parent Credential UUID
            rpId: rpId,
            userHandle: userId,
            userName: nil,  // userName not stored in DB, derived from parent credential
            publicKey: publicKeyData,
            privateKey: privateKeyData,
            prfKey: prfKey,
            displayName: displayName,
            createdAt: createdAt,
            updatedAt: updatedAt,
            isDeleted: isDeleted
        )
    }

    // MARK: - Passkey Storage

    /**
     * Format a date for database insertion
     * Format: yyyy-MM-dd HH:mm:ss.SSS
     */
    private func formatDateForDatabase(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }

    /**
     * Create a credential with a passkey (proof of concept for passkey registration)
     * This creates a minimal credential record and links the passkey to it
     */
    public func createCredentialWithPasskey(
        rpId: String,
        userName: String?,
        userDisplayName: String?,
        passkey: Passkey,
        logo: Data? = nil
    ) throws -> Credential {
        guard let dbConn = dbConnection else {
            throw VaultStoreError.vaultNotUnlocked
        }

        print("VaultStore+Passkey: Creating credential with passkey for rpId=\(rpId)")

        let credentialId = passkey.parentCredentialId
        let now = Date()
        let timestamp = formatDateForDatabase(now)

        // Create a minimal service for the RP
        let serviceId = UUID()
        let serviceTable = Table("Services")

        // Convert logo Data to SQLite Blob if present
        let logoBlob = logo.map { Blob(bytes: [UInt8]($0)) }

        let serviceInsert = serviceTable.insert(
            Expression<String>("Id") <- serviceId.uuidString,
            Expression<String?>("Name") <- rpId,
            Expression<String?>("Url") <- "https://\(rpId)",
            Expression<SQLite.Blob?>("Logo") <- logoBlob,
            Expression<String>("CreatedAt") <- timestamp,
            Expression<String>("UpdatedAt") <- timestamp,
            Expression<Int64>("IsDeleted") <- 0
        )
        try dbConn.run(serviceInsert)

        // Create the credential
        let credentialsTable = Table("Credentials")
        let credentialInsert = credentialsTable.insert(
            Expression<String>("Id") <- credentialId.uuidString,
            Expression<String>("ServiceId") <- serviceId.uuidString,
            Expression<String?>("AliasId") <- nil,
            Expression<String?>("Username") <- userName,
            Expression<String?>("Notes") <- "Passkey for \(rpId)",
            Expression<String>("CreatedAt") <- timestamp,
            Expression<String>("UpdatedAt") <- timestamp,
            Expression<Int64>("IsDeleted") <- 0
        )
        try dbConn.run(credentialInsert)

        print("VaultStore+Passkey: Created credential \(credentialId.uuidString)")

        // Insert the passkey
        try insertPasskey(passkey)

        // Return the credential
        let service = Service(
            id: serviceId,
            name: rpId,
            url: "https://\(rpId)",
            logo: logo,
            createdAt: now,
            updatedAt: now,
            isDeleted: false
        )

        return Credential(
            id: credentialId,
            alias: nil,
            service: service,
            username: userName,
            notes: "Passkey for \(rpId)",
            password: nil,
            passkeys: [passkey],
            createdAt: now,
            updatedAt: now,
            isDeleted: false
        )
    }

    /**
     * Insert a new passkey into the database
     */
    public func insertPasskey(_ passkey: Passkey) throws {
        guard let dbConn = dbConnection else {
            throw VaultStoreError.vaultNotUnlocked
        }

        print("VaultStore+Passkey: Inserting new passkey - id=\(passkey.id.uuidString), rpId=\(passkey.rpId)")

        let insert = Self.passkeysTable.insert(
            Self.colId <- passkey.id.uuidString,
            Self.colCredentialId <- passkey.parentCredentialId.uuidString,
            Self.colRpId <- passkey.rpId,
            Self.colUserId <- passkey.userHandle?.base64EncodedString(),
            Self.colPublicKey <- String(data: passkey.publicKey, encoding: .utf8)!,
            Self.colPrivateKey <- String(data: passkey.privateKey, encoding: .utf8)!,
            Self.colPrfKey <- passkey.prfKey.map { Blob(bytes: [UInt8]($0)) },
            Self.colDisplayName <- passkey.displayName,
            Self.colCreatedAt <- formatDateForDatabase(passkey.createdAt),
            Self.colUpdatedAt <- formatDateForDatabase(passkey.updatedAt),
            Self.colIsDeleted <- Int64(passkey.isDeleted ? 1 : 0)
        )

        try dbConn.run(insert)
        print("VaultStore+Passkey: Successfully inserted passkey")
    }

    /**
     * Parse a date string to a Date object for use in queries.
     */
    private func parseDateString(_ dateString: String) -> Date? {
        struct StaticFormatters {
            static let formatterWithMillis: DateFormatter = {
                let formatter = DateFormatter()
                formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = TimeZone(secondsFromGMT: 0)
                return formatter
            }()

            static let formatterWithoutMillis: DateFormatter = {
                let formatter = DateFormatter()
                formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = TimeZone(secondsFromGMT: 0)
                return formatter
            }()

            static let isoFormatter: ISO8601DateFormatter = {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                formatter.timeZone = TimeZone(secondsFromGMT: 0)
                return formatter
            }()
        }

        let cleanedDateString = dateString.trimmingCharacters(in: .whitespacesAndNewlines)

        if cleanedDateString.contains("Z") || cleanedDateString.contains("+") || cleanedDateString.contains("-") {
            if let isoDate = StaticFormatters.isoFormatter.date(from: cleanedDateString) {
                return isoDate
            }
        }

        if let dateWithMillis = StaticFormatters.formatterWithMillis.date(from: cleanedDateString) {
            return dateWithMillis
        }

        if let dateWithoutMillis = StaticFormatters.formatterWithoutMillis.date(from: cleanedDateString) {
            return dateWithoutMillis
        }

        return nil
    }
}

/**
 * VaultStore errors
 */
public enum VaultStoreError: Error {
    case vaultNotUnlocked
    case passkeyNotFound
    case credentialNotFound
    case databaseError(String)
}
