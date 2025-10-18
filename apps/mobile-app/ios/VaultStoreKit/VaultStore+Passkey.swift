import Foundation
import SQLite
import VaultModels
import VaultUtils

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
    private static let colUserHandle = Expression<Blob?>("UserHandle")
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
                return passkey
            }
        }

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

        return passkeys
    }

    /**
     * Get passkeys with credential info for a specific rpId and optionally username
     * Used for finding existing passkeys that might be replaced during registration
     */
    public func getPasskeysWithCredentialInfo(forRpId rpId: String, userName: String? = nil, userId: Data? = nil) throws -> [(passkey: Passkey, serviceName: String?, username: String?)] {
        guard let dbConn = dbConnection else {
            throw VaultStoreError.vaultNotUnlocked
        }

        // Join passkeys with credentials and services to get display info
        let passkeysTable = Table("Passkeys")
        let credentialsTable = Table("Credentials")
        let servicesTable = Table("Services")

        let query = passkeysTable
            .select(passkeysTable[*], credentialsTable[Expression<String?>("Username")], servicesTable[Expression<String?>("Name")])
            .join(credentialsTable, on: passkeysTable[Expression<String>("CredentialId")] == credentialsTable[Expression<String>("Id")])
            .join(servicesTable, on: credentialsTable[Expression<String>("ServiceId")] == servicesTable[Expression<String>("Id")])
            .filter(passkeysTable[Expression<String>("RpId")] == rpId)
            .filter(passkeysTable[Expression<Int64>("IsDeleted")] == 0)
            .filter(credentialsTable[Expression<Int64>("IsDeleted")] == 0)
            .order(passkeysTable[Expression<String>("CreatedAt")].desc)

        var results: [(passkey: Passkey, serviceName: String?, username: String?)] = []

        for row in try dbConn.prepare(query) {
            if let passkey = try parsePasskeyRow(row) {
                let credUsername = try? row.get(Expression<String?>("Username"))
                let serviceName = try? row.get(Expression<String?>("Name"))

                // Filter by username or userId if provided
                var matches = true
                if let userName = userName {
                    if credUsername != userName {
                        matches = false
                    }
                }
                if let userId = userId {
                    if passkey.userHandle != userId {
                        matches = false
                    }
                }

                if matches {
                    results.append((passkey: passkey, serviceName: serviceName, username: credUsername))
                }
            }
        }

        return results
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
        let userHandleBlob = try? row.get(Self.colUserHandle)
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
        guard let createdAt = DateHelpers.parseDateString(createdAtString),
              let updatedAt = DateHelpers.parseDateString(updatedAtString) else {
            print("VaultStore+Passkey: Invalid date in passkey row - created=\(createdAtString), updated=\(updatedAtString)")
            return nil
        }

        // Parse public/private keys
        guard let publicKeyData = publicKeyString.data(using: .utf8),
              let privateKeyData = privateKeyString.data(using: .utf8) else {
            print("VaultStore+Passkey: Invalid key data in passkey row")
            return nil
        }

        // Parse userHandle (stored as blob - raw bytes)
        let userHandle: Data?
        if let userHandleBlob = userHandleBlob {
            userHandle = Data(userHandleBlob.bytes)
        } else {
            userHandle = nil
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
            userHandle: userHandle,
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
     * Format: yyyy-MM-dd HH:mm:ss
     */
    private func formatDateForDatabase(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
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
        displayName: String,
        passkey: Passkey,
        logo: Data? = nil
    ) throws -> Credential {
        guard let dbConn = dbConnection else {
            throw VaultStoreError.vaultNotUnlocked
        }

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
            Expression<String?>("Name") <- displayName,  // Use displayName as the service name (title)
            Expression<String?>("Url") <- "https://\(rpId)",
            Expression<SQLite.Blob?>("Logo") <- logoBlob,
            Expression<String>("CreatedAt") <- timestamp,
            Expression<String>("UpdatedAt") <- timestamp,
            Expression<Int64>("IsDeleted") <- 0
        )
        try dbConn.run(serviceInsert)

        // Create a minimal alias with empty fields and default birthdate
        // TODO: once birthdate is made nullable in datamodel refactor, remove this.
        let aliasId = UUID()
        let aliasesTable = Table("Aliases")
        let aliasInsert = aliasesTable.insert(
            Expression<String>("Id") <- aliasId.uuidString,
            Expression<String?>("FirstName") <- "",
            Expression<String?>("LastName") <- "",
            Expression<String?>("NickName") <- "",
            Expression<String?>("BirthDate") <- "0001-01-01 00:00:00",
            Expression<String?>("Gender") <- "",
            Expression<String?>("Email") <- "",
            Expression<String>("CreatedAt") <- timestamp,
            Expression<String>("UpdatedAt") <- timestamp,
            Expression<Int64>("IsDeleted") <- 0
        )
        try dbConn.run(aliasInsert)

        // Create the credential with the alias
        let credentialsTable = Table("Credentials")
        let credentialInsert = credentialsTable.insert(
            Expression<String>("Id") <- credentialId.uuidString,
            Expression<String>("ServiceId") <- serviceId.uuidString,
            Expression<String?>("AliasId") <- aliasId.uuidString,
            Expression<String?>("Username") <- userName,
            Expression<String?>("Notes") <- nil,
            Expression<String>("CreatedAt") <- timestamp,
            Expression<String>("UpdatedAt") <- timestamp,
            Expression<Int64>("IsDeleted") <- 0
        )
        try dbConn.run(credentialInsert)

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

        // Create default birthdate (0001-01-01)
        var defaultBirthDateComponents = DateComponents()
        defaultBirthDateComponents.year = 1
        defaultBirthDateComponents.month = 1
        defaultBirthDateComponents.day = 1
        let defaultBirthDate = Calendar(identifier: .gregorian).date(from: defaultBirthDateComponents)!

        let alias = Alias(
            id: aliasId,
            gender: "",
            firstName: "",
            lastName: "",
            nickName: "",
            birthDate: defaultBirthDate,
            email: "",
            createdAt: now,
            updatedAt: now,
            isDeleted: false
        )

        return Credential(
            id: credentialId,
            alias: alias,
            service: service,
            username: userName,
            notes: nil,
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

        let insert = Self.passkeysTable.insert(
            Self.colId <- passkey.id.uuidString,
            Self.colCredentialId <- passkey.parentCredentialId.uuidString,
            Self.colRpId <- passkey.rpId,
            Self.colUserHandle <- passkey.userHandle.map { Blob(bytes: [UInt8]($0)) },
            Self.colPublicKey <- String(data: passkey.publicKey, encoding: .utf8)!,
            Self.colPrivateKey <- String(data: passkey.privateKey, encoding: .utf8)!,
            Self.colPrfKey <- passkey.prfKey.map { Blob(bytes: [UInt8]($0)) },
            Self.colDisplayName <- passkey.displayName,
            Self.colCreatedAt <- formatDateForDatabase(passkey.createdAt),
            Self.colUpdatedAt <- formatDateForDatabase(passkey.updatedAt),
            Self.colIsDeleted <- Int64(passkey.isDeleted ? 1 : 0)
        )

        try dbConn.run(insert)
    }

    /**
     * Replace an existing passkey with a new one
     * This deletes the old passkey and creates a new one with the same credential
     */
    public func replacePasskey(oldPasskeyId: UUID, newPasskey: Passkey, displayName: String, logo: Data? = nil) throws {
        guard let dbConn = dbConnection else {
            throw VaultStoreError.vaultNotUnlocked
        }

        // Get the old passkey to find its credential
        let oldPasskeyQuery = Self.passkeysTable
            .filter(Self.colId == oldPasskeyId.uuidString)
            .filter(Self.colIsDeleted == 0)
            .limit(1)

        guard let oldPasskeyRow = try dbConn.pluck(oldPasskeyQuery),
              let oldPasskey = try parsePasskeyRow(oldPasskeyRow) else {
            throw VaultStoreError.databaseError("Passkey not found")
        }

        let credentialId = oldPasskey.parentCredentialId
        let now = Date()
        let timestamp = formatDateForDatabase(now)

        // Update the credential's service with new logo if provided
        if let logo = logo {
            let logoBlob = Blob(bytes: [UInt8](logo))
            let credentialsTable = Table("Credentials")
            let servicesTable = Table("Services")

            // Get the service ID from the credential
            let credQuery = credentialsTable
                .filter(Expression<String>("Id") == credentialId.uuidString)
                .limit(1)

            if let credRow = try dbConn.pluck(credQuery) {
                let serviceId = try credRow.get(Expression<String>("ServiceId"))

                // Update the service with new logo and displayName
                let serviceUpdate = servicesTable
                    .filter(Expression<String>("Id") == serviceId)
                    .update(
                        Expression<SQLite.Blob?>("Logo") <- logoBlob,
                        Expression<String?>("Name") <- displayName,
                        Expression<String>("UpdatedAt") <- timestamp
                    )

                try dbConn.run(serviceUpdate)
            }
        }

        // Delete the old passkey
        let deleteQuery = Self.passkeysTable
            .filter(Self.colId == oldPasskeyId.uuidString)
            .update(
                Self.colIsDeleted <- 1,
                Self.colUpdatedAt <- timestamp
            )

        try dbConn.run(deleteQuery)

        // Create the new passkey with the same credential ID
        var updatedPasskey = newPasskey
        updatedPasskey = Passkey(
            id: newPasskey.id,
            parentCredentialId: credentialId,  // Use the old credential ID
            rpId: newPasskey.rpId,
            userHandle: newPasskey.userHandle,
            userName: newPasskey.userName,
            publicKey: newPasskey.publicKey,
            privateKey: newPasskey.privateKey,
            prfKey: newPasskey.prfKey,
            displayName: displayName,
            createdAt: now,
            updatedAt: now,
            isDeleted: false
        )

        try insertPasskey(updatedPasskey)
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
