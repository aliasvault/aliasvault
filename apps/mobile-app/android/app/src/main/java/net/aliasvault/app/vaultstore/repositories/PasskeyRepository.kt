package net.aliasvault.app.vaultstore.repositories

import android.database.Cursor
import android.util.Log
import net.aliasvault.app.autofill.utils.RustItemMatcher
import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.VaultDatabase
import net.aliasvault.app.vaultstore.models.FieldKey
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.Passkey
import net.aliasvault.app.vaultstore.passkey.PasskeyHelper
import java.util.Calendar
import java.util.Date
import java.util.TimeZone
import java.util.UUID

/**
 * Repository for Passkey operations on Items.
 * Handles fetching, creating, updating, and deleting passkeys with their parent items.
 */
class PasskeyRepository(database: VaultDatabase) : BaseRepository(database) {
    companion object {
        private const val TAG = "PasskeyRepository"

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

        val results = executeQuery(
            """
            SELECT Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                   DisplayName, CreatedAt, UpdatedAt, IsDeleted
            FROM Passkeys
            WHERE Id = ? AND IsDeleted = 0
            LIMIT 1
            """.trimIndent(),
            arrayOf(credentialIdString.uppercase()),
        )

        return results.firstOrNull()?.let { parsePasskeyRow(it) }
    }

    /**
     * Get all passkeys for an item.
     * @param itemId The UUID of the parent item
     * @return List of Passkey objects
     */
    fun getForItem(itemId: UUID): List<Passkey> {
        val results = executeQuery(
            """
            SELECT Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                   DisplayName, CreatedAt, UpdatedAt, IsDeleted
            FROM Passkeys
            WHERE ItemId = ? AND IsDeleted = 0
            ORDER BY CreatedAt DESC
            """.trimIndent(),
            arrayOf(itemId.toString().uppercase()),
        )

        return results.mapNotNull { parsePasskeyRow(it) }
    }

    /**
     * Get all passkeys for a specific relying party identifier (RP ID).
     * @param rpId The relying party identifier
     * @return List of Passkey objects
     */
    fun getForRpId(rpId: String): List<Passkey> {
        val results = executeQuery(
            """
            SELECT Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                   DisplayName, CreatedAt, UpdatedAt, IsDeleted
            FROM Passkeys
            WHERE RpId = ? AND IsDeleted = 0
            ORDER BY CreatedAt DESC
            """.trimIndent(),
            arrayOf(rpId),
        )

        return results.mapNotNull { parsePasskeyRow(it) }
    }

    /**
     * Get a passkey by its ID.
     * @param passkeyId The UUID of the passkey
     * @return Passkey object or null if not found
     */
    fun getById(passkeyId: UUID): Passkey? {
        val results = executeQuery(
            """
            SELECT Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                   DisplayName, CreatedAt, UpdatedAt, IsDeleted
            FROM Passkeys
            WHERE Id = ? AND IsDeleted = 0
            LIMIT 1
            """.trimIndent(),
            arrayOf(passkeyId.toString().uppercase()),
        )

        return results.firstOrNull()?.let { parsePasskeyRow(it) }
    }

    // MARK: - Write Operations

    /**
     * Insert a new passkey into the database.
     * @param passkey The passkey to insert
     */
    fun insert(passkey: Passkey) {
        val db = database.dbConnection ?: error("Vault not unlocked")

        val publicKeyString = String(passkey.publicKey, Charsets.UTF_8)
        val privateKeyString = String(passkey.privateKey, Charsets.UTF_8)

        val statement = db.compileStatement(
            """
            INSERT INTO Passkeys (Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                                 DisplayName, CreatedAt, UpdatedAt, IsDeleted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
        )
        statement.use {
            it.bindString(1, passkey.id.toString().uppercase())
            it.bindString(2, passkey.parentItemId.toString().uppercase()) // Note: still called parentItemId but references ItemId
            it.bindString(3, passkey.rpId)
            if (passkey.userHandle != null) {
                it.bindBlob(4, passkey.userHandle)
            } else {
                it.bindNull(4)
            }
            it.bindString(5, publicKeyString)
            it.bindString(6, privateKeyString)
            if (passkey.prfKey != null) {
                it.bindBlob(7, passkey.prfKey)
            } else {
                it.bindNull(7)
            }
            it.bindString(8, passkey.displayName)
            it.bindString(9, DateHelpers.toStandardFormat(passkey.createdAt))
            it.bindString(10, DateHelpers.toStandardFormat(passkey.updatedAt))
            it.bindLong(11, if (passkey.isDeleted) 1 else 0)
            it.executeInsert()
        }
    }

    /**
     * Create a new item with an associated passkey.
     * @param rpId The relying party identifier
     * @param userName The username (optional)
     * @param displayName The display name
     * @param passkey The passkey to associate
     * @param logo The logo bytes (optional)
     * @return The created Item
     */
    fun createItemWithPasskey(
        rpId: String,
        userName: String?,
        displayName: String,
        passkey: Passkey,
        logo: ByteArray? = null,
    ): Item {
        return withTransaction {
            val itemId = passkey.parentItemId
            val now = Date()
            val timestamp = DateHelpers.toStandardFormat(now)

            // Create logo if provided
            val logoId = if (logo != null) {
                val logoIdGen = generateId()
                val source = rpId.lowercase().replace("www.", "")

                executeUpdate(
                    """
                    INSERT INTO Logos (Id, Source, FileData, MimeType, FetchedAt, CreatedAt, UpdatedAt, IsDeleted)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """.trimIndent(),
                    arrayOf(
                        logoIdGen,
                        source,
                        logo, // ByteArray for FileData
                        "image/png",
                        null, // FetchedAt
                        timestamp,
                        timestamp,
                        0,
                    ),
                )
                logoIdGen
            } else {
                null
            }

            // Create the Item
            executeUpdate(
                """
                INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, CreatedAt, UpdatedAt, IsDeleted, DeletedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                arrayOf(
                    itemId.toString().uppercase(),
                    displayName,
                    "Login", // Passkey items are Login type
                    logoId,
                    null, // FolderId
                    timestamp,
                    timestamp,
                    0,
                    null,
                ),
            )

            // Insert URL field value
            if (rpId.isNotEmpty()) {
                executeUpdate(
                    """
                    INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """.trimIndent(),
                    arrayOf(
                        generateId(),
                        itemId.toString().uppercase(),
                        null, // FieldDefinitionId for system fields
                        FieldKey.LOGIN_URL,
                        "https://$rpId",
                        0,
                        timestamp,
                        timestamp,
                        0,
                    ),
                )
            }

            // Insert username field value if provided
            if (userName != null) {
                executeUpdate(
                    """
                    INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """.trimIndent(),
                    arrayOf(
                        generateId(),
                        itemId.toString().uppercase(),
                        null,
                        FieldKey.LOGIN_USERNAME,
                        userName,
                        100,
                        timestamp,
                        timestamp,
                        0,
                    ),
                )
            }

            // Insert the passkey
            insert(passkey)

            // Return a minimal Item object
            // Full item will be loaded via getAllItems() or getItemById()
            Item(
                id = itemId,
                name = displayName,
                itemType = "Login",
                logo = logo,
                folderId = null,
                folderPath = null,
                fields = emptyList(), // Will be populated when loaded from DB
                hasPasskey = true,
                hasAttachment = false,
                hasTotp = false,
                createdAt = now,
                updatedAt = now,
            )
        }
    }

    /**
     * Replace an existing passkey with a new one.
     *
     * @param oldPasskeyId The UUID of the passkey to replace.
     * @param newPasskey The new passkey.
     * @param displayName The updated display name.
     * @param logo The updated logo bytes (optional).
     */
    @Suppress("UNUSED_PARAMETER") // Logo update not yet implemented
    fun replace(
        oldPasskeyId: UUID,
        newPasskey: Passkey,
        displayName: String,
        logo: ByteArray? = null,
    ) {
        withTransaction {
            val now = Date()
            val timestamp = DateHelpers.toStandardFormat(now)

            // Get the old passkey to find its item
            val oldPasskey = getById(oldPasskeyId)
                ?: error("Passkey not found: $oldPasskeyId")

            val itemId = oldPasskey.parentItemId

            // Update the item's name
            executeUpdate(
                "UPDATE Items SET Name = ?, UpdatedAt = ? WHERE Id = ?",
                arrayOf(displayName, timestamp, itemId.toString().uppercase()),
            )

            // TODO: Update logo if provided

            // Soft delete the old passkey
            softDelete("Passkeys", oldPasskeyId.toString().uppercase())

            // Create the new passkey with the same item ID
            val updatedPasskey = newPasskey.copy(
                parentItemId = itemId,
                displayName = displayName,
                createdAt = now,
                updatedAt = now,
                isDeleted = false,
            )

            insert(updatedPasskey)
        }
    }

    /**
     * Add a passkey to an existing Item (merge passkey into existing credential).
     *
     * @param itemId The UUID of the existing Item to add the passkey to.
     * @param passkey The passkey to add (will have its parentItemId updated).
     * @param logo Optional logo to update/add to the item.
     */
    fun addPasskeyToExistingItem(
        itemId: UUID,
        passkey: Passkey,
        logo: ByteArray? = null,
    ) {
        withTransaction {
            val now = Date()
            val timestamp = DateHelpers.toStandardFormat(now)

            // Optionally update/add logo
            if (logo != null) {
                val rpId = passkey.rpId
                val source = rpId.lowercase().replace("www.", "")

                // Check if item already has a logo
                val itemResults = executeQuery(
                    "SELECT LogoId FROM Items WHERE Id = ?",
                    arrayOf(itemId.toString().uppercase()),
                )

                val existingLogoId = itemResults.firstOrNull()?.get("LogoId") as? String

                if (existingLogoId != null) {
                    // Update existing logo
                    executeUpdate(
                        "UPDATE Logos SET FileData = ?, UpdatedAt = ? WHERE Id = ?",
                        arrayOf(logo, timestamp, existingLogoId),
                    )
                } else {
                    // Create new logo
                    val newLogoId = generateId()
                    executeUpdate(
                        """
                        INSERT INTO Logos (Id, Source, FileData, MimeType, FetchedAt, CreatedAt, UpdatedAt, IsDeleted)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """.trimIndent(),
                        arrayOf(
                            newLogoId,
                            source,
                            logo,
                            "image/png",
                            null,
                            timestamp,
                            timestamp,
                            0,
                        ),
                    )

                    // Link logo to item
                    executeUpdate(
                        "UPDATE Items SET LogoId = ?, UpdatedAt = ? WHERE Id = ?",
                        arrayOf(newLogoId, timestamp, itemId.toString().uppercase()),
                    )
                }
            }

            // Update item's UpdatedAt timestamp
            executeUpdate(
                "UPDATE Items SET UpdatedAt = ? WHERE Id = ?",
                arrayOf(timestamp, itemId.toString().uppercase()),
            )

            // Create the passkey with the existing item ID
            val passkeyToInsert = passkey.copy(
                parentItemId = itemId,
                createdAt = now,
                updatedAt = now,
                isDeleted = false,
            )

            insert(passkeyToInsert)
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
        val db = database.dbConnection ?: return emptyList()

        val query = """
            SELECT p.Id, p.ItemId, p.RpId, p.UserHandle, p.PublicKey, p.PrivateKey, p.PrfKey,
                   p.DisplayName, p.CreatedAt, p.UpdatedAt, p.IsDeleted,
                   i.Name,
                   fv_username.Value as Username
            FROM Passkeys p
            INNER JOIN Items i ON p.ItemId = i.Id
            LEFT JOIN FieldValues fv_username ON fv_username.ItemId = i.Id
                AND fv_username.FieldKey = ?
                AND fv_username.IsDeleted = 0
            WHERE p.RpId = ? AND p.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
            ORDER BY p.CreatedAt DESC
        """.trimIndent()

        val results = mutableListOf<PasskeyWithCredentialInfo>()
        val cursor = db.query(query, arrayOf(FieldKey.LOGIN_USERNAME, rpId))

        cursor.use {
            while (it.moveToNext()) {
                val passkey = parsePasskeyFromCursor(it) ?: continue
                val itemName = if (!it.isNull(11)) it.getString(11) else null
                val itemUsername = if (!it.isNull(12)) it.getString(12) else null

                // Filter by username or userId if provided
                var matches = true
                if (userName != null && itemUsername != userName) {
                    matches = false
                }
                if (userId != null && passkey.userHandle != null && !userId.contentEquals(passkey.userHandle)) {
                    matches = false
                }

                if (matches) {
                    results.add(
                        PasskeyWithCredentialInfo(
                            passkey = passkey,
                            serviceName = itemName,
                            username = itemUsername,
                        ),
                    )
                }
            }
        }

        return results
    }

    /**
     * Get ALL Login items that don't have a passkey yet (no URL filtering).
     * Used with RustCredentialMatcher for intelligent, cross-platform consistent filtering.
     *
     * @return List of ItemWithCredentialInfo objects with all URLs.
     */
    fun getAllItemsWithoutPasskey(): List<ItemWithCredentialInfo> {
        val db = database.dbConnection ?: return emptyList()

        val query = """
            SELECT i.Id, i.Name, i.CreatedAt, i.UpdatedAt,
                   GROUP_CONCAT(DISTINCT fv_url.Value) as Urls,
                   fv_username.Value as Username,
                   fv_password.Value as Password
            FROM Items i
            LEFT JOIN FieldValues fv_url ON fv_url.ItemId = i.Id
                AND fv_url.FieldKey = ?
                AND fv_url.IsDeleted = 0
            LEFT JOIN FieldValues fv_username ON fv_username.ItemId = i.Id
                AND fv_username.FieldKey = ?
                AND fv_username.IsDeleted = 0
            LEFT JOIN FieldValues fv_password ON fv_password.ItemId = i.Id
                AND fv_password.FieldKey = ?
                AND fv_password.IsDeleted = 0
            WHERE i.IsDeleted = 0
                AND i.DeletedAt IS NULL
                AND i.ItemType = 'Login'
                AND NOT EXISTS (
                    SELECT 1 FROM Passkeys p
                    WHERE p.ItemId = i.Id AND p.IsDeleted = 0
                )
            GROUP BY i.Id
            ORDER BY i.UpdatedAt DESC
        """.trimIndent()

        val results = mutableListOf<ItemWithCredentialInfo>()
        val cursor = db.query(
            query,
            arrayOf(
                FieldKey.LOGIN_URL,
                FieldKey.LOGIN_USERNAME,
                FieldKey.LOGIN_PASSWORD,
            ),
        )

        cursor.use {
            while (it.moveToNext()) {
                val itemIdString = it.getString(0)
                val itemName = if (!it.isNull(1)) it.getString(1) else null
                val itemCreatedAt = if (!it.isNull(2)) it.getString(2) else null
                val itemUpdatedAt = if (!it.isNull(3)) it.getString(3) else null
                val urlsString = if (!it.isNull(4)) it.getString(4) else null
                val itemUsername = if (!it.isNull(5)) it.getString(5) else null
                val hasPassword = !it.isNull(6) && it.getString(6).isNotEmpty()

                try {
                    val itemId = UUID.fromString(itemIdString)
                    val createdAt = DateHelpers.parseDateString(itemCreatedAt ?: "") ?: MIN_DATE
                    val updatedAt = DateHelpers.parseDateString(itemUpdatedAt ?: "") ?: MIN_DATE
                    val urls = urlsString?.split(",")?.filter { it.isNotEmpty() } ?: emptyList()

                    results.add(
                        ItemWithCredentialInfo(
                            itemId = itemId,
                            serviceName = itemName,
                            url = urls.firstOrNull(),
                            urls = urls,
                            username = itemUsername,
                            hasPassword = hasPassword,
                            createdAt = createdAt,
                            updatedAt = updatedAt,
                        ),
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing item row", e)
                }
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
        val db = database.dbConnection ?: return emptyList()

        val query = """
            SELECT
                p.Id, p.ItemId, p.RpId, p.UserHandle, p.PublicKey, p.PrivateKey, p.PrfKey,
                p.DisplayName, p.CreatedAt as PasskeyCreatedAt, p.UpdatedAt as PasskeyUpdatedAt, p.IsDeleted as PasskeyIsDeleted,
                i.Id as ItemId, i.Name, i.CreatedAt as ItemCreatedAt, i.UpdatedAt as ItemUpdatedAt,
                fv_username.Value as Username,
                fv_email.Value as Email
            FROM Passkeys p
            INNER JOIN Items i ON p.ItemId = i.Id
            LEFT JOIN FieldValues fv_username ON fv_username.ItemId = i.Id
                AND fv_username.FieldKey = ?
                AND fv_username.IsDeleted = 0
            LEFT JOIN FieldValues fv_email ON fv_email.ItemId = i.Id
                AND fv_email.FieldKey = ?
                AND fv_email.IsDeleted = 0
            WHERE p.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
            ORDER BY p.CreatedAt DESC
        """.trimIndent()

        val results = mutableListOf<PasskeyWithItem>()
        val cursor = db.query(query, arrayOf(FieldKey.LOGIN_USERNAME, FieldKey.LOGIN_EMAIL))

        cursor.use {
            while (it.moveToNext()) {
                try {
                    // Parse passkey (columns 0-10)
                    val passkey = parsePasskeyFromJoinCursor(it) ?: continue

                    // Parse item info (columns 11-14)
                    val itemId = UUID.fromString(it.getString(11))
                    val itemName = if (!it.isNull(12)) it.getString(12) else null
                    val itemCreatedAt = DateHelpers.parseDateString(it.getString(13)) ?: MIN_DATE
                    val itemUpdatedAt = DateHelpers.parseDateString(it.getString(14)) ?: MIN_DATE

                    @Suppress("UNUSED_VARIABLE") // Username field loaded for potential future use
                    val username = if (!it.isNull(15)) it.getString(15) else null

                    @Suppress("UNUSED_VARIABLE") // Email field loaded for potential future use
                    val email = if (!it.isNull(16)) it.getString(16) else null

                    // Create a minimal Item object with the data we have
                    val item = Item(
                        id = itemId,
                        name = itemName,
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
        }

        return results
    }

    // MARK: - Helper Methods

    /**
     * Parse a passkey row from database query results.
     */
    @Suppress("ReturnCount") // Early returns improve readability for parsing logic
    private fun parsePasskeyRow(row: Map<String, Any?>): Passkey? {
        return try {
            val idString = row["Id"] as? String ?: return null
            val itemIdString = row["ItemId"] as? String ?: return null
            val rpId = row["RpId"] as? String ?: return null
            val userHandle = row["UserHandle"] as? ByteArray
            val publicKeyString = row["PublicKey"] as? String ?: return null
            val privateKeyString = row["PrivateKey"] as? String ?: return null
            val prfKey = row["PrfKey"] as? ByteArray
            val displayName = row["DisplayName"] as? String ?: return null
            val createdAtString = row["CreatedAt"] as? String ?: return null
            val updatedAtString = row["UpdatedAt"] as? String ?: return null
            val isDeleted = (row["IsDeleted"] as? Long) == 1L

            val id = UUID.fromString(idString)
            val itemId = UUID.fromString(itemIdString)
            val createdAt = DateHelpers.parseDateString(createdAtString) ?: MIN_DATE
            val updatedAt = DateHelpers.parseDateString(updatedAtString) ?: MIN_DATE

            val publicKeyData = publicKeyString.toByteArray(Charsets.UTF_8)
            val privateKeyData = privateKeyString.toByteArray(Charsets.UTF_8)

            Passkey(
                id = id,
                parentItemId = itemId, // Note: field name still parentItemId but now refers to ItemId
                rpId = rpId,
                userHandle = userHandle,
                userName = null,
                publicKey = publicKeyData,
                privateKey = privateKeyData,
                prfKey = prfKey,
                displayName = displayName,
                createdAt = createdAt,
                updatedAt = updatedAt,
                isDeleted = isDeleted,
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing passkey row", e)
            null
        }
    }

    /**
     * Parse a passkey from a cursor (for direct database queries).
     * Expects columns 0-10 to be passkey fields.
     */
    private fun parsePasskeyFromCursor(cursor: Cursor): Passkey? {
        return try {
            val idString = cursor.getString(0)
            val itemIdString = cursor.getString(1)
            val rpId = cursor.getString(2)
            val userHandle = if (!cursor.isNull(3)) cursor.getBlob(3) else null
            val publicKeyString = cursor.getString(4)
            val privateKeyString = cursor.getString(5)
            val prfKey = if (!cursor.isNull(6)) cursor.getBlob(6) else null
            val displayName = cursor.getString(7)
            val createdAtString = cursor.getString(8)
            val updatedAtString = cursor.getString(9)
            val isDeleted = cursor.getInt(10) == 1

            val id = UUID.fromString(idString)
            val itemId = UUID.fromString(itemIdString)

            val createdAt = DateHelpers.parseDateString(createdAtString) ?: MIN_DATE
            val updatedAt = DateHelpers.parseDateString(updatedAtString) ?: MIN_DATE

            val publicKeyData = publicKeyString.toByteArray(Charsets.UTF_8)
            val privateKeyData = privateKeyString.toByteArray(Charsets.UTF_8)

            Passkey(
                id = id,
                parentItemId = itemId,
                rpId = rpId,
                userHandle = userHandle,
                userName = null,
                publicKey = publicKeyData,
                privateKey = privateKeyData,
                prfKey = prfKey,
                displayName = displayName,
                createdAt = createdAt,
                updatedAt = updatedAt,
                isDeleted = isDeleted,
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing passkey from cursor", e)
            null
        }
    }

    /**
     * Parse a passkey from a JOIN query cursor.
     * Expects columns 0-10 to be passkey fields.
     */
    private fun parsePasskeyFromJoinCursor(cursor: Cursor): Passkey? {
        return try {
            val idString = cursor.getString(0)
            val itemIdString = cursor.getString(1)
            val rpId = cursor.getString(2)
            val userHandle = if (!cursor.isNull(3)) cursor.getBlob(3) else null
            val publicKeyString = cursor.getString(4)
            val privateKeyString = cursor.getString(5)
            val prfKey = if (!cursor.isNull(6)) cursor.getBlob(6) else null
            val displayName = cursor.getString(7)
            val createdAtString = cursor.getString(8)
            val updatedAtString = cursor.getString(9)
            val isDeleted = cursor.getInt(10) == 1

            val id = UUID.fromString(idString)
            val itemId = UUID.fromString(itemIdString)

            val createdAt = DateHelpers.parseDateString(createdAtString) ?: MIN_DATE
            val updatedAt = DateHelpers.parseDateString(updatedAtString) ?: MIN_DATE

            val publicKeyData = publicKeyString.toByteArray(Charsets.UTF_8)
            val privateKeyData = privateKeyString.toByteArray(Charsets.UTF_8)

            Passkey(
                id = id,
                parentItemId = itemId,
                rpId = rpId,
                userHandle = userHandle,
                userName = null,
                publicKey = publicKeyData,
                privateKey = privateKeyData,
                prfKey = prfKey,
                displayName = displayName,
                createdAt = createdAt,
                updatedAt = updatedAt,
                isDeleted = isDeleted,
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing passkey from JOIN cursor", e)
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
 */
data class PasskeyWithCredentialInfo(
    val passkey: Passkey,
    val serviceName: String?,
    val username: String?,
)

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
 * @property serviceName The service name (Item.Name).
 * @property url The login URL (first URL for backwards compatibility).
 * @property urls All login URLs associated with this item.
 * @property username The username from field values.
 * @property hasPassword Whether the item has a password.
 * @property createdAt When the item was created.
 * @property updatedAt When the item was last updated.
 */
data class ItemWithCredentialInfo(
    val itemId: UUID,
    val serviceName: String?,
    val url: String?,
    val urls: List<String> = url?.let { listOf(it) } ?: emptyList(),
    val username: String?,
    val hasPassword: Boolean,
    val createdAt: Date,
    val updatedAt: Date,
)
