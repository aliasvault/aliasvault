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
                    displayName: displayName,
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

            // Create logo if provided
            var logoId: String?
            if let logo = logo {
                logoId = generateId()
                let source = rpId.lowercased().replacingOccurrences(of: "www.", with: "")
                let logoDataParam = "av-base64-to-blob:\(logo.base64EncodedString())"

                try client.executeUpdate(LogoQueries.insert, params: [
                    logoId!,
                    source,
                    logoDataParam,
                    "image/png",
                    nil,
                    now,
                    now,
                    0
                ])
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

    /// Update item logo when replacing a passkey.
    /// - Parameters:
    ///   - itemId: The item ID
    ///   - logo: The new logo data
    ///   - displayName: The new display name
    public func updateItemLogo(itemId: String, logo: Data, displayName: String) throws {
        try withTransaction {
            let now = self.now()
            try updateItemLogoInternal(itemId: itemId, logo: logo, displayName: displayName, now: now)
        }
    }

    /// Internal helper to update item logo without creating a transaction.
    /// Used within larger transactions to avoid nested transaction issues.
    /// - Parameters:
    ///   - itemId: The item ID
    ///   - logo: The new logo data
    ///   - displayName: The new display name
    ///   - now: The current timestamp
    private func updateItemLogoInternal(itemId: String, logo: Data, displayName: String, now: String) throws {
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
            // Create new logo and link to item
            let newLogoId = generateId()
            try client.executeUpdate(LogoQueries.insert, params: [
                newLogoId,
                "", // Source not needed for update
                logoDataParam,
                "image/png",
                nil,
                now,
                now,
                0
            ])

            // Update item with new logo ID
            try client.executeUpdate(
                "UPDATE Items SET LogoId = ?, UpdatedAt = ? WHERE Id = ?",
                params: [newLogoId, now, itemId]
            )
        }

        // Update item name
        try client.executeUpdate(
            "UPDATE Items SET Name = ?, UpdatedAt = ? WHERE Id = ?",
            params: [displayName, now, itemId]
        )
    }
}

/// Errors that can occur in PasskeyRepository operations.
public enum PasskeyRepositoryError: Error {
    case invalidKeyData
    case passkeyNotFound
    case itemNotFound
}
