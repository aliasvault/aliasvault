package net.aliasvault.app.vaultstore

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import net.aliasvault.app.vaultstore.models.Alias
import net.aliasvault.app.vaultstore.models.Credential
import net.aliasvault.app.vaultstore.models.Passkey
import net.aliasvault.app.vaultstore.models.Service
import net.aliasvault.app.vaultstore.passkey.PasskeyHelper
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * VaultStorePasskey
 * Extension methods for VaultStore to handle passkey operations
 *
 * This is a Kotlin port of the iOS Swift implementation:
 * - Reference: apps/mobile-app/ios/VaultStoreKit/VaultStore+Passkey.swift
 *
 * IMPORTANT: Keep all implementations synchronized. Changes to the public interface must be
 * reflected in all ports. Method names, parameters, and behavior should remain consistent.
 */

private const val TAG = "VaultStorePasskey"

/**
 * Minimum date definition for default values
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

/**
 * Get a passkey by its credential ID (the WebAuthn credential ID, not the parent Credential UUID)
 */
fun VaultStore.getPasskeyByCredentialId(credentialId: ByteArray, db: SQLiteDatabase): Passkey? {
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

    val cursor = db.rawQuery(query, arrayOf(credentialIdString))
    cursor.use {
        if (it.moveToFirst()) {
            return parsePasskeyRow(it)
        }
    }

    return null
}

/**
 * Get all passkeys for a credential
 */
fun VaultStore.getPasskeysForCredential(credentialId: UUID, db: SQLiteDatabase): List<Passkey> {
    val query = """
        SELECT Id, CredentialId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
               DisplayName, CreatedAt, UpdatedAt, IsDeleted
        FROM Passkeys
        WHERE CredentialId = ? AND IsDeleted = 0
        ORDER BY CreatedAt DESC
    """.trimIndent()

    val passkeys = mutableListOf<Passkey>()
    val cursor = db.rawQuery(query, arrayOf(credentialId.toString()))

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
 * Get all passkeys for a specific relying party identifier (RP ID)
 */
fun VaultStore.getPasskeysForRpId(rpId: String, db: SQLiteDatabase): List<Passkey> {
    val query = """
        SELECT Id, CredentialId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
               DisplayName, CreatedAt, UpdatedAt, IsDeleted
        FROM Passkeys
        WHERE RpId = ? AND IsDeleted = 0
        ORDER BY CreatedAt DESC
    """.trimIndent()

    val passkeys = mutableListOf<Passkey>()
    val cursor = db.rawQuery(query, arrayOf(rpId))

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
 * Data class to hold passkey with credential info
 */
data class PasskeyWithCredentialInfo(
    val passkey: Passkey,
    val serviceName: String?,
    val username: String?,
)

/**
 * Get passkeys with credential info for a specific rpId and optionally username
 * Used for finding existing passkeys that might be replaced during registration
 */
fun VaultStore.getPasskeysWithCredentialInfo(
    rpId: String,
    userName: String? = null,
    userId: ByteArray? = null,
    db: SQLiteDatabase,
): List<PasskeyWithCredentialInfo> {
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
    val cursor = db.rawQuery(query, arrayOf(rpId))

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
 * Insert a new passkey into the database
 */
fun VaultStore.insertPasskey(passkey: Passkey, db: SQLiteDatabase) {
    val insert = """
        INSERT INTO Passkeys (Id, CredentialId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                             DisplayName, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """.trimIndent()

    val publicKeyString = String(passkey.publicKey, Charsets.UTF_8)
    val privateKeyString = String(passkey.privateKey, Charsets.UTF_8)

    db.execSQL(
        insert,
        arrayOf(
            passkey.id.toString(),
            passkey.parentCredentialId.toString(),
            passkey.rpId,
            passkey.userHandle,
            publicKeyString,
            privateKeyString,
            passkey.prfKey,
            passkey.displayName,
            formatDateForDatabase(passkey.createdAt),
            formatDateForDatabase(passkey.updatedAt),
            if (passkey.isDeleted) 1 else 0,
        ),
    )
}

/**
 * Create a credential with a passkey
 * This creates a minimal credential record and links the passkey to it
 */
fun VaultStore.createCredentialWithPasskey(
    rpId: String,
    userName: String?,
    displayName: String,
    passkey: Passkey,
    logo: ByteArray? = null,
    db: SQLiteDatabase,
): Credential {
    val credentialId = passkey.parentCredentialId
    val now = Date()
    val timestamp = formatDateForDatabase(now)

    // Create a minimal service for the RP
    val serviceId = UUID.randomUUID()
    val serviceInsert = """
        INSERT INTO Services (Id, Name, Url, Logo, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """.trimIndent()

    db.execSQL(
        serviceInsert,
        arrayOf(
            serviceId.toString(),
            displayName,
            "https://$rpId",
            logo,
            timestamp,
            timestamp,
            0,
        ),
    )

    // Create a minimal alias with empty fields and default birthdate
    val aliasId = UUID.randomUUID()
    val aliasInsert = """
        INSERT INTO Aliases (Id, FirstName, LastName, NickName, BirthDate, Gender, Email,
                            CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """.trimIndent()

    db.execSQL(
        aliasInsert,
        arrayOf(
            aliasId.toString(),
            "",
            "",
            "",
            formatDateForDatabase(MIN_DATE),
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

    db.execSQL(
        credentialInsert,
        arrayOf(
            credentialId.toString(),
            serviceId.toString(),
            aliasId.toString(),
            userName,
            null,
            timestamp,
            timestamp,
            0,
        ),
    )

    // Insert the passkey
    insertPasskey(passkey, db)

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
}

/**
 * Replace an existing passkey with a new one
 * This deletes the old passkey and creates a new one with the same credential
 */
fun VaultStore.replacePasskey(
    oldPasskeyId: UUID,
    newPasskey: Passkey,
    displayName: String,
    logo: ByteArray? = null,
    db: SQLiteDatabase,
) {
    val now = Date()
    val timestamp = formatDateForDatabase(now)

    // Get the old passkey to find its credential
    val oldPasskey = getPasskeyById(oldPasskeyId, db)
        ?: throw VaultStorePasskeyError.PasskeyNotFound("Passkey not found: $oldPasskeyId")

    val credentialId = oldPasskey.parentCredentialId

    // Update the credential's service with new logo if provided
    if (logo != null) {
        // Get the service ID from the credential
        val credQuery = """
            SELECT ServiceId FROM Credentials WHERE Id = ? LIMIT 1
        """.trimIndent()

        val cursor = db.rawQuery(credQuery, arrayOf(credentialId.toString()))
        cursor.use {
            if (it.moveToFirst()) {
                val serviceId = it.getString(0)

                // Update the service with new logo and displayName
                val serviceUpdate = """
                    UPDATE Services
                    SET Logo = ?, Name = ?, UpdatedAt = ?
                    WHERE Id = ?
                """.trimIndent()

                db.execSQL(serviceUpdate, arrayOf(logo, displayName, timestamp, serviceId))
            }
        }
    }

    // Delete the old passkey
    val deleteQuery = """
        UPDATE Passkeys
        SET IsDeleted = 1, UpdatedAt = ?
        WHERE Id = ?
    """.trimIndent()

    db.execSQL(deleteQuery, arrayOf(timestamp, oldPasskeyId.toString()))

    // Create the new passkey with the same credential ID
    val updatedPasskey = newPasskey.copy(
        parentCredentialId = credentialId,
        displayName = displayName,
        createdAt = now,
        updatedAt = now,
        isDeleted = false,
    )

    insertPasskey(updatedPasskey, db)
}

/**
 * Get a passkey by its ID
 */
private fun VaultStore.getPasskeyById(passkeyId: UUID, db: SQLiteDatabase): Passkey? {
    val query = """
        SELECT Id, CredentialId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
               DisplayName, CreatedAt, UpdatedAt, IsDeleted
        FROM Passkeys
        WHERE Id = ? AND IsDeleted = 0
        LIMIT 1
    """.trimIndent()

    val cursor = db.rawQuery(query, arrayOf(passkeyId.toString()))
    cursor.use {
        if (it.moveToFirst()) {
            return parsePasskeyRow(it)
        }
    }

    return null
}

/**
 * Parse a passkey row from database query
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

        // Parse UUIDs
        val id = UUID.fromString(idString)
        val parentCredentialId = UUID.fromString(parentCredentialIdString)

        // Parse dates
        val createdAt = parseDateString(createdAtString) ?: MIN_DATE
        val updatedAt = parseDateString(updatedAtString) ?: MIN_DATE

        // Parse public/private keys
        val publicKeyData = publicKeyString.toByteArray(Charsets.UTF_8)
        val privateKeyData = privateKeyString.toByteArray(Charsets.UTF_8)

        return Passkey(
            id = id,
            parentCredentialId = parentCredentialId,
            rpId = rpId,
            userHandle = userHandle,
            userName = null, // userName not stored in DB, derived from parent credential
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
 * Format a date for database insertion
 * Format: yyyy-MM-dd HH:mm:ss
 */
private fun formatDateForDatabase(date: Date): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(date)
}

/**
 * Parse a date string from the database
 * Format: yyyy-MM-dd HH:mm:ss
 */
private fun parseDateString(dateString: String): Date? {
    return try {
        val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
        formatter.timeZone = TimeZone.getTimeZone("UTC")
        formatter.parse(dateString)
    } catch (e: Exception) {
        Log.e(TAG, "Error parsing date string: $dateString", e)
        null
    }
}

/**
 * VaultStore passkey-specific errors
 */
sealed class VaultStorePasskeyError(message: String) : Exception(message) {
    class VaultNotUnlocked(message: String) : VaultStorePasskeyError(message)
    class PasskeyNotFound(message: String) : VaultStorePasskeyError(message)
    class CredentialNotFound(message: String) : VaultStorePasskeyError(message)
    class DatabaseError(message: String) : VaultStorePasskeyError(message)
}
