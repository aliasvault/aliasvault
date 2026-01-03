import Foundation
import SQLite
import VaultModels
import VaultUtils

/**
 * VaultStore+Passkey
 * Extension to VaultStore for passkey operations.
 * Delegates to PasskeyRepository for database operations.
 */
extension VaultStore {

    // MARK: - Passkey Queries (Public API)

    /**
     * Get a passkey by its credential ID (the WebAuthn credential ID, not the parent Credential UUID)
     */
    public func getPasskey(byCredentialId credentialId: Data) throws -> Passkey? {
        // Convert credentialId bytes to a UUID string for lookup
        guard let credentialIdString = try? PasskeyHelper.bytesToGuid(credentialId) else {
            print("VaultStore+Passkey: Failed to convert credentialId bytes to UUID string")
            return nil
        }
        return try passkeyRepository.getById(credentialIdString)
    }

    /**
     * Get all passkeys for an item (new model)
     */
    public func getPasskeys(forItemId itemId: UUID) throws -> [Passkey] {
        return try passkeyRepository.getByItemId(itemId.uuidString.uppercased())
    }

    /**
     * Get all passkeys for a credential (legacy alias for backwards compatibility)
     */
    public func getPasskeys(forCredentialId credentialId: UUID) throws -> [Passkey] {
        return try getPasskeys(forItemId: credentialId)
    }

    /**
     * Get all passkeys for a specific relying party identifier (RP ID)
     */
    public func getPasskeys(forRpId rpId: String) throws -> [Passkey] {
        return try passkeyRepository.getByRpId(rpId)
    }

    /**
     * Get passkeys with item info for a specific rpId and optionally username
     * Used for finding existing passkeys that might be replaced during registration
     */
    public func getPasskeysWithCredentialInfo(forRpId rpId: String, userName: String? = nil, userId: Data? = nil) throws -> [(passkey: Passkey, serviceName: String?, username: String?)] {
        let results = try passkeyRepository.getWithItemInfo(forRpId: rpId, userName: userName, userId: userId)
        return results.map { (passkey: $0.passkey, serviceName: $0.serviceName, username: $0.username) }
    }

    // MARK: - Passkey Storage (Public API)

    /**
     * Create an item with a passkey (for passkey registration)
     * This creates an Item record with field values and links the passkey to it
     */
    @discardableResult
    public func createItemWithPasskey(
        rpId: String,
        userName: String?,
        displayName: String,
        passkey: Passkey,
        logo: Data? = nil
    ) throws -> UUID {
        let itemIdString = try passkeyRepository.createItemWithPasskey(
            rpId: rpId,
            userName: userName,
            displayName: displayName,
            passkey: passkey,
            logo: logo
        )

        // Return the created item ID
        guard let itemId = UUID(uuidString: itemIdString) else {
            throw VaultStoreError.databaseError("Invalid item ID returned")
        }

        return itemId
    }

    /**
     * Insert a new passkey into the database
     */
    public func insertPasskey(_ passkey: Passkey) throws {
        try passkeyRepository.create(passkey)
    }

    /**
     * Replace an existing passkey with a new one
     * This deletes the old passkey and creates a new one with the same item
     */
    public func replacePasskey(oldPasskeyId: UUID, newPasskey: Passkey, displayName: String, logo: Data? = nil) throws {
        // Get the old passkey to find its item
        guard let oldPasskey = try passkeyRepository.getById(oldPasskeyId.uuidString.uppercased()) else {
            throw VaultStoreError.passkeyNotFound
        }

        let itemId = oldPasskey.parentItemId

        // Update logo if provided
        if let logo = logo {
            try passkeyRepository.updateItemLogo(
                itemId: itemId.uuidString.uppercased(),
                logo: logo,
                displayName: displayName
            )
        }

        // Create the new passkey with the same item ID
        let updatedPasskey = Passkey(
            id: newPasskey.id,
            parentItemId: itemId,  // Use the old item ID
            rpId: newPasskey.rpId,
            userHandle: newPasskey.userHandle,
            userName: newPasskey.userName,
            publicKey: newPasskey.publicKey,
            privateKey: newPasskey.privateKey,
            prfKey: newPasskey.prfKey,
            displayName: displayName,
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false
        )

        try passkeyRepository.replace(
            oldPasskeyId: oldPasskeyId.uuidString.uppercased(),
            with: updatedPasskey,
            displayName: displayName
        )
    }
}

/**
 * VaultStore errors
 */
public enum VaultStoreError: Error {
    case vaultNotUnlocked
    case passkeyNotFound
    case itemNotFound
    case databaseError(String)
}
