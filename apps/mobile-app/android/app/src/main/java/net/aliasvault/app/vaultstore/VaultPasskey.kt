package net.aliasvault.app.vaultstore

import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.Passkey
import net.aliasvault.app.vaultstore.repositories.ItemWithCredentialInfo
import net.aliasvault.app.vaultstore.repositories.PasskeyRepository
import net.aliasvault.app.vaultstore.repositories.PasskeyWithCredentialInfo
import net.aliasvault.app.vaultstore.repositories.PasskeyWithItem
import java.util.UUID

/**
 * Handles passkey operations for the vault.
 * This class uses composition to organize passkey-specific functionality.
 *
 * IMPORTANT: Keep all implementations synchronized. Changes to the public interface must be
 * reflected in all ports. Method names, parameters, and behavior should remain consistent.
 */
class VaultPasskey(
    database: VaultDatabase,
) {
    private val passkeyRepository = PasskeyRepository(database)

    // region Passkey Queries

    /**
     * Get a passkey by its credential ID (the WebAuthn credential ID, not the parent Item UUID).
     */
    fun getPasskeyByCredentialId(credentialId: ByteArray): Passkey? {
        return passkeyRepository.getByCredentialId(credentialId)
    }

    /**
     * Get all passkeys for an item.
     */
    fun getPasskeysForItem(itemId: UUID): List<Passkey> {
        return passkeyRepository.getForItem(itemId)
    }

    /**
     * Get all passkeys for a specific relying party identifier (RP ID).
     */
    fun getPasskeysForRpId(rpId: String): List<Passkey> {
        return passkeyRepository.getForRpId(rpId)
    }

    /**
     * Get passkeys with item info for a specific rpId and optionally username.
     * Used for finding existing passkeys that might be replaced during registration.
     */
    fun getPasskeysWithCredentialInfo(
        rpId: String,
        userName: String? = null,
        userId: ByteArray? = null,
    ): List<PasskeyWithCredentialInfo> {
        return passkeyRepository.getWithCredentialInfo(rpId, userName, userId)
    }

    /**
     * Get Items that match an rpId but don't have a passkey yet.
     * Used for finding existing credentials that could have a passkey added to them.
     *
     * @param rpId The relying party identifier to match against the login URL.
     * @param rpName The relying party name (used for title matching fallback).
     * @param userName Optional username to filter by.
     * @return List of ItemWithCredentialInfo objects representing Items without passkeys.
     */
    fun getItemsWithoutPasskeyForRpId(
        rpId: String,
        rpName: String? = null,
        userName: String? = null,
    ): List<ItemWithCredentialInfo> {
        return passkeyRepository.getItemsWithoutPasskeyForRpId(rpId, rpName, userName)
    }

    /**
     * Get all passkeys with their associated items in a single query.
     * This is much more efficient than calling getPasskeysForItem() for each item.
     * Uses a JOIN to get passkeys and their items in one database query.
     */
    fun getAllPasskeysWithItems(): List<PasskeyWithItem> {
        return passkeyRepository.getAllWithItems()
    }

    /**
     * Get a passkey by its ID.
     */
    fun getPasskeyById(passkeyId: UUID): Passkey? {
        return passkeyRepository.getById(passkeyId)
    }

    // endregion

    // region Passkey Storage

    /**
     * Create a new item with an associated passkey.
     */
    fun createItemWithPasskey(
        rpId: String,
        userName: String?,
        displayName: String,
        passkey: Passkey,
        logo: ByteArray? = null,
    ): Item {
        return passkeyRepository.createItemWithPasskey(rpId, userName, displayName, passkey, logo)
    }

    /**
     * Insert a new passkey into the database.
     */
    fun insertPasskey(passkey: Passkey) {
        passkeyRepository.insert(passkey)
    }

    /**
     * Replace an existing passkey with a new one.
     */
    fun replacePasskey(
        oldPasskeyId: UUID,
        newPasskey: Passkey,
        displayName: String,
        logo: ByteArray? = null,
    ) {
        passkeyRepository.replace(oldPasskeyId, newPasskey, displayName, logo)
    }

    /**
     * Add a passkey to an existing Item (merge passkey into existing credential).
     *
     * @param itemId The UUID of the existing Item to add the passkey to.
     * @param passkey The passkey to add.
     * @param logo Optional logo to update/add.
     */
    fun addPasskeyToExistingItem(
        itemId: UUID,
        passkey: Passkey,
        logo: ByteArray? = null,
    ) {
        passkeyRepository.addPasskeyToExistingItem(itemId, passkey, logo)
    }

    // endregion
}

/**
 * VaultPasskey-specific errors.
 */
sealed class VaultPasskeyError(message: String) : Exception(message) {
    /**
     * Error indicating vault is not unlocked.
     */
    class VaultNotUnlocked(message: String) : VaultPasskeyError(message)

    /**
     * Error indicating passkey was not found.
     */
    class PasskeyNotFound(message: String) : VaultPasskeyError(message)

    /**
     * Error indicating item was not found.
     */
    class ItemNotFound(message: String) : VaultPasskeyError(message)

    /**
     * Error indicating a database operation failure.
     */
    class DatabaseError(message: String) : VaultPasskeyError(message)
}
