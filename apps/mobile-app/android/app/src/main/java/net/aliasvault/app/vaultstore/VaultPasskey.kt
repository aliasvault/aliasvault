package net.aliasvault.app.vaultstore

import android.content.ContentValues
import android.database.Cursor
import android.util.Log
import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.models.Alias
import net.aliasvault.app.vaultstore.models.Credential
import net.aliasvault.app.vaultstore.models.Passkey
import net.aliasvault.app.vaultstore.models.Service
import net.aliasvault.app.vaultstore.passkey.PasskeyHelper
import java.util.Calendar
import java.util.Date
import java.util.TimeZone
import java.util.UUID

/**
 * Handles passkey operations for the vault.
 * This class uses composition to organize passkey-specific functionality.
 *
 * This is a Kotlin port of the iOS Swift implementation:
 * - Reference: apps/mobile-app/ios/VaultStoreKit/VaultStore+Passkey.swift
 *
 * IMPORTANT: Keep all implementations synchronized. Changes to the public interface must be
 * reflected in all ports. Method names, parameters, and behavior should remain consistent.
 */
class VaultPasskey(
    private val database: VaultDatabase,
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

    // region Passkey Queries

    /**
     * Get a passkey by its credential ID (the WebAuthn credential ID, not the parent Credential UUID).
     */
    fun getPasskeyByCredentialId(credentialId: ByteArray): Passkey? {
        val db = database.dbConnection ?: return null

        // Convert credentialId bytes to UUID string for lookup
        val credentialIdString = try {
            PasskeyHelper.bytesToGuid(credentialId)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to convert credentialId bytes to UUID string", e)
            return null
        }

        val query = """
            SELECT Id, CredentialId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                   DisplayName, CreatedAt, UpdatedAt, IsDeleted
            FROM Passkeys
            WHERE Id = ? AND IsDeleted = 0
            LIMIT 1
        """.trimIndent()

        val cursor = db.query(query, arrayOf(credentialIdString.uppercase()))
        cursor.use {
            if (it.moveToFirst()) {
                return parsePasskeyRow(it)
            }
        }

        return null
    }

    /**
     * Get all passkeys for a credential.
     */
    fun getPasskeysForCredential(credentialId: UUID): List<Passkey> {
        val db = database.dbConnection ?: return emptyList()

        val query = """
            SELECT Id, CredentialId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                   DisplayName, CreatedAt, UpdatedAt, IsDeleted
            FROM Passkeys
            WHERE CredentialId = ? AND IsDeleted = 0
            ORDER BY CreatedAt DESC
        """.trimIndent()

        val passkeys = mutableListOf<Passkey>()
        val cursor = db.query(query, arrayOf(credentialId.toString().uppercase()))

        cursor.use {
            while (it.moveToNext()) {
                parsePasskeyRow(it)?.let { passkey ->
                    passkeys.add(passkey)
                }
            }
        }

        return passkeys
    }

    /**
     * Get all passkeys for a specific relying party identifier (RP ID).
     */
    fun getPasskeysForRpId(rpId: String): List<Passkey> {
        val db = database.dbConnection ?: return emptyList()

        val query = """
            SELECT Id, CredentialId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                   DisplayName, CreatedAt, UpdatedAt, IsDeleted
            FROM Passkeys
            WHERE RpId = ? AND IsDeleted = 0
            ORDER BY CreatedAt DESC
        """.trimIndent()

        val passkeys = mutableListOf<Passkey>()
        val cursor = db.query(query, arrayOf(rpId))

        cursor.use {
            while (it.moveToNext()) {
                parsePasskeyRow(it)?.let { passkey ->
                    passkeys.add(passkey)
                }
            }
        }

        return passkeys
    }

    /**
     * Get passkeys with credential info for a specific rpId and optionally username.
     * Used for finding existing passkeys that might be replaced during registration.
     */
    fun getPasskeysWithCredentialInfo(
        rpId: String,
        userName: String? = null,
        userId: ByteArray? = null,
    ): List<PasskeyWithCredentialInfo> {
        val db = database.dbConnection ?: return emptyList()

        val query = """
            SELECT p.Id, p.CredentialId, p.RpId, p.UserHandle, p.PublicKey, p.PrivateKey, p.PrfKey,
                   p.DisplayName, p.CreatedAt, p.UpdatedAt, p.IsDeleted,
                   c.Username, s.Name
            FROM Passkeys p
            JOIN Credentials c ON p.CredentialId = c.Id
            JOIN Services s ON c.ServiceId = s.Id
            WHERE p.RpId = ? AND p.IsDeleted = 0 AND c.IsDeleted = 0
            ORDER BY p.CreatedAt DESC
        """.trimIndent()

        val results = mutableListOf<PasskeyWithCredentialInfo>()
        val cursor = db.query(query, arrayOf(rpId))

        cursor.use {
            while (it.moveToNext()) {
                val passkey = parsePasskeyRow(it) ?: continue
                val credUsername = if (!it.isNull(11)) it.getString(11) else null
                val serviceName = if (!it.isNull(12)) it.getString(12) else null

                // Filter by username or userId if provided
                var matches = true
                if (userName != null && credUsername != userName) {
                    matches = false
                }
                if (userId != null && passkey.userHandle != null && !userId.contentEquals(passkey.userHandle)) {
                    matches = false
                }

                if (matches) {
                    results.add(
                        PasskeyWithCredentialInfo(
                            passkey = passkey,
                            serviceName = serviceName,
                            username = credUsername,
                        ),
                    )
                }
            }
        }

        return results
    }

    /**
     * Get all passkeys with their associated credentials in a single query.
     * This is much more efficient than calling getPasskeysForCredential() for each credential.
     * Uses a JOIN to get passkeys and their credentials in one database query.
     */
    fun getAllPasskeysWithCredentials(): List<PasskeyWithCredential> {
        val db = database.dbConnection ?: return emptyList()

        val query = """
            SELECT
                p.Id, p.CredentialId, p.RpId, p.UserHandle, p.PublicKey, p.PrivateKey, p.PrfKey,
                p.DisplayName, p.CreatedAt as PasskeyCreatedAt, p.UpdatedAt as PasskeyUpdatedAt, p.IsDeleted as PasskeyIsDeleted,
                c.Id as CredId, c.Username, s.Name as ServiceName, c.CreatedAt as CredCreatedAt, c.UpdatedAt as CredUpdatedAt
            FROM Passkeys p
            INNER JOIN Credentials c ON p.CredentialId = c.Id
            INNER JOIN Services s ON c.ServiceId = s.Id
            WHERE p.IsDeleted = 0 AND c.IsDeleted = 0
            ORDER BY p.CreatedAt DESC
        """.trimIndent()

        val results = mutableListOf<PasskeyWithCredential>()
        val cursor = db.query(query)

        cursor.use {
            while (it.moveToNext()) {
                try {
                    // Parse passkey (columns 0-10)
                    val passkey = parsePasskeyRowFromJoin(it) ?: continue

                    // Parse credential info (columns 11-15)
                    val credentialId = UUID.fromString(it.getString(11))
                    val username = if (!it.isNull(12)) it.getString(12) else null
                    val serviceName = if (!it.isNull(13)) it.getString(13) else null

                    // Create a minimal Credential object with the data we have
                    val credential = Credential(
                        id = credentialId,
                        username = username,
                        service = Service(
                            id = UUID.randomUUID(),
                            name = serviceName,
                            url = null,
                            logo = null,
                            createdAt = Date(),
                            updatedAt = Date(),
                            isDeleted = false,
                        ),
                        alias = null,
                        notes = null,
                        password = null,
                        createdAt = DateHelpers.parseDateString(it.getString(14)) ?: MIN_DATE,
                        updatedAt = DateHelpers.parseDateString(it.getString(15)) ?: MIN_DATE,
                        isDeleted = false,
                    )

                    results.add(PasskeyWithCredential(passkey, credential))
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing passkey with credential row", e)
                }
            }
        }

        return results
    }

    /**
     * Get a passkey by its ID.
     */
    fun getPasskeyById(passkeyId: UUID): Passkey? {
        val db = database.dbConnection ?: return null

        val query = """
            SELECT Id, CredentialId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                   DisplayName, CreatedAt, UpdatedAt, IsDeleted
            FROM Passkeys
            WHERE Id = ? AND IsDeleted = 0
            LIMIT 1
        """.trimIndent()

        val cursor = db.query(query, arrayOf(passkeyId.toString().uppercase()))
        cursor.use {
            if (it.moveToFirst()) {
                return parsePasskeyRow(it)
            }
        }

        return null
    }

    // endregion

    // region Passkey Storage

    /**
     * Insert a new passkey into the database.
     */
    fun insertPasskey(passkey: Passkey) {
        val db = database.dbConnection ?: error("Vault not unlocked")

        val insert = """
            INSERT INTO Passkeys (Id, CredentialId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                                 DisplayName, CreatedAt, UpdatedAt, IsDeleted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """.trimIndent()

        val publicKeyString = String(passkey.publicKey, Charsets.UTF_8)
        val privateKeyString = String(passkey.privateKey, Charsets.UTF_8)

        db.query(
            insert,
            arrayOf(
                passkey.id.toString().uppercase(),
                passkey.parentCredentialId.toString().uppercase(),
                passkey.rpId,
                passkey.userHandle,
                publicKeyString,
                privateKeyString,
                passkey.prfKey,
                passkey.displayName,
                DateHelpers.toStandardFormat(passkey.createdAt),
                DateHelpers.toStandardFormat(passkey.updatedAt),
                if (passkey.isDeleted) 1 else 0,
            ),
        )
    }

    /**
     * Create a new credential with an associated passkey.
     */
    fun createCredentialWithPasskey(
        rpId: String,
        userName: String?,
        displayName: String,
        passkey: Passkey,
        logo: ByteArray? = null,
    ): Credential {
        val db = database.dbConnection ?: error("Vault not unlocked")

        db.beginTransaction()
        try {
            val credentialId = passkey.parentCredentialId
            val now = Date()
            val timestamp = DateHelpers.toStandardFormat(now)

            // Create a minimal service for the RP
            val serviceId = UUID.randomUUID()

            val serviceValues = ContentValues().apply {
                put("Id", serviceId.toString().uppercase())
                put("Name", displayName)
                put("Url", "https://$rpId")
                if (logo != null) {
                    put("Logo", logo)
                } else {
                    putNull("Logo")
                }
                put("CreatedAt", timestamp)
                put("UpdatedAt", timestamp)
                put("IsDeleted", 0)
            }
            db.insert("Services", null, serviceValues)

            // Create a minimal alias with empty fields and default birthdate
            val aliasId = UUID.randomUUID()
            val aliasInsert = """
                INSERT INTO Aliases (Id, FirstName, LastName, NickName, BirthDate, Gender, Email,
                                    CreatedAt, UpdatedAt, IsDeleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent()

            db.query(
                aliasInsert,
                arrayOf(
                    aliasId.toString().uppercase(),
                    "",
                    "",
                    "",
                    DateHelpers.toStandardFormat(MIN_DATE),
                    "",
                    "",
                    timestamp,
                    timestamp,
                    0,
                ),
            )

            // Create the credential with the alias
            val credentialInsert = """
                INSERT INTO Credentials (Id, ServiceId, AliasId, Username, Notes, CreatedAt, UpdatedAt, IsDeleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent()

            db.query(
                credentialInsert,
                arrayOf(
                    credentialId.toString().uppercase(),
                    serviceId.toString().uppercase(),
                    aliasId.toString().uppercase(),
                    userName,
                    null,
                    timestamp,
                    timestamp,
                    0,
                ),
            )

            // Insert the passkey
            insertPasskey(passkey)

            // Commit transaction
            database.commitTransaction()

            // Return the credential
            val service = Service(
                id = serviceId,
                name = displayName,
                url = "https://$rpId",
                logo = logo,
                createdAt = now,
                updatedAt = now,
                isDeleted = false,
            )

            val alias = Alias(
                id = aliasId,
                gender = "",
                firstName = "",
                lastName = "",
                nickName = "",
                birthDate = MIN_DATE,
                email = "",
                createdAt = now,
                updatedAt = now,
                isDeleted = false,
            )

            return Credential(
                id = credentialId,
                alias = alias,
                service = service,
                username = userName,
                notes = null,
                password = null,
                createdAt = now,
                updatedAt = now,
                isDeleted = false,
            )
        } catch (e: Exception) {
            db.endTransaction()
            throw e
        }
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
        val db = database.dbConnection ?: error("Vault not unlocked")

        val now = Date()
        val timestamp = DateHelpers.toStandardFormat(now)

        // Get the old passkey to find its credential
        val oldPasskey = getPasskeyById(oldPasskeyId)
            ?: throw VaultPasskeyError.PasskeyNotFound("Passkey not found: $oldPasskeyId")

        val credentialId = oldPasskey.parentCredentialId

        // Update the credential's service with new logo if provided
        if (logo != null) {
            val credQuery = """
                SELECT ServiceId FROM Credentials WHERE Id = ? LIMIT 1
            """.trimIndent()

            val cursor = db.query(credQuery, arrayOf(credentialId.toString().uppercase()))
            cursor.use {
                if (it.moveToFirst()) {
                    val serviceId = it.getString(0)

                    val serviceUpdate = """
                        UPDATE Services
                        SET Logo = ?, Name = ?, UpdatedAt = ?
                        WHERE Id = ?
                    """.trimIndent()

                    db.query(serviceUpdate, arrayOf(logo, displayName, timestamp, serviceId))
                }
            }
        }

        // Delete the old passkey
        val deleteQuery = """
            UPDATE Passkeys
            SET IsDeleted = 1, UpdatedAt = ?
            WHERE Id = ?
        """.trimIndent()

        db.query(deleteQuery, arrayOf(timestamp, oldPasskeyId.toString().uppercase()))

        // Create the new passkey with the same credential ID
        val updatedPasskey = newPasskey.copy(
            parentCredentialId = credentialId,
            displayName = displayName,
            createdAt = now,
            updatedAt = now,
            isDeleted = false,
        )

        insertPasskey(updatedPasskey)
    }

    // endregion

    // region Helper Methods

    /**
     * Parse a passkey row from database query.
     */
    private fun parsePasskeyRow(cursor: Cursor): Passkey? {
        try {
            val idString = cursor.getString(0)
            val parentCredentialIdString = cursor.getString(1)
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
            val parentCredentialId = UUID.fromString(parentCredentialIdString)

            val createdAt = DateHelpers.parseDateString(createdAtString) ?: MIN_DATE
            val updatedAt = DateHelpers.parseDateString(updatedAtString) ?: MIN_DATE

            val publicKeyData = publicKeyString.toByteArray(Charsets.UTF_8)
            val privateKeyData = privateKeyString.toByteArray(Charsets.UTF_8)

            return Passkey(
                id = id,
                parentCredentialId = parentCredentialId,
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
    private fun parsePasskeyRowFromJoin(cursor: Cursor): Passkey? {
        try {
            val idString = cursor.getString(0)
            val parentCredentialIdString = cursor.getString(1)
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
            val parentCredentialId = UUID.fromString(parentCredentialIdString)

            val createdAt = DateHelpers.parseDateString(createdAtString) ?: MIN_DATE
            val updatedAt = DateHelpers.parseDateString(updatedAtString) ?: MIN_DATE

            val publicKeyData = publicKeyString.toByteArray(Charsets.UTF_8)
            val privateKeyData = privateKeyString.toByteArray(Charsets.UTF_8)

            return Passkey(
                id = id,
                parentCredentialId = parentCredentialId,
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
 * Data class to hold passkey with credential info.
 */
data class PasskeyWithCredentialInfo(
    /** The passkey. */
    val passkey: Passkey,
    /** The service name from the credential. */
    val serviceName: String?,
    /** The username from the credential. */
    val username: String?,
)

/**
 * Data class to hold passkey with its associated credential.
 */
data class PasskeyWithCredential(
    /** The passkey. */
    val passkey: Passkey,
    /** The credential this passkey belongs to. */
    val credential: Credential,
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
     * Error indicating credential was not found.
     */
    class CredentialNotFound(message: String) : VaultPasskeyError(message)

    /**
     * Error indicating a database operation failure.
     */
    class DatabaseError(message: String) : VaultPasskeyError(message)
}
