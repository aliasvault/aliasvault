package net.aliasvault.app.vaultstore

import android.util.Log
import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.models.FieldKey
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.Passkey
import net.aliasvault.app.vaultstore.repositories.PasskeyRepository
import java.util.Calendar
import java.util.Date
import java.util.TimeZone
import java.util.UUID

/**
 * Handles passkey operations for the vault.
 * This class uses composition to organize passkey-specific functionality.
 * *
 * IMPORTANT: Keep all implementations synchronized. Changes to the public interface must be
 * reflected in all ports. Method names, parameters, and behavior should remain consistent.
 */
class VaultPasskey(
    private val database: VaultDatabase,
    private val query: VaultQuery,
) {
    companion object {
        private const val TAG = "VaultPasskey"

        /**
         * Minimum date definition for default values.
         */
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
        val db = database.dbConnection ?: return emptyList()

        // Query passkeys with associated item data using the new schema
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
                val passkey = parsePasskeyRow(it) ?: continue
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
     * Get all passkeys with their associated items in a single query.
     * This is much more efficient than calling getPasskeysForItem() for each item.
     * Uses a JOIN to get passkeys and their items in one database query.
     */
    fun getAllPasskeysWithItems(): List<PasskeyWithItem> {
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
                    val passkey = parsePasskeyRowFromJoin(it) ?: continue

                    // Parse item info (columns 11-15)
                    val itemId = UUID.fromString(it.getString(11))
                    val itemName = if (!it.isNull(12)) it.getString(12) else null
                    val itemCreatedAt = DateHelpers.parseDateString(it.getString(13)) ?: MIN_DATE
                    val itemUpdatedAt = DateHelpers.parseDateString(it.getString(14)) ?: MIN_DATE

                    @Suppress("UNUSED_VARIABLE") // Username field loaded for potential future use
                    val username = if (!it.isNull(15)) it.getString(15) else null

                    @Suppress("UNUSED_VARIABLE") // Email field loaded for potential future use
                    val email = if (!it.isNull(16)) it.getString(16) else null

                    // Create a minimal Item object with the data we have
                    // Full items should be loaded via query.getAllItems() when needed
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

    // endregion

    // region Helper Methods

    /**
     * Parse a passkey row from database query.
     */
    private fun parsePasskeyRow(cursor: android.database.Cursor): Passkey? {
        try {
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

            return Passkey(
                id = id,
                parentItemId = itemId, // Note: field name still parentItemId but refers to ItemId
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
            return null
        }
    }

    /**
     * Parse a passkey row from a JOIN query.
     */
    private fun parsePasskeyRowFromJoin(cursor: android.database.Cursor): Passkey? {
        try {
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

            return Passkey(
                id = id,
                parentItemId = itemId, // Note: field name still parentItemId but refers to ItemId
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
            Log.e(TAG, "Error parsing passkey row from JOIN", e)
            return null
        }
    }

    // endregion
}

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
