package net.aliasvault.app.vaultstore

import net.aliasvault.app.vaultstore.models.Passkey
import uniffi.aliasvault_core.NewPasskey
import uniffi.aliasvault_core.PasskeyMergeCandidate
import uniffi.aliasvault_core.VaultPasskeyWithItem
import java.util.Date
import java.util.UUID
import uniffi.aliasvault_core.VaultPasskey as StoredPasskey

/**
 * Passkey reads and writes, run by the Rust core on the open vault database.
 * Other platform implementations: VaultStore+Passkey.swift (iOS).
 */
class VaultPasskey(
    private val database: VaultDatabase,
) {
    // region Passkey Queries

    /**
     * Get a passkey by its id (the WebAuthn credential id, not the parent item id), in any manifest.
     */
    fun getPasskeyById(passkeyId: UUID): Passkey? {
        return database.connection().getPasskeyById(passkeyId.toString())?.let { toPasskey(it.passkey) }
    }

    /**
     * Get passkeys with item info for an rpId, narrowed to an account when a user name or handle is given.
     * Used for finding existing passkeys that might be replaced during registration.
     */
    fun getPasskeysWithCredentialInfo(rpId: String, userName: String? = null, userId: ByteArray? = null): List<PasskeyWithItem> {
        if (!database.isOpen()) return emptyList()
        return database.connection().getPasskeysForRpId(rpId, userName, userId).mapNotNull(::toPasskeyWithItem)
    }

    /**
     * Get every passkey whose item is live, with the item's name and account.
     */
    fun getAllPasskeysWithItems(): List<PasskeyWithItem> {
        if (!database.isOpen()) return emptyList()
        return database.connection().getAllPasskeysWithItems().mapNotNull(::toPasskeyWithItem)
    }

    /**
     * Get the Login items without a passkey that match an rpId, best match first, which a new passkey could be added to.
     *
     * @param rpId The relying party identifier to match against the login URL.
     * @param rpName The relying party name (used for title matching fallback).
     * @param userName Optional username to filter by.
     */
    fun getItemsWithoutPasskeyForRpId(rpId: String, rpName: String? = null, userName: String? = null): List<ItemWithCredentialInfo> {
        if (!database.isOpen()) return emptyList()
        return database.connection().getItemsWithoutPasskeyForRpId(rpId, rpName, userName).mapNotNull(::toItemWithCredentialInfo)
    }

    // endregion

    // region Passkey Storage

    /**
     * Create a Login item in the personal manifest holding a new passkey.
     *
     * @param url The item's login URL, which the favicon was fetched for.
     */
    fun createItemWithPasskey(url: String, userName: String?, displayName: String, passkey: Passkey, logo: ByteArray? = null) {
        val manifestId = database.getPersonalManifestId() ?: throw AppError.ManifestNotRecorded()
        database.withTransaction { db ->
            db.createItemWithPasskey(manifestId, passkey.parentItemId.toString(), displayName, url, userName, toNewPasskey(passkey, passkey.displayName), logo)
        }
    }

    /**
     * Replace an existing passkey with a new one on the same item, in the same manifest.
     *
     * @param url The login URL the favicon was fetched for.
     */
    @Suppress("LongParameterList") // One argument per value the replacement writes
    fun replacePasskey(oldPasskeyId: UUID, manifestId: String, newPasskey: Passkey, displayName: String, url: String, logo: ByteArray? = null) {
        database.withTransaction { db ->
            db.replacePasskey(oldPasskeyId.toString(), manifestId, toNewPasskey(newPasskey, displayName), url, logo)
        }
    }

    /**
     * Add a passkey to an existing item (merge the passkey into an existing credential).
     *
     * @param url The login URL the favicon was fetched for.
     */
    fun addPasskeyToExistingItem(itemId: UUID, manifestId: String, passkey: Passkey, url: String, logo: ByteArray? = null) {
        database.withTransaction { db ->
            db.addPasskeyToItem(itemId.toString(), manifestId, toNewPasskey(passkey, passkey.displayName), url, logo)
        }
    }

    // endregion

    // region Mapping

    private fun toPasskey(row: StoredPasskey): Passkey? {
        return try {
            Passkey(
                id = UUID.fromString(row.id),
                parentItemId = UUID.fromString(row.itemId),
                manifestId = row.manifestId,
                rpId = row.rpId,
                userHandle = row.userHandle,
                userName = null,
                publicKey = row.publicKey.toByteArray(Charsets.UTF_8),
                privateKey = row.privateKey.toByteArray(Charsets.UTF_8),
                prfKey = row.prfKey,
                displayName = row.displayName,
                additionalData = row.additionalData,
                createdAt = Date(row.createdAtMs),
                updatedAt = Date(row.updatedAtMs),
                isDeleted = false,
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun toPasskeyWithItem(row: VaultPasskeyWithItem): PasskeyWithItem? {
        val passkey = toPasskey(row.passkey) ?: return null
        return PasskeyWithItem(passkey, row.serviceName, row.username, row.email)
    }

    private fun toItemWithCredentialInfo(row: PasskeyMergeCandidate): ItemWithCredentialInfo? {
        return try {
            ItemWithCredentialInfo(
                itemId = UUID.fromString(row.itemId),
                manifestId = row.manifestId,
                serviceName = row.serviceName,
                urls = row.urls,
                username = row.username,
                email = row.email,
                hasPassword = row.hasPassword,
                createdAt = Date(row.createdAtMs),
                updatedAt = Date(row.updatedAtMs),
            )
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun toNewPasskey(passkey: Passkey, displayName: String): NewPasskey {
        return NewPasskey(
            id = passkey.id.toString(),
            rpId = passkey.rpId,
            userHandle = passkey.userHandle,
            publicKey = String(passkey.publicKey, Charsets.UTF_8),
            privateKey = String(passkey.privateKey, Charsets.UTF_8),
            prfKey = passkey.prfKey,
            displayName = displayName,
        )
    }

    // endregion
}

/**
 * A passkey with the name and account of the item it belongs to.
 *
 * @property passkey The passkey.
 * @property serviceName The item name.
 * @property username The item's login.username value.
 * @property email The item's login.email value, used as display fallback when there is no username.
 */
data class PasskeyWithItem(
    val passkey: Passkey,
    val serviceName: String?,
    val username: String?,
    val email: String? = null,
) {
    /** The account identifier to display: the username, or the email when no username is set. */
    val accountLabel: String?
        get() = username?.takeIf { it.isNotBlank() } ?: email?.takeIf { it.isNotBlank() }
}

/**
 * A Login item without a passkey that a new passkey could be added to.
 *
 * @property itemId The UUID of the item.
 * @property manifestId The manifest the item belongs to.
 * @property serviceName The service name (Item.Name).
 * @property urls All login URLs associated with this item.
 * @property username The username from field values.
 * @property email The email from field values, used as display fallback when there is no username.
 * @property hasPassword Whether the item has a password.
 * @property createdAt When the item was created.
 * @property updatedAt When the item was last updated.
 */
data class ItemWithCredentialInfo(
    val itemId: UUID,
    val manifestId: String,
    val serviceName: String?,
    val urls: List<String>,
    val username: String?,
    val email: String? = null,
    val hasPassword: Boolean,
    val createdAt: Date,
    val updatedAt: Date,
) {
    /** The account identifier to display: the username, or the email when no username is set. */
    val accountLabel: String?
        get() = username?.takeIf { it.isNotBlank() } ?: email?.takeIf { it.isNotBlank() }
}
