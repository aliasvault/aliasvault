package net.aliasvault.app.vaultstore.repositories

import android.util.Log
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

            // Create the item
            val logoId = if (logo != null) {
                val logoIdGen = generateId()
                // TODO: Insert logo into Logos table with deduplication
                logoIdGen
            } else {
                null
            }

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
}
