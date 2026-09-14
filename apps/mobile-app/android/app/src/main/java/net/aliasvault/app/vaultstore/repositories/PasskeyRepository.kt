package net.aliasvault.app.vaultstore.repositories

import android.util.Log
import net.aliasvault.app.autofill.utils.RustItemMatcher
import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.VaultDatabase
import net.aliasvault.app.vaultstore.models.FieldKey
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.Passkey
import net.aliasvault.app.vaultstore.passkey.PasskeyHelper
import net.aliasvault.app.vaultstore.queries.LogoQueries
import net.aliasvault.app.vaultstore.queries.PasskeyQueries
import uniffi.aliasvault_core.faviconSourceKey
import uniffi.aliasvault_core.vaultCodecLogoIdFor
import java.util.Calendar
import java.util.Date
import java.util.TimeZone
import java.util.UUID

/**
 * Repository for Passkey operations on Items.
 */
class PasskeyRepository(database: VaultDatabase) : BaseRepository(database) {
    companion object {
        private const val TAG = "PasskeyRepository"
        private const val LOGO_KIND_FAVICON = "favicon"
        private const val FAVICON_MIME_TYPE = "image/x-icon"

        /*
         * FieldValues.Weight of the two system fields a passkey item gets: the DefaultDisplayOrder of
         * login.url and login.username in core/models/src/vault/SystemFieldRegistry.ts.
         */
        private const val LOGIN_URL_WEIGHT = 5
        private const val LOGIN_USERNAME_WEIGHT = 15

        private val MIN_DATE: Date = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            set(Calendar.YEAR, 1)
            set(Calendar.MONTH, Calendar.JANUARY)
            set(Calendar.DAY_OF_MONTH, 1)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.time
    }

    /**
     * The identity of a logo row: its kind and the natural key within that kind.
     */
    private data class LogoRef(val kind: String, val source: String)

    // MARK: - Read Operations

    /**
     * Get a passkey by its credential ID (the WebAuthn credential ID, not the parent Item UUID).
     * @param credentialId The WebAuthn credential ID bytes
     * @return Passkey object or null if not found
     */
    fun getByCredentialId(credentialId: ByteArray): Passkey? {
        val credentialIdString = try {
            PasskeyHelper.bytesToGuid(credentialId)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to convert credentialId bytes to UUID string", e)
            return null
        }

        val results = executeQuery(PasskeyQueries.GET_BY_ID, arrayOf(credentialIdString.lowercase()))
        return results.firstOrNull()?.let { parsePasskeyRow(it) }
    }

    /**
     * Get all passkeys for an item.
     * @param itemId The UUID of the parent item
     * @param manifestId The manifest the item belongs to
     * @return List of Passkey objects
     */
    fun getForItem(itemId: UUID, manifestId: String): List<Passkey> {
        val results = executeQuery(PasskeyQueries.GET_BY_ITEM_ID, arrayOf(itemId.toString().lowercase(), manifestId))
        return results.mapNotNull { parsePasskeyRow(it) }
    }

    /**
     * Get all passkeys for a specific relying party identifier (RP ID) whose item is live.
     * @param rpId The relying party identifier
     * @return List of Passkey objects
     */
    fun getForRpId(rpId: String): List<Passkey> {
        val results = executeQuery(PasskeyQueries.GET_BY_RP_ID, arrayOf(rpId))
        return results.mapNotNull { parsePasskeyRow(it) }
    }

    /**
     * Get a passkey by its ID, only while its item is live.
     * @param passkeyId The UUID of the passkey
     * @return Passkey object or null if not found
     */
    fun getById(passkeyId: UUID): Passkey? {
        val results = executeQuery(PasskeyQueries.GET_BY_ID, arrayOf(passkeyId.toString().lowercase()))
        return results.firstOrNull()?.let { parsePasskeyRow(it) }
    }

    // MARK: - Write Operations

    /**
     * Insert a new passkey, stamped with the manifest of its item, which the caller has already put on it.
     * @param passkey The passkey to insert
     */
    private fun insert(passkey: Passkey) {
        val manifestId = passkey.manifestId ?: error("Passkey has no manifest: ${passkey.id}")
        executeUpdate(
            PasskeyQueries.INSERT,
            arrayOf(
                passkey.id.toString().lowercase(),
                passkey.parentItemId.toString().lowercase(),
                manifestId,
                passkey.rpId,
                passkey.userHandle,
                String(passkey.publicKey, Charsets.UTF_8),
                String(passkey.privateKey, Charsets.UTF_8),
                passkey.prfKey,
                passkey.displayName,
                passkey.additionalData,
                DateHelpers.toStandardFormat(passkey.createdAt),
                DateHelpers.toStandardFormat(passkey.updatedAt),
                if (passkey.isDeleted) 1L else 0L,
            ),
        )
    }

    /**
     * Create a new item with an associated passkey, in the personal manifest.
     * @param url The item's login URL, which the favicon was fetched for
     * @param userName The username (optional)
     * @param displayName The display name
     * @param passkey The passkey to associate
     * @param logo The favicon bytes fetched for the url (optional)
     * @return The created Item
     */
    fun createItemWithPasskey(
        url: String,
        userName: String?,
        displayName: String,
        passkey: Passkey,
        logo: ByteArray? = null,
    ): Item {
        return withTransaction {
            val manifestId = activeManifestId()
            val itemId = passkey.parentItemId.toString().lowercase()
            val now = Date()
            val timestamp = DateHelpers.toStandardFormat(now)

            val logoId = resolveLogoId(manifestId, null, url, logo, timestamp)

            // Create the Item
            executeUpdate(
                PasskeyQueries.CREATE_ITEM,
                arrayOf(itemId, displayName, "Login", logoId, null, timestamp, timestamp, 0, null, manifestId),
            )

            // Insert URL and username field values
            if (url.isNotEmpty()) {
                insertFieldValue(itemId, manifestId, FieldKey.LOGIN_URL, url, LOGIN_URL_WEIGHT, timestamp)
            }
            if (userName != null) {
                insertFieldValue(itemId, manifestId, FieldKey.LOGIN_USERNAME, userName, LOGIN_USERNAME_WEIGHT, timestamp)
            }

            insert(passkey.copy(manifestId = manifestId))

            // Return a minimal Item object; the full item is loaded via getAllItems()
            Item(
                id = passkey.parentItemId,
                manifestId = manifestId,
                name = displayName,
                itemType = "Login",
                logo = logo,
                folderId = null,
                folderPath = null,
                fields = emptyList(),
                hasPasskey = true,
                hasAttachment = false,
                hasTotp = false,
                createdAt = now,
                updatedAt = now,
            )
        }
    }

    /**
     * Replace an existing passkey with a new one on the same item.
     *
     * @param oldPasskeyId The UUID of the passkey to replace.
     * @param newPasskey The new passkey.
     * @param displayName The updated display name.
     * @param url The login URL the favicon was fetched for.
     * @param logo The favicon bytes fetched for the url (optional).
     */
    fun replace(
        oldPasskeyId: UUID,
        newPasskey: Passkey,
        displayName: String,
        url: String,
        logo: ByteArray? = null,
    ) {
        withTransaction {
            val now = Date()
            val timestamp = DateHelpers.toStandardFormat(now)

            // Get the old passkey to find its item and manifest
            val oldPasskey = getById(oldPasskeyId) ?: error("Passkey not found: $oldPasskeyId")
            val manifestId = oldPasskey.manifestId ?: error("Passkey has no manifest: $oldPasskeyId")
            val itemId = oldPasskey.parentItemId.toString().lowercase()

            executeUpdate(PasskeyQueries.UPDATE_ITEM_TIMESTAMP, arrayOf(timestamp, itemId, manifestId))
            updateItemLogo(itemId, manifestId, url, logo, timestamp)

            // Soft delete the old passkey
            executeUpdate(PasskeyQueries.SOFT_DELETE, arrayOf(timestamp, oldPasskeyId.toString().lowercase(), manifestId))

            // Create the new passkey with the same item ID
            insert(
                newPasskey.copy(
                    parentItemId = oldPasskey.parentItemId,
                    manifestId = manifestId,
                    displayName = displayName,
                    createdAt = now,
                    updatedAt = now,
                    isDeleted = false,
                ),
            )
        }
    }

    /**
     * Add a passkey to an existing Item (merge passkey into existing credential).
     *
     * @param itemId The UUID of the existing Item to add the passkey to.
     * @param manifestId The manifest the item belongs to.
     * @param passkey The passkey to add (will have its parentItemId updated).
     * @param url The login URL the favicon was fetched for.
     * @param logo The favicon bytes fetched for the url (optional).
     */
    fun addPasskeyToExistingItem(
        itemId: UUID,
        manifestId: String,
        passkey: Passkey,
        url: String,
        logo: ByteArray? = null,
    ) {
        withTransaction {
            val now = Date()
            val timestamp = DateHelpers.toStandardFormat(now)
            val id = itemId.toString().lowercase()

            updateItemLogo(id, manifestId, url, logo, timestamp)
            executeUpdate(PasskeyQueries.UPDATE_ITEM_TIMESTAMP, arrayOf(timestamp, id, manifestId))

            insert(
                passkey.copy(
                    parentItemId = itemId,
                    manifestId = manifestId,
                    createdAt = now,
                    updatedAt = now,
                    isDeleted = false,
                ),
            )
        }
    }

    // MARK: - Complex Query Operations

    /**
     * Get passkeys with item info for a specific rpId and optionally username.
     * Used for finding existing passkeys that might be replaced during registration.
     *
     * @param rpId The relying party identifier.
     * @param userName Optional username to filter by.
     * @param userId Optional user ID bytes to filter by.
     * @return List of PasskeyWithCredentialInfo objects.
     */
    fun getWithCredentialInfo(
        rpId: String,
        userName: String? = null,
        userId: ByteArray? = null,
    ): List<PasskeyWithCredentialInfo> {
        if (!database.isOpen()) return emptyList()

        return executeQuery(PasskeyQueries.GET_BY_RP_ID, arrayOf(rpId)).mapNotNull { row ->
            val passkey = parsePasskeyRow(row) ?: return@mapNotNull null
            val itemUsername = row["Username"] as? String

            // Filter by username or userId if provided
            val usernameMatches = userName == null || itemUsername == userName
            val userIdMatches = userId == null || passkey.userHandle == null || userId.contentEquals(passkey.userHandle)
            if (!usernameMatches || !userIdMatches) return@mapNotNull null

            PasskeyWithCredentialInfo(
                passkey = passkey,
                serviceName = row["ServiceName"] as? String,
                username = itemUsername,
                email = row["Email"] as? String,
            )
        }
    }

    /**
     * Get ALL active Login items that don't have a passkey yet (no URL filtering).
     * Used with RustCredentialMatcher for intelligent, cross-platform consistent filtering.
     *
     * @return List of ItemWithCredentialInfo objects with all URLs.
     */
    fun getAllItemsWithoutPasskey(): List<ItemWithCredentialInfo> {
        if (!database.isOpen()) return emptyList()

        val results = mutableListOf<ItemWithCredentialInfo>()
        val rows = executeQuery(
            PasskeyQueries.GET_ALL_ITEMS_WITHOUT_PASSKEY,
            arrayOf(FieldKey.LOGIN_URL, FieldKey.LOGIN_USERNAME, FieldKey.LOGIN_EMAIL, FieldKey.LOGIN_PASSWORD),
        )

        for (row in rows) {
            try {
                val itemIdString = row["Id"] as? String
                val manifestId = row["ManifestId"] as? String
                if (itemIdString == null || manifestId == null) continue
                val itemId = UUID.fromString(itemIdString)
                val createdAt = DateHelpers.parseDateString(row["CreatedAt"] as? String ?: "") ?: MIN_DATE
                val updatedAt = DateHelpers.parseDateString(row["UpdatedAt"] as? String ?: "") ?: MIN_DATE
                val urls = (row["Urls"] as? String)?.split(",")?.filter { it.isNotEmpty() } ?: emptyList()

                results.add(
                    ItemWithCredentialInfo(
                        itemId = itemId,
                        manifestId = manifestId,
                        serviceName = row["Name"] as? String,
                        urls = urls,
                        username = row["Username"] as? String,
                        email = row["Email"] as? String,
                        hasPassword = !(row["Password"] as? String).isNullOrEmpty(),
                        createdAt = createdAt,
                        updatedAt = updatedAt,
                    ),
                )
            } catch (e: Exception) {
                Log.e(TAG, "Error parsing item row", e)
            }
        }

        return results
    }

    /**
     * Get Items that match an rpId but don't have a passkey yet.
     * Uses the Rust credential matcher for consistent cross-platform matching logic.
     *
     * @param rpId The relying party identifier to match against.
     * @param rpName The relying party name (used for title matching fallback).
     * @param userName Optional username to filter by.
     * @return List of ItemWithCredentialInfo objects representing Items without passkeys.
     */
    fun getItemsWithoutPasskeyForRpId(
        rpId: String,
        rpName: String? = null,
        userName: String? = null,
    ): List<ItemWithCredentialInfo> {
        // Get all items without passkeys
        val allItems = getAllItemsWithoutPasskey()

        // Use Rust item matcher for intelligent filtering
        var matchedItems = RustItemMatcher.filterItemsForPasskeyMerge(allItems, rpId, rpName)

        // Apply optional username filter
        if (userName != null) {
            matchedItems = matchedItems.filter { it.username == userName }
        }

        return matchedItems
    }

    /**
     * Get all passkeys with their associated items in a single query.
     * This is much more efficient than calling getForItem() for each item.
     *
     * @return List of PasskeyWithItem objects.
     */
    fun getAllWithItems(): List<PasskeyWithItem> {
        if (!database.isOpen()) return emptyList()

        val results = mutableListOf<PasskeyWithItem>()
        for (row in executeQuery(PasskeyQueries.GET_ALL_WITH_ITEMS, emptyArray())) {
            try {
                val passkey = parsePasskeyRow(row)
                val manifestId = passkey?.manifestId
                if (passkey == null || manifestId == null) continue
                val itemCreatedAt = DateHelpers.parseDateString(row["ItemCreatedAt"] as? String) ?: MIN_DATE
                val itemUpdatedAt = DateHelpers.parseDateString(row["ItemUpdatedAt"] as? String) ?: MIN_DATE

                // Create a minimal Item object with the data we have
                val item = Item(
                    id = passkey.parentItemId,
                    manifestId = manifestId,
                    name = row["ServiceName"] as? String,
                    itemType = "Login",
                    logo = null,
                    folderId = null,
                    folderPath = null,
                    fields = emptyList(), // Not loading all fields for performance
                    hasPasskey = true,
                    hasAttachment = false,
                    hasTotp = false,
                    createdAt = itemCreatedAt,
                    updatedAt = itemUpdatedAt,
                )

                results.add(PasskeyWithItem(passkey, item))
            } catch (e: Exception) {
                Log.e(TAG, "Error parsing passkey with item row", e)
            }
        }

        return results
    }

    // MARK: - Helper Methods

    /**
     * Insert one system field value on an item.
     */
    @Suppress("LongParameterList") // One argument per column written
    private fun insertFieldValue(itemId: String, manifestId: String, fieldKey: String, value: String, weight: Int, timestamp: String) {
        executeUpdate(
            PasskeyQueries.INSERT_FIELD_VALUE,
            arrayOf(generateId(), itemId, null, fieldKey, value, weight, timestamp, timestamp, 0, manifestId),
        )
    }

    /**
     * Point the item at the logo the item-logo rules pick for its url and the fetched bytes, when that differs
     * from the logo it has. A null pick keeps the current logo, like the COALESCE in the TS item update.
     */
    private fun updateItemLogo(itemId: String, manifestId: String, url: String, logo: ByteArray?, timestamp: String) {
        val existingLogoId = executeQuery(PasskeyQueries.GET_LOGO_ID_FROM_ITEM, arrayOf(itemId, manifestId)).firstOrNull()?.get("LogoId") as? String
        val logoId = resolveLogoId(manifestId, existingLogoId, url, logo, timestamp) ?: return
        if (logoId != existingLogoId) {
            executeUpdate(LogoQueries.UPDATE_ITEM_LOGO_ID, arrayOf(logoId, timestamp, itemId, manifestId))
        }
    }

    /**
     * The logo an item should point at, following ItemRepository.ts resolveLogoId without an explicit selection:
     * a logo the user chose earlier (built-in or uploaded) is kept; a favicon the item already has for this
     * domain is kept; fresh bytes create or refresh this domain's favicon row in the item's manifest; otherwise
     * the favicon this domain already has anywhere in the vault is adopted, or none at all.
     *
     * @return The logo id, or null when the item should keep what it has (update) or get none (create)
     */
    private fun resolveLogoId(scope: String, existingLogoId: String?, url: String, logo: ByteArray?, timestamp: String): String? {
        val existing = existingLogoId?.let { getLogoById(it, scope) }
        if (existing != null && existing.kind != LOGO_KIND_FAVICON) {
            return adoptIntoScope(scope, existing.kind, existing.source, timestamp)
        }

        // Without a domain there is no natural key to store a favicon under.
        val source = faviconSourceKey(url)
        if (source.isEmpty()) {
            return null
        }

        if (existing != null && existing.source == source) {
            return adoptIntoScope(scope, LOGO_KIND_FAVICON, source, timestamp)
        }

        if (logo != null && logo.isNotEmpty()) {
            return upsertLogo(scope, LOGO_KIND_FAVICON, source, logo, FAVICON_MIME_TYPE, null, timestamp)
        }

        return adoptIntoScope(scope, LOGO_KIND_FAVICON, source, timestamp)
    }

    /**
     * The kind and key of a logo row inside one manifest, or null when it no longer exists.
     */
    private fun getLogoById(logoId: String, manifestId: String): LogoRef? {
        val row = executeQuery(LogoQueries.GET_BY_ID, arrayOf(logoId, manifestId)).firstOrNull() ?: return null
        val source = row["Source"] as? String ?: return null
        return LogoRef(row["Kind"] as? String ?: LOGO_KIND_FAVICON, source)
    }

    /**
     * The id this logo has inside the manifest, copying it in from another manifest when it is not there yet.
     * Null when the vault holds no such logo at all.
     */
    private fun adoptIntoScope(manifestId: String, kind: String, source: String, timestamp: String): String? {
        val inScope = executeQuery(LogoQueries.GET_ID_FOR_KEY, arrayOf(manifestId, kind, source)).firstOrNull()?.get("Id") as? String
        if (inScope != null) {
            return inScope
        }

        val origin = executeQuery(LogoQueries.GET_BEST_FOR_KEY, arrayOf(kind, source)).firstOrNull() ?: return null
        return upsertLogo(manifestId, kind, source, origin["FileData"] as? ByteArray, origin["MimeType"] as? String, origin["Name"] as? String, timestamp)
    }

    /**
     * Insert or refresh the logo for a kind and key inside one manifest. The id is derived from (manifest, kind,
     * source) by the Rust core, like every other client does, so the same logo never produces two rows.
     */
    @Suppress("LongParameterList") // One argument per column written
    private fun upsertLogo(
        manifestId: String,
        kind: String,
        source: String,
        fileData: ByteArray?,
        mimeType: String?,
        name: String?,
        timestamp: String,
    ): String {
        val logoId = vaultCodecLogoIdFor(manifestId, kind, source)
        executeUpdate(LogoQueries.UPSERT, arrayOf(logoId, kind, source, manifestId, fileData, mimeType, name, timestamp, timestamp))
        return logoId
    }

    /**
     * Parse a passkey row from database query results.
     */
    @Suppress("ReturnCount") // Early returns improve readability for parsing logic
    private fun parsePasskeyRow(row: Map<String, Any?>): Passkey? {
        return try {
            val idString = row["Id"] as? String ?: return null
            val itemIdString = row["ItemId"] as? String ?: return null
            val manifestId = row["ManifestId"] as? String ?: return null
            val rpId = row["RpId"] as? String ?: return null
            val userHandle = row["UserHandle"] as? ByteArray
            val publicKeyString = row["PublicKey"] as? String ?: return null
            val privateKeyString = row["PrivateKey"] as? String ?: return null
            val prfKey = row["PrfKey"] as? ByteArray
            val displayName = row["DisplayName"] as? String ?: return null
            val additionalData = row["AdditionalData"] as? ByteArray
            val createdAtString = row["CreatedAt"] as? String ?: return null
            val updatedAtString = row["UpdatedAt"] as? String ?: return null
            val isDeleted = (row["IsDeleted"] as? Long) == 1L

            Passkey(
                id = UUID.fromString(idString),
                parentItemId = UUID.fromString(itemIdString),
                manifestId = manifestId,
                rpId = rpId,
                userHandle = userHandle,
                userName = null,
                publicKey = publicKeyString.toByteArray(Charsets.UTF_8),
                privateKey = privateKeyString.toByteArray(Charsets.UTF_8),
                prfKey = prfKey,
                displayName = displayName,
                additionalData = additionalData,
                createdAt = DateHelpers.parseDateString(createdAtString) ?: MIN_DATE,
                updatedAt = DateHelpers.parseDateString(updatedAtString) ?: MIN_DATE,
                isDeleted = isDeleted,
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing passkey row", e)
            null
        }
    }
}

// MARK: - Data Classes

/**
 * Data class to hold passkey with item info.
 *
 * @property passkey The passkey.
 * @property serviceName The service name from the item.
 * @property username The username from the item.
 * @property email The email from the item, used as display fallback when there is no username.
 */
data class PasskeyWithCredentialInfo(
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
 * Data class to hold passkey with its associated item.
 *
 * @property passkey The passkey.
 * @property item The item this passkey belongs to.
 */
data class PasskeyWithItem(
    val passkey: Passkey,
    val item: Item,
)

/**
 * Data class to hold Item info for Items without passkeys.
 * Used for showing existing credentials that can have a passkey added.
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
