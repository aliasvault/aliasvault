import Foundation
import RustCoreFramework
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
    /// - Parameters:
    ///   - itemId: The item ID (UUID string)
    ///   - manifestId: The manifest the item belongs to, when the caller knows it
    /// - Returns: Array of Passkey objects
    public func getByItemId(_ itemId: String, manifestId: String? = nil) throws -> [Passkey] {
        guard let scope = try manifestId ?? resolveRowManifestId(table: "Items", id: itemId) else {
            return []
        }
        let results = try client.executeQuery(PasskeyQueries.getByItemId, params: [itemId, scope])
        return PasskeyMapper.mapRows(results.compactMap { PasskeyRow(from: $0) })
    }

    /// Get all passkeys for a relying party (rpId).
    /// - Parameter rpId: The relying party identifier (domain)
    /// - Returns: Array of Passkey objects
    public func getByRpId(_ rpId: String) throws -> [Passkey] {
        let results = try client.executeQuery(PasskeyQueries.getByRpId, params: [rpId])
        return PasskeyMapper.mapRows(results.compactMap { PasskeyRow(from: $0) })
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

        return results.compactMap { row -> ItemWithCredentialInfoData? in
            let item = mapItemWithCredentialInfo(row, urls: (row["Url"] as? String).map { [$0] } ?? [])
            if let userName = userName, item?.username != userName {
                return nil
            }
            return item
        }
    }

    /// Get ALL Login items that don't have a passkey yet (no URL filtering).
    /// Used with RustItemMatcher for intelligent, cross-platform consistent filtering.
    /// - Returns: Array of ItemWithCredentialInfoData objects with all URLs
    public func getAllItemsWithoutPasskey() throws -> [ItemWithCredentialInfoData] {
        let results = try client.executeQuery(PasskeyQueries.getAllItemsWithoutPasskey, params: [])

        return results.compactMap { row -> ItemWithCredentialInfoData? in
            let urls = (row["Urls"] as? String)?.components(separatedBy: ",").filter { !$0.isEmpty } ?? []
            return mapItemWithCredentialInfo(row, urls: urls)
        }
    }

    /// Map one row of the without-passkey queries.
    private func mapItemWithCredentialInfo(_ row: [String: Any], urls: [String]) -> ItemWithCredentialInfoData? {
        guard let idString = row["Id"] as? String, let itemId = UUID(uuidString: idString) else {
            return nil
        }

        let password = row["Password"] as? String
        return ItemWithCredentialInfoData(
            itemId: itemId,
            serviceName: row["Name"] as? String,
            urls: urls,
            username: row["Username"] as? String,
            email: row["Email"] as? String,
            hasPassword: !(password ?? "").isEmpty,
            createdAt: DateHelpers.parseDateString(row["CreatedAt"] as? String ?? "") ?? Date.distantPast,
            updatedAt: DateHelpers.parseDateString(row["UpdatedAt"] as? String ?? "") ?? Date.distantPast,
            manifestId: row["ManifestId"] as? String
        )
    }

    // MARK: - Write Operations

    /// Create a new passkey. The manifest is read from the item the passkey hangs off.
    /// - Parameter passkey: The passkey to create
    @discardableResult
    public func create(_ passkey: Passkey) throws -> String {
        return try withTransaction {
            try insertPasskey(passkey, itemId: passkey.parentItemId.uuidString.lowercased(), displayName: passkey.displayName, now: self.now())
        }
    }

    /// Soft delete a passkey.
    /// - Parameters:
    ///   - passkeyId: The ID of the passkey to delete
    ///   - manifestId: The manifest the passkey belongs to, when the caller knows it
    /// - Returns: Number of rows affected
    @discardableResult
    public func delete(_ passkeyId: String, manifestId: String? = nil) throws -> Int {
        return try withTransaction {
            guard let scope = try manifestId ?? resolveRowManifestId(table: "Passkeys", id: passkeyId) else {
                return 0
            }
            return try client.executeUpdate(PasskeyQueries.softDelete, params: [self.now(), passkeyId, scope])
        }
    }

    /// Update a passkey's display name.
    /// - Parameters:
    ///   - passkeyId: The ID of the passkey to update
    ///   - displayName: The new display name
    ///   - manifestId: The manifest the passkey belongs to, when the caller knows it
    /// - Returns: Number of rows affected
    @discardableResult
    public func updateDisplayName(_ passkeyId: String, displayName: String, manifestId: String? = nil) throws -> Int {
        return try withTransaction {
            guard let scope = try manifestId ?? resolveRowManifestId(table: "Passkeys", id: passkeyId) else {
                return 0
            }
            return try client.executeUpdate(PasskeyQueries.updateDisplayName, params: [displayName, self.now(), passkeyId, scope])
        }
    }

    /// Replace an existing passkey with a new one, optionally refreshing the item's logo.
    /// Soft deletes the old passkey and creates a new one linked to the same item, in that item's manifest.
    /// - Parameters:
    ///   - oldPasskeyId: The ID of the passkey to replace
    ///   - newPasskey: The new passkey to create
    ///   - displayName: The display name for the new passkey
    ///   - logo: Optional favicon bytes fetched for the passkey's rpId
    /// - Returns: The ID of the new passkey
    @discardableResult
    public func replace(oldPasskeyId: String, with newPasskey: Passkey, displayName: String, logo: Data? = nil) throws -> String {
        return try withTransaction {
            guard let scope = try newPasskey.manifestId ?? resolveRowManifestId(table: "Passkeys", id: oldPasskeyId) else {
                throw PasskeyRepositoryError.passkeyNotFound
            }

            let now = self.now()
            let itemId = newPasskey.parentItemId.uuidString.lowercased()

            if let logo = logo {
                try refreshItemLogo(itemId: itemId, manifestId: scope, rpId: newPasskey.rpId, logo: logo, now: now)
            }

            try client.executeUpdate(PasskeyQueries.softDelete, params: [now, oldPasskeyId, scope])
            return try insertPasskey(newPasskey, itemId: itemId, displayName: displayName, now: now)
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
    ///   - logo: Optional favicon bytes fetched for the rpId
    /// - Returns: The created item ID
    @discardableResult
    public func createItemWithPasskey(rpId: String, userName: String?, displayName: String, passkey: Passkey, logo: Data? = nil) throws -> String {
        return try withTransaction {
            let itemId = passkey.parentItemId.uuidString.lowercased()
            let now = self.now()

            // An item outside any folder lands in the write manifest, which is the scope its logo has to live in too.
            let scope = try writeManifestId()
            let logoId = try resolveLogoId(existingLogoId: nil, manifestId: scope, rpId: rpId, logo: logo, now: now)

            try client.executeUpdate(ItemQueries.insertItem, params: [itemId, displayName as SqliteBindValue, ItemType.login, logoId as SqliteBindValue, nil, now, now, 0, nil, scope])

            try insertSystemField(itemId: itemId, fieldKey: FieldKey.loginUrl, value: "https://\(rpId)", manifestId: scope, now: now)
            if let userName = userName, !userName.isEmpty {
                try insertSystemField(itemId: itemId, fieldKey: FieldKey.loginUsername, value: userName, manifestId: scope, now: now)
            }

            _ = try insertPasskey(passkey, itemId: itemId, displayName: passkey.displayName, now: now)
            return itemId
        }
    }

    /// Refresh an item's logo from a freshly fetched favicon. Only the logo is touched, never the item name.
    /// - Parameters:
    ///   - itemId: The item ID
    ///   - logo: The favicon bytes
    ///   - rpId: The relying party ID the favicon was fetched for
    public func updateItemLogo(itemId: String, logo: Data, rpId: String) throws {
        try withTransaction {
            guard let scope = try resolveRowManifestId(table: "Items", id: itemId) else {
                throw PasskeyRepositoryError.itemNotFound
            }
            try refreshItemLogo(itemId: itemId, manifestId: scope, rpId: rpId, logo: logo, now: self.now())
        }
    }

    /// Add a passkey to an existing Item (merge passkey into existing credential).
    /// - Parameters:
    ///   - itemId: The UUID of the existing Item to add the passkey to
    ///   - passkey: The passkey to add
    ///   - logo: Optional favicon bytes fetched for the passkey's rpId
    /// - Returns: The ID of the created passkey
    @discardableResult
    public func addPasskeyToExistingItem(itemId: UUID, passkey: Passkey, logo: Data? = nil) throws -> String {
        return try withTransaction {
            let itemIdString = itemId.uuidString.lowercased()
            guard let scope = try resolveRowManifestId(table: "Items", id: itemIdString) else {
                throw PasskeyRepositoryError.itemNotFound
            }

            let now = self.now()
            if let logo = logo {
                try refreshItemLogo(itemId: itemIdString, manifestId: scope, rpId: passkey.rpId, logo: logo, now: now)
            }

            return try insertPasskey(passkey, itemId: itemIdString, displayName: passkey.displayName, now: now)
        }
    }

    // MARK: - Row Helpers

    /// Base64 text the query bridge binds as a BLOB, or nil.
    private func blobParam(_ data: Data?) -> SqliteBindValue {
        return data.map { "av-base64-to-blob:\($0.base64EncodedString())" }
    }

    /// Insert one system field value for an item.
    private func insertSystemField(itemId: String, fieldKey: String, value: String, manifestId: String, now: String) throws {
        let weight = FieldValueQueries.defaultWeight(forFieldKey: fieldKey)
        try client.executeUpdate(FieldValueQueries.insert, params: [generateId(), itemId, nil, fieldKey, value, weight, now, now, 0, itemId, manifestId])
    }

    /// Insert a passkey row linked to an item, stamped with the item's manifest.
    /// - Returns: The passkey ID
    private func insertPasskey(_ passkey: Passkey, itemId: String, displayName: String, now: String) throws -> String {
        let passkeyId = passkey.id.uuidString.lowercased()
        guard let publicKeyString = String(data: passkey.publicKey, encoding: .utf8), let privateKeyString = String(data: passkey.privateKey, encoding: .utf8) else {
            throw PasskeyRepositoryError.invalidKeyData
        }

        let fallbackManifestId = try writeManifestId()
        try client.executeUpdate(PasskeyQueries.insert, params: [
            passkeyId,
            itemId,
            itemId,
            fallbackManifestId,
            passkey.rpId,
            blobParam(passkey.userHandle),
            publicKeyString,
            privateKeyString,
            blobParam(passkey.prfKey),
            displayName,
            passkey.additionalData as SqliteBindValue,
            now,
            now,
            0
        ])

        return passkeyId
    }

    // MARK: - Logo Helpers

    /// The natural key a logo row is addressed by, and the manifest it lives in.
    private struct LogoKey {
        let manifestId: String
        let kind: String
        let source: String
    }

    /// The image bytes and metadata written into a logo row.
    private struct LogoImage {
        let data: Data?
        let mimeType: String?
        let name: String?
    }

    /// The kind and key of an existing logo, or nil when it no longer exists.
    private func getLogo(byId logoId: String) throws -> (kind: String, source: String)? {
        guard let row = try client.executeQuery(LogoQueries.getById, params: [logoId]).first, let kind = row["Kind"] as? String, let source = row["Source"] as? String else {
            return nil
        }
        return (kind, source)
    }

    /// Point an item at the favicon fetched for `rpId`, following the item-logo write rules in core/client
    /// `ItemRepository.resolveLogoId`.
    private func refreshItemLogo(itemId: String, manifestId: String, rpId: String, logo: Data, now: String) throws {
        let rows = try client.executeQuery(LogoQueries.getLogoIdFromItem, params: [itemId, manifestId])
        let existingLogoId = rows.first?["LogoId"] as? String

        guard let logoId = try resolveLogoId(existingLogoId: existingLogoId, manifestId: manifestId, rpId: rpId, logo: logo, now: now), logoId != existingLogoId else {
            return
        }
        try client.executeUpdate(LogoQueries.updateItemLogoId, params: [logoId, now, itemId, manifestId])
    }

    /// The logo id an item should carry after a favicon was fetched for `rpId` (core/client `ItemRepository.resolveLogoId`):
    /// a built-in or uploaded logo the user chose is kept, a favicon already on file for this domain is reused, fresh
    /// bytes go under the domain's own row, and without a derivable domain the logo is left as it is.
    private func resolveLogoId(existingLogoId: String?, manifestId: String, rpId: String, logo: Data?, now: String) throws -> String? {
        let existing = try existingLogoId.flatMap { try getLogo(byId: $0) }
        if let existing = existing, existing.kind != "favicon" {
            return try adoptIntoScope(LogoKey(manifestId: manifestId, kind: existing.kind, source: existing.source), now: now)
        }

        // The same URL string the item's login.url field is written with, which is what the TypeScript side derives the favicon target from.
        let source = RustCoreFramework.faviconSourceKey(url: "https://\(rpId)")
        if source.isEmpty {
            return existingLogoId
        }

        let key = LogoKey(manifestId: manifestId, kind: "favicon", source: source)
        if let existing = existing, existing.source == source {
            return try adoptIntoScope(key, now: now)
        }
        if let logo = logo, !logo.isEmpty {
            return try getOrCreateLogo(key, image: LogoImage(data: logo, mimeType: "image/x-icon", name: nil), now: now)
        }
        return try adoptIntoScope(key, now: now)
    }

    /// Get or create the logo for a key inside one manifest, refreshing its image data.
    /// The row's stamp and the id derived for it come from the same manifest.
    private func getOrCreateLogo(_ key: LogoKey, image: LogoImage, now: String) throws -> String {
        let logoId = RustCoreFramework.vaultCodecLogoIdFor(manifestId: key.manifestId, kind: key.kind, source: key.source)
        let params: [SqliteBindValue] = [logoId, key.kind, key.source, key.manifestId, blobParam(image.data), image.mimeType, image.name, now, now]
        try client.executeUpdate(LogoQueries.upsert, params: params)
        return logoId
    }

    /// The id this logo has inside the key's manifest, copying it in from another manifest when it is not there yet.
    /// - Returns: The logo id inside this manifest, or nil when the vault holds no such logo at all
    private func adoptIntoScope(_ key: LogoKey, now: String) throws -> String? {
        let inScope = try client.executeQuery(LogoQueries.getIdForKey, params: [key.manifestId, key.kind, key.source])
        if let logoId = inScope.first?["Id"] as? String {
            return logoId
        }

        guard let origin = try client.executeQuery(LogoQueries.getBestForKey, params: [key.kind, key.source]).first else {
            return nil
        }
        let data = (origin["FileData"] as? String).flatMap { Data(base64Encoded: $0) }
        return try getOrCreateLogo(key, image: LogoImage(data: data, mimeType: origin["MimeType"] as? String, name: origin["Name"] as? String), now: now)
    }
}
