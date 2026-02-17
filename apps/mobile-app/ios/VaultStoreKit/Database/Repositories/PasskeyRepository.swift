import Foundation
import VaultModels
import VaultUtils

/// Repository for Passkey CRUD operations.
/// Handles fetching, creating, updating, and deleting passkeys.
public class PasskeyRepository: BaseRepository {

    // MARK: - Read Operations

    /// Get a passkey by its credential ID.
    /// - Parameter credentialId: The passkey credential ID (UUID string)
    /// - Returns: Passkey object or nil if not found
    public func getById(_ credentialId: String) throws -> Passkey? {
        let results = try client.executeQuery(PasskeyQueries.getById, params: [credentialId])
        guard let row = results.first.flatMap({ PasskeyRow(from: $0) }) else {
            return nil
        }
        return PasskeyMapper.mapRow(row)
    }

    /// Get all passkeys for an item.
    /// - Parameter itemId: The item ID (UUID string)
    /// - Returns: Array of Passkey objects
    public func getByItemId(_ itemId: String) throws -> [Passkey] {
        let results = try client.executeQuery(PasskeyQueries.getByItemId, params: [itemId])
        let rows = results.compactMap { PasskeyRow(from: $0) }
        return PasskeyMapper.mapRows(rows)
    }

    /// Get all passkeys for a relying party (rpId).
    /// - Parameter rpId: The relying party identifier (domain)
    /// - Returns: Array of Passkey objects
    public func getByRpId(_ rpId: String) throws -> [Passkey] {
        let results = try client.executeQuery(PasskeyQueries.getByRpId, params: [rpId])
        let rows = results.compactMap { PasskeyRow(from: $0) }
        return PasskeyMapper.mapRows(rows)
    }

    /// Get passkeys with item info for a specific rpId.
    /// - Parameters:
    ///   - rpId: The relying party identifier (domain)
    ///   - userName: Optional username to filter by
    ///   - userId: Optional user handle to filter by
    /// - Returns: Array of PasskeyWithItemInfo objects
    public func getWithItemInfo(forRpId rpId: String, userName: String? = nil, userId: Data? = nil) throws -> [PasskeyWithItemInfo] {
        let results = try client.executeQuery(PasskeyQueries.getWithItemInfoByRpId, params: [rpId])
        let rows = results.compactMap { PasskeyWithItemInfoRow(from: $0) }
        var mappedResults = PasskeyMapper.mapRowsWithItemInfo(rows)

        // Apply optional filters
        if let userName = userName {
            mappedResults = mappedResults.filter { $0.username == userName }
        }
        if let userId = userId {
            mappedResults = mappedResults.filter { $0.passkey.userHandle == userId }
        }

        return mappedResults
    }

    /// Get Items that match an rpId but don't have a passkey yet using legacy SQL LIKE matching.
    /// Note: The public API now uses getAllItemsWithoutPasskey + Rust credential matcher for consistent cross-platform matching.
    /// This method is kept for potential fallback scenarios.
    /// - Parameters:
    ///   - rpId: The relying party identifier (domain)
    ///   - userName: Optional username to filter by
    /// - Returns: Array of ItemWithCredentialInfoData objects
    func getItemsWithoutPasskeyLegacy(forRpId rpId: String, userName: String? = nil) throws -> [ItemWithCredentialInfoData] {
        let rpIdLower = rpId.lowercased()
        let urlPattern1 = "%\(rpIdLower)%"
        let urlPattern2 = "%\(rpIdLower.replacingOccurrences(of: "www.", with: ""))%"

        let results = try client.executeQuery(PasskeyQueries.getItemsWithoutPasskeyForRpId, params: [urlPattern1, urlPattern2])

        var items: [ItemWithCredentialInfoData] = []

        for row in results {
            guard let idString = row["Id"] as? String,
                  let itemId = UUID(uuidString: idString) else {
                continue
            }

            let serviceName = row["Name"] as? String
            let url = row["Url"] as? String
            let itemUsername = row["Username"] as? String
            let password = row["Password"] as? String
            let hasPassword = password != nil && !password!.isEmpty

            // Filter by username if provided
            if let userName = userName, itemUsername != userName {
                continue
            }

            let createdAt = DateHelpers.parseDateString(row["CreatedAt"] as? String ?? "") ?? Date.distantPast
            let updatedAt = DateHelpers.parseDateString(row["UpdatedAt"] as? String ?? "") ?? Date.distantPast

            items.append(ItemWithCredentialInfoData(
                itemId: itemId,
                serviceName: serviceName,
                url: url,
                username: itemUsername,
                hasPassword: hasPassword,
                createdAt: createdAt,
                updatedAt: updatedAt
            ))
        }

        return items
    }

    /// Get ALL Login items that don't have a passkey yet (no URL filtering).
    /// Used with RustItemMatcher for intelligent, cross-platform consistent filtering.
    /// - Returns: Array of ItemWithCredentialInfoData objects with all URLs
    public func getAllItemsWithoutPasskey() throws -> [ItemWithCredentialInfoData] {
        let results = try client.executeQuery(PasskeyQueries.getAllItemsWithoutPasskey, params: [])

        var items: [ItemWithCredentialInfoData] = []

        for row in results {
            guard let idString = row["Id"] as? String,
                  let itemId = UUID(uuidString: idString) else {
                continue
            }

            let serviceName = row["Name"] as? String
            let urlsString = row["Urls"] as? String
            let urls = urlsString?.components(separatedBy: ",").filter { !$0.isEmpty } ?? []
            let itemUsername = row["Username"] as? String
            let password = row["Password"] as? String
            let hasPassword = password != nil && !password!.isEmpty

            let createdAt = DateHelpers.parseDateString(row["CreatedAt"] as? String ?? "") ?? Date.distantPast
            let updatedAt = DateHelpers.parseDateString(row["UpdatedAt"] as? String ?? "") ?? Date.distantPast

            items.append(ItemWithCredentialInfoData(
                itemId: itemId,
                serviceName: serviceName,
                urls: urls,
                username: itemUsername,
                hasPassword: hasPassword,
                createdAt: createdAt,
                updatedAt: updatedAt
            ))
        }

        return items
    }

    // MARK: - Write Operations

    /// Create a new passkey.
    /// - Parameter passkey: The passkey to create
    @discardableResult
    public func create(_ passkey: Passkey) throws -> String {
        return try withTransaction {
            let passkeyId = passkey.id.uuidString.uppercased()
            let now = self.now()

            // Convert keys to string for storage
            guard let publicKeyString = String(data: passkey.publicKey, encoding: .utf8),
                  let privateKeyString = String(data: passkey.privateKey, encoding: .utf8) else {
                throw PasskeyRepositoryError.invalidKeyData
            }

            // Convert blob data to base64 with prefix for VaultStore+Query processing
            let userHandleParam: SqliteBindValue = passkey.userHandle.map { "av-base64-to-blob:\($0.base64EncodedString())" }
            let prfKeyParam: SqliteBindValue = passkey.prfKey.map { "av-base64-to-blob:\($0.base64EncodedString())" }

            try client.executeUpdate(PasskeyQueries.insert, params: [
                passkeyId,
                passkey.parentItemId.uuidString.uppercased(),
                passkey.rpId,
                userHandleParam,
                publicKeyString,
                privateKeyString,
                prfKeyParam,
                passkey.displayName,
                now,
                now,
                0
            ])

            return passkeyId
        }
    }

    /// Soft delete a passkey.
    /// - Parameter passkeyId: The ID of the passkey to delete
    /// - Returns: Number of rows affected
    @discardableResult
    public func delete(_ passkeyId: String) throws -> Int {
        return try withTransaction {
            let now = self.now()
            return try client.executeUpdate(PasskeyQueries.softDelete, params: [now, passkeyId])
        }
    }

    /// Update a passkey's display name.
    /// - Parameters:
    ///   - passkeyId: The ID of the passkey to update
    ///   - displayName: The new display name
    /// - Returns: Number of rows affected
    @discardableResult
    public func updateDisplayName(_ passkeyId: String, displayName: String) throws -> Int {
        return try withTransaction {
            let now = self.now()
            return try client.executeUpdate(PasskeyQueries.updateDisplayName, params: [displayName, now, passkeyId])
        }
    }

    /// Replace an existing passkey with a new one, optionally updating the item's logo.
    /// Deletes the old passkey and creates a new one linked to the same item.
    /// - Parameters:
    ///   - oldPasskeyId: The ID of the passkey to replace
    ///   - newPasskey: The new passkey to create
    ///   - displayName: The display name for the new passkey
    ///   - logo: Optional logo data to update
    /// - Returns: The ID of the new passkey
    @discardableResult
    public func replace(oldPasskeyId: String, with newPasskey: Passkey, displayName: String, logo: Data? = nil) throws -> String {
        return try withTransaction {
            let now = self.now()

            // Update logo if provided
            if let logo = logo {
                try updateItemLogoInternal(
                    itemId: newPasskey.parentItemId.uuidString.uppercased(),
                    logo: logo,
                    rpId: newPasskey.rpId,
                    now: now
                )
            }

            // Delete the old passkey
            try client.executeUpdate(PasskeyQueries.softDelete, params: [now, oldPasskeyId])

            // Create the new passkey
            let newPasskeyId = newPasskey.id.uuidString.uppercased()

            guard let publicKeyString = String(data: newPasskey.publicKey, encoding: .utf8),
                  let privateKeyString = String(data: newPasskey.privateKey, encoding: .utf8) else {
                throw PasskeyRepositoryError.invalidKeyData
            }

            let userHandleParam: SqliteBindValue = newPasskey.userHandle.map { "av-base64-to-blob:\($0.base64EncodedString())" }
            let prfKeyParam: SqliteBindValue = newPasskey.prfKey.map { "av-base64-to-blob:\($0.base64EncodedString())" }

            try client.executeUpdate(PasskeyQueries.insert, params: [
                newPasskeyId,
                newPasskey.parentItemId.uuidString.uppercased(),
                newPasskey.rpId,
                userHandleParam,
                publicKeyString,
                privateKeyString,
                prfKeyParam,
                displayName,
                now,
                now,
                0
            ])

            return newPasskeyId
        }
    }

    // MARK: - Item + Passkey Creation

    /// Create an item with a passkey (for passkey registration).
    /// This creates an Item record with field values and links the passkey to it.
    /// - Parameters:
    ///   - rpId: The relying party identifier (domain)
    ///   - userName: Optional username
    ///   - displayName: Display name for the item
    ///   - passkey: The passkey to create
    ///   - logo: Optional logo data
    /// - Returns: The created item ID
    @discardableResult
    public func createItemWithPasskey(
        rpId: String,
        userName: String?,
        displayName: String,
        passkey: Passkey,
        logo: Data? = nil
    ) throws -> String {
        return try withTransaction {
            let itemId = passkey.parentItemId.uuidString.uppercased()
            let now = self.now()

            // Create or reuse logo if provided
            var logoId: String?
            if let logo = logo {
                let source = rpId.lowercased().replacingOccurrences(of: "www.", with: "")
                logoId = try getOrCreateLogo(source: source, logoData: logo, now: now)
            }

            // Create the Item
            try client.executeUpdate(ItemQueries.insertItem, params: [
                itemId,
                displayName as SqliteBindValue,
                ItemType.login,
                logoId as SqliteBindValue,
                nil, // FolderId
                now,
                now,
                0
            ])

            // Create field values - login.url
            let urlFieldId = generateId()
            try client.executeUpdate(FieldValueQueries.insert, params: [
                urlFieldId,
                itemId,
                nil, // FieldDefinitionId
                FieldKey.loginUrl,
                "https://\(rpId)",
                0, // Weight
                now,
                now,
                0
            ])

            // Create field values - login.username if provided
            if let userName = userName, !userName.isEmpty {
                let usernameFieldId = generateId()
                try client.executeUpdate(FieldValueQueries.insert, params: [
                    usernameFieldId,
                    itemId,
                    nil, // FieldDefinitionId
                    FieldKey.loginUsername,
                    userName,
                    0, // Weight
                    now,
                    now,
                    0
                ])
            }

            // Create the passkey
            guard let publicKeyString = String(data: passkey.publicKey, encoding: .utf8),
                  let privateKeyString = String(data: passkey.privateKey, encoding: .utf8) else {
                throw PasskeyRepositoryError.invalidKeyData
            }

            let userHandleParam: SqliteBindValue = passkey.userHandle.map { "av-base64-to-blob:\($0.base64EncodedString())" }
            let prfKeyParam: SqliteBindValue = passkey.prfKey.map { "av-base64-to-blob:\($0.base64EncodedString())" }

            try client.executeUpdate(PasskeyQueries.insert, params: [
                passkey.id.uuidString.uppercased(),
                itemId,
                passkey.rpId,
                userHandleParam,
                publicKeyString,
                privateKeyString,
                prfKeyParam,
                passkey.displayName,
                now,
                now,
                0
            ])

            return itemId
        }
    }

    /// Update item logo.
    /// Note: This only updates the logo, NOT the item name.
    /// - Parameters:
    ///   - itemId: The item ID
    ///   - logo: The new logo data
    ///   - rpId: The relying party ID for logo source
    public func updateItemLogo(itemId: String, logo: Data, rpId: String) throws {
        try withTransaction {
            let now = self.now()
            try updateItemLogoInternal(itemId: itemId, logo: logo, rpId: rpId, now: now)
        }
    }

    /// Internal helper to update item logo without creating a transaction.
    /// Used within larger transactions to avoid nested transaction issues.
    /// Note: This only updates the logo, never the item name.
    /// - Parameters:
    ///   - itemId: The item ID
    ///   - logo: The new logo data
    ///   - rpId: The relying party ID for logo source (used when creating new logo)
    ///   - now: The current timestamp
    private func updateItemLogoInternal(
        itemId: String,
        logo: Data,
        rpId: String,
        now: String
    ) throws {
        // Get current logo ID from item
        let itemResults = try client.executeQuery(
            "SELECT LogoId FROM Items WHERE Id = ?",
            params: [itemId]
        )

        let logoDataParam = "av-base64-to-blob:\(logo.base64EncodedString())"

        if let existingLogoId = itemResults.first?["LogoId"] as? String {
            // Update existing logo
            try client.executeUpdate(LogoQueries.updateFileData, params: [
                logoDataParam,
                now,
                existingLogoId
            ])
        } else {
            // Create or reuse logo with unique source check
            let source = rpId.lowercased().replacingOccurrences(of: "www.", with: "")
            let newLogoId = try getOrCreateLogo(source: source, logoData: logo, now: now)

            // Update item with new logo ID
            try client.executeUpdate(
                "UPDATE Items SET LogoId = ?, UpdatedAt = ? WHERE Id = ?",
                params: [newLogoId, now, itemId]
            )
        }
    }

    /// Add a passkey to an existing Item (merge passkey into existing credential).
    /// - Parameters:
    ///   - itemId: The UUID of the existing Item to add the passkey to
    ///   - passkey: The passkey to add
    ///   - logo: Optional logo data to update/add
    /// - Returns: The ID of the created passkey
    @discardableResult
    public func addPasskeyToExistingItem(
        itemId: UUID,
        passkey: Passkey,
        logo: Data? = nil
    ) throws -> String {
        return try withTransaction {
            let itemIdString = itemId.uuidString.uppercased()
            let now = self.now()

            // Update logo if provided
            if let logo = logo {
                try updateItemLogoInternal(
                    itemId: itemIdString,
                    logo: logo,
                    rpId: passkey.rpId,
                    now: now
                )
            }

            // Create the passkey linked to the existing item
            let passkeyId = passkey.id.uuidString.uppercased()

            guard let publicKeyString = String(data: passkey.publicKey, encoding: .utf8),
                  let privateKeyString = String(data: passkey.privateKey, encoding: .utf8) else {
                throw PasskeyRepositoryError.invalidKeyData
            }

            let userHandleParam: SqliteBindValue = passkey.userHandle.map { "av-base64-to-blob:\($0.base64EncodedString())" }
            let prfKeyParam: SqliteBindValue = passkey.prfKey.map { "av-base64-to-blob:\($0.base64EncodedString())" }

            try client.executeUpdate(PasskeyQueries.insert, params: [
                passkeyId,
                itemIdString,
                passkey.rpId,
                userHandleParam,
                publicKeyString,
                privateKeyString,
                prfKeyParam,
                passkey.displayName,
                now,
                now,
                0
            ])

            return passkeyId
        }
    }

    // MARK: - Helper Methods

    /// Get an existing logo ID for a source, or create a new logo if none exists.
    /// This prevents UNIQUE constraint violations on Logos.Source.
    /// - Parameters:
    ///   - source: The normalized source domain (e.g., 'github.com')
    ///   - logoData: The logo image data
    ///   - now: The current timestamp for CreatedAt/UpdatedAt
    /// - Returns: The logo ID (existing or newly created)
    private func getOrCreateLogo(source: String, logoData: Data, now: String) throws -> String {
        // Check if a logo for this source already exists
        let existingLogos = try client.executeQuery(
            "SELECT Id, IsDeleted FROM Logos WHERE Source = ? LIMIT 1",
            params: [source]
        )

        if let existingLogo = existingLogos.first,
           let existingLogoId = existingLogo["Id"] as? String {
            let isDeleted = (existingLogo["IsDeleted"] as? Int64) == 1

            // Sanity check: restore if soft-deleted
            if isDeleted {
                try client.executeUpdate(
                    "UPDATE Logos SET IsDeleted = 0, UpdatedAt = ? WHERE Id = ?",
                    params: [now, existingLogoId]
                )
            }
            return existingLogoId
        }

        // Create new logo entry
        let logoId = generateId()
        let logoDataParam = "av-base64-to-blob:\(logoData.base64EncodedString())"

        try client.executeUpdate(LogoQueries.insert, params: [
            logoId,
            source,
            logoDataParam,
            "image/png",
            nil,
            now,
            now,
            0
        ])

        return logoId
    }
}

/// Data class to hold Item info for Items without passkeys (internal VaultStoreKit type).
/// Used for showing existing credentials that can have a passkey added.
/// Note: VaultUI has its own ItemWithCredentialInfo type for UI usage.
public struct ItemWithCredentialInfoData {
    public let itemId: UUID
    public let serviceName: String?
    public let url: String?
    /// All URLs associated with this item (supports multi-value URL fields)
    public let urls: [String]
    public let username: String?
    public let hasPassword: Bool
    public let createdAt: Date
    public let updatedAt: Date

    public init(itemId: UUID, serviceName: String?, url: String?, username: String?, hasPassword: Bool, createdAt: Date, updatedAt: Date) {
        self.itemId = itemId
        self.serviceName = serviceName
        self.url = url
        self.urls = url.map { [$0] } ?? []
        self.username = username
        self.hasPassword = hasPassword
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public init(itemId: UUID, serviceName: String?, urls: [String], username: String?, hasPassword: Bool, createdAt: Date, updatedAt: Date) {
        self.itemId = itemId
        self.serviceName = serviceName
        self.url = urls.first
        self.urls = urls
        self.username = username
        self.hasPassword = hasPassword
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// Errors that can occur in PasskeyRepository operations.
public enum PasskeyRepositoryError: Error {
    case invalidKeyData
    case passkeyNotFound
    case itemNotFound
}
