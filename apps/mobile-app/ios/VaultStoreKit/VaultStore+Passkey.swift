import Foundation
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
     * Get all passkeys for an item.
     */
    public func getPasskeys(forItemId itemId: UUID, manifestId: String) throws -> [Passkey] {
        return try passkeyRepository.getByItemId(itemId.uuidString.lowercased(), manifestId: manifestId)
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
    public func getPasskeysWithCredentialInfo(forRpId rpId: String, userName: String? = nil, userId: Data? = nil) throws -> [PasskeyWithItemInfo] {
        return try passkeyRepository.getWithItemInfo(forRpId: rpId, userName: userName, userId: userId)
    }

    /**
     * Get Items that match an rpId but don't have a passkey yet.
     * Used for finding existing credentials that could have a passkey added to them.
     * Uses the Rust credential matcher for consistent cross-platform matching logic.
     */
    public func getItemsWithoutPasskey(forRpId rpId: String, userName: String? = nil) throws -> [ItemWithCredentialInfoData] {
        // Get all items without passkeys
        let allItems = try passkeyRepository.getAllItemsWithoutPasskey()

        // Use Rust item matcher for intelligent filtering
        var matchedItems = RustItemMatcher.filterItemsWithData(allItems, rpId: rpId)

        // Apply optional username filter
        if let userName = userName {
            matchedItems = matchedItems.filter { $0.username == userName }
        }

        return matchedItems
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
     * Replace an existing passkey with a new one
     * This deletes the old passkey and creates a new one with the same item, in the same manifest
     */
    public func replacePasskey(oldPasskeyId: UUID, manifestId: String, newPasskey: Passkey, displayName: String, logo: Data? = nil) throws {
        // Get the old passkey to find its item
        guard let oldPasskey = try passkeyRepository.getById(oldPasskeyId.uuidString.lowercased(), manifestId: manifestId) else {
            throw VaultStoreError.passkeyNotFound
        }

        // Create the new passkey with the same item ID, in the same manifest
        let updatedPasskey = Passkey(
            id: newPasskey.id,
            parentItemId: oldPasskey.parentItemId,
            rpId: newPasskey.rpId,
            userHandle: newPasskey.userHandle,
            userName: newPasskey.userName,
            publicKey: newPasskey.publicKey,
            privateKey: newPasskey.privateKey,
            prfKey: newPasskey.prfKey,
            displayName: displayName,
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false,
            manifestId: manifestId
        )

        // Replace the passkey (handles logo update in same transaction)
        try passkeyRepository.replace(
            oldPasskeyId: oldPasskeyId.uuidString.lowercased(),
            manifestId: manifestId,
            with: updatedPasskey,
            displayName: displayName,
            logo: logo
        )
    }

    /**
     * Add a passkey to an existing Item (merge passkey into existing credential).
     * @param itemId The UUID of the existing Item to add the passkey to.
     * @param manifestId The manifest the item belongs to.
     * @param passkey The passkey to add.
     * @param logo Optional logo to update/add.
     */
    public func addPasskeyToExistingItem(
        itemId: UUID,
        manifestId: String,
        passkey: Passkey,
        logo: Data? = nil
    ) throws {
        // Create the passkey with the existing item ID, in that item's manifest
        let passkeyWithItemId = Passkey(
            id: passkey.id,
            parentItemId: itemId,
            rpId: passkey.rpId,
            userHandle: passkey.userHandle,
            userName: passkey.userName,
            publicKey: passkey.publicKey,
            privateKey: passkey.privateKey,
            prfKey: passkey.prfKey,
            displayName: passkey.displayName,
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false,
            manifestId: manifestId
        )

        try passkeyRepository.addPasskeyToExistingItem(
            itemId: itemId,
            manifestId: manifestId,
            passkey: passkeyWithItemId,
            logo: logo
        )
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
