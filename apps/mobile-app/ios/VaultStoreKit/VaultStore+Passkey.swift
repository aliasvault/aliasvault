import Foundation
import RustCoreFramework
import VaultModels
import VaultUtils

/// A passkey with the name and account of the item it belongs to.
public struct PasskeyWithItem {
    /// The passkey.
    public let passkey: Passkey
    /// The item name.
    public let serviceName: String?
    /// The item's login.username value, if any.
    public let username: String?
    /// The item's login.email value, if any.
    public let email: String?
}

/// A Login item without a passkey that a new passkey could be added to.
public struct ItemWithCredentialInfoData {
    /// The item id.
    public let itemId: UUID
    /// The item name.
    public let serviceName: String?
    /// All login.url values of the item.
    public let urls: [String]
    /// The login.username value, if any.
    public let username: String?
    /// The login.email value, if any.
    public let email: String?
    /// Whether the item has a non-empty password.
    public let hasPassword: Bool
    /// When the item was created.
    public let createdAt: Date
    /// When the item was last updated.
    public let updatedAt: Date
    /// The manifest the item lives in.
    public let manifestId: String
}

/**
 * VaultStore+Passkey
 * Passkey reads and writes, run by the Rust core on the open vault database.
 * Other platform implementations: VaultPasskey.kt (Android).
 */
extension VaultStore {

    // MARK: - Passkey Queries (Public API)

    /// Get a passkey by its WebAuthn credential ID (not the parent item id), in any manifest.
    public func getPasskey(byCredentialId credentialId: Data) throws -> Passkey? {
        guard let credentialIdString = try? PasskeyAuthenticator.bytesToGuid(credentialId) else {
            print("VaultStore+Passkey: Failed to convert credentialId bytes to UUID string")
            return nil
        }
        return try requireDatabase().getPasskeyById(passkeyId: credentialIdString).flatMap { Self.passkey(from: $0.passkey) }
    }

    /// Get all passkeys for an item.
    public func getPasskeys(forItemId itemId: UUID, manifestId: String) throws -> [Passkey] {
        return try requireDatabase().getPasskeysForItem(itemId: itemId.uuidString.lowercased(), manifestId: manifestId).compactMap(Self.passkey(from:))
    }

    /// Get passkeys with item info for an rpId, narrowed to an account when a user name or handle is given.
    /// Used for finding existing passkeys that might be replaced during registration.
    public func getPasskeysWithCredentialInfo(forRpId rpId: String, userName: String? = nil, userId: Data? = nil) throws -> [PasskeyWithItem] {
        return try requireDatabase().getPasskeysForRpId(rpId: rpId, userName: userName, userHandle: userId).compactMap { row in
            Self.passkey(from: row.passkey).map { PasskeyWithItem(passkey: $0, serviceName: row.serviceName, username: row.username, email: row.email) }
        }
    }

    /// Get the Login items without a passkey that match an rpId, best match first, which a new passkey could be added to.
    public func getItemsWithoutPasskey(forRpId rpId: String, userName: String? = nil) throws -> [ItemWithCredentialInfoData] {
        return try requireDatabase().getItemsWithoutPasskeyForRpId(rpId: rpId, rpName: nil, userName: userName).compactMap { row in
            guard let itemId = UUID(uuidString: row.itemId) else { return nil }
            return ItemWithCredentialInfoData(
                itemId: itemId,
                serviceName: row.serviceName,
                urls: row.urls,
                username: row.username,
                email: row.email,
                hasPassword: row.hasPassword,
                createdAt: Self.date(row.createdAtMs),
                updatedAt: Self.date(row.updatedAtMs),
                manifestId: row.manifestId
            )
        }
    }

    // MARK: - Passkey Storage (Public API)

    /// Create a Login item in the personal manifest holding a new passkey (passkey registration).
    @discardableResult
    public func createItemWithPasskey(rpId: String, userName: String?, displayName: String, passkey: Passkey, logo: Data? = nil) throws -> UUID {
        guard let manifestId = getPersonalManifestId(), !manifestId.isEmpty else {
            throw AppError.manifestNotRecorded
        }
        try withTransaction {
            try requireDatabase().createItemWithPasskey(
                manifestId: manifestId,
                itemId: passkey.parentItemId.uuidString.lowercased(),
                itemName: displayName,
                url: "https://\(rpId)",
                userName: userName,
                passkey: try Self.newPasskey(from: passkey, displayName: passkey.displayName),
                logo: logo
            )
        }
        return passkey.parentItemId
    }

    /// Replace an existing passkey with a new one on the same item, in the same manifest.
    public func replacePasskey(oldPasskeyId: UUID, manifestId: String, newPasskey: Passkey, displayName: String, logo: Data? = nil) throws {
        try withTransaction {
            _ = try requireDatabase().replacePasskey(
                oldPasskeyId: oldPasskeyId.uuidString.lowercased(),
                manifestId: manifestId,
                passkey: try Self.newPasskey(from: newPasskey, displayName: displayName),
                url: "https://\(newPasskey.rpId)",
                logo: logo
            )
        }
    }

    /// Add a passkey to an existing item (merge the passkey into an existing credential).
    public func addPasskeyToExistingItem(itemId: UUID, manifestId: String, passkey: Passkey, logo: Data? = nil) throws {
        try withTransaction {
            try requireDatabase().addPasskeyToItem(
                itemId: itemId.uuidString.lowercased(),
                manifestId: manifestId,
                passkey: try Self.newPasskey(from: passkey, displayName: passkey.displayName),
                url: "https://\(passkey.rpId)",
                logo: logo
            )
        }
    }

    // MARK: - Mapping

    /// A stored passkey as the model the authenticator works with.
    internal static func passkey(from row: VaultPasskey) -> Passkey? {
        guard let id = UUID(uuidString: row.id), let parentItemId = UUID(uuidString: row.itemId) else {
            return nil
        }
        return Passkey(
            id: id,
            parentItemId: parentItemId,
            rpId: row.rpId,
            userHandle: row.userHandle,
            userName: nil,
            publicKey: Data(row.publicKey.utf8),
            privateKey: Data(row.privateKey.utf8),
            prfKey: row.prfKey,
            displayName: row.displayName,
            createdAt: date(row.createdAtMs),
            updatedAt: date(row.updatedAtMs),
            isDeleted: false,
            manifestId: row.manifestId,
            additionalData: row.additionalData
        )
    }

    /// A passkey to write, its keys as the JWK text they are stored as.
    private static func newPasskey(from passkey: Passkey, displayName: String) throws -> NewPasskey {
        guard let publicKey = String(data: passkey.publicKey, encoding: .utf8), let privateKey = String(data: passkey.privateKey, encoding: .utf8) else {
            throw VaultStoreError.databaseError("Passkey keys are not valid JWK text")
        }
        return NewPasskey(
            id: passkey.id.uuidString.lowercased(),
            rpId: passkey.rpId,
            userHandle: passkey.userHandle,
            publicKey: publicKey,
            privateKey: privateKey,
            prfKey: passkey.prfKey,
            displayName: displayName
        )
    }

    /// A Unix-milliseconds timestamp from the Rust core as a Date.
    internal static func date(_ milliseconds: Int64) -> Date {
        return Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000)
    }
}

/**
 * VaultStore errors
 */
public enum VaultStoreError: Error {
    case vaultNotUnlocked
    case passkeyNotFound
    case databaseError(String)
}
