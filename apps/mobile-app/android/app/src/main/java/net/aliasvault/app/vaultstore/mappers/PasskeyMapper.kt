package net.aliasvault.app.vaultstore.mappers

import android.util.Log
import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.models.Passkey
import java.util.UUID

/**
 * Raw passkey row from a database query.
 *
 * @property id The passkey id, also its WebAuthn credential id.
 * @property itemId The item the passkey belongs to.
 * @property manifestId The manifest the item lives in.
 * @property rpId The relying party id.
 * @property userHandle The WebAuthn user handle.
 * @property publicKey The public key as JWK text.
 * @property privateKey The private key as JWK text.
 * @property prfKey The PRF extension key.
 * @property displayName The display name.
 * @property additionalData Extra authenticator data.
 * @property createdAt Creation timestamp text.
 * @property updatedAt Update timestamp text.
 * @property isDeleted Whether the passkey is soft deleted.
 */
data class PasskeyRow(
    val id: String,
    val itemId: String,
    val manifestId: String,
    val rpId: String,
    val userHandle: ByteArray?,
    val publicKey: String,
    val privateKey: String,
    val prfKey: ByteArray?,
    val displayName: String,
    val additionalData: ByteArray?,
    val createdAt: String,
    val updatedAt: String,
    val isDeleted: Boolean,
) {
    companion object {
        /**
         * Read a row from a query result, or null when a required column is missing.
         */
        @Suppress("ReturnCount") // One early return per required column
        fun fromRow(row: Map<String, Any?>): PasskeyRow? {
            return PasskeyRow(
                id = row["Id"] as? String ?: return null,
                itemId = row["ItemId"] as? String ?: return null,
                manifestId = row["ManifestId"] as? String ?: return null,
                rpId = row["RpId"] as? String ?: return null,
                userHandle = row["UserHandle"] as? ByteArray,
                publicKey = row["PublicKey"] as? String ?: return null,
                privateKey = row["PrivateKey"] as? String ?: return null,
                prfKey = row["PrfKey"] as? ByteArray,
                displayName = row["DisplayName"] as? String ?: return null,
                additionalData = row["AdditionalData"] as? ByteArray,
                createdAt = row["CreatedAt"] as? String ?: return null,
                updatedAt = row["UpdatedAt"] as? String ?: return null,
                isDeleted = (row["IsDeleted"] as? Long) == 1L,
            )
        }
    }
}

/**
 * Passkey row joined with the display fields of its item.
 *
 * @property passkeyRow The passkey columns.
 * @property serviceName The item name.
 * @property username The item's login.username value.
 * @property email The item's login.email value.
 */
data class PasskeyWithItemRow(
    val passkeyRow: PasskeyRow,
    val serviceName: String?,
    val username: String?,
    val email: String?,
) {
    companion object {
        /**
         * Read a joined row from a query result, or null when the passkey columns are missing.
         */
        fun fromRow(row: Map<String, Any?>): PasskeyWithItemRow? {
            val passkeyRow = PasskeyRow.fromRow(row) ?: return null
            return PasskeyWithItemRow(passkeyRow, row["ServiceName"] as? String, row["Username"] as? String, row["Email"] as? String)
        }
    }
}

/**
 * A passkey with the display fields of its item.
 *
 * @property passkey The passkey.
 * @property serviceName The service name from the item.
 * @property username The username from the item.
 * @property email The email from the item, used as display fallback when there is no username.
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
 * Maps passkey rows to Passkey objects.
 * Other platform implementations: PasskeyMapper.ts (core/client), PasskeyMapper.swift (iOS).
 */
object PasskeyMapper {
    private const val TAG = "PasskeyMapper"

    /**
     * Map one passkey row to a Passkey, or null when its ids are not valid UUIDs.
     */
    fun mapRow(row: PasskeyRow): Passkey? {
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
                createdAt = DateHelpers.parseDateString(row.createdAt) ?: ItemMapper.MIN_DATE,
                updatedAt = DateHelpers.parseDateString(row.updatedAt) ?: ItemMapper.MIN_DATE,
                isDeleted = row.isDeleted,
            )
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "Invalid UUID in passkey row: id=${row.id}, itemId=${row.itemId}", e)
            null
        }
    }

    /**
     * Map passkey rows to Passkeys, skipping rows that do not map.
     */
    fun mapRows(rows: List<PasskeyRow>): List<Passkey> = rows.mapNotNull { mapRow(it) }

    /**
     * Map one joined row to a PasskeyWithItem.
     */
    fun mapRowWithItem(row: PasskeyWithItemRow): PasskeyWithItem? {
        val passkey = mapRow(row.passkeyRow) ?: return null
        return PasskeyWithItem(passkey, row.serviceName, row.username, row.email)
    }

    /**
     * Map joined rows to PasskeyWithItem objects, skipping rows that do not map.
     */
    fun mapRowsWithItem(rows: List<PasskeyWithItemRow>): List<PasskeyWithItem> = rows.mapNotNull { mapRowWithItem(it) }
}
