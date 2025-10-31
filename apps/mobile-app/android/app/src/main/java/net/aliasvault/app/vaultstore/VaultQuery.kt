package net.aliasvault.app.vaultstore

import android.util.Base64
import android.util.Log
import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.interfaces.CredentialOperationCallback
import net.aliasvault.app.vaultstore.models.Alias
import net.aliasvault.app.vaultstore.models.Credential
import net.aliasvault.app.vaultstore.models.Password
import net.aliasvault.app.vaultstore.models.Service
import java.util.Calendar
import java.util.Date
import java.util.TimeZone
import java.util.UUID

/**
 * Handles SQL query operations on the vault database.
 */
class VaultQuery(
    private val database: VaultDatabase,
) {
    companion object {
        private const val TAG = "VaultQuery"

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

    // region SQL Query Execution

    /**
     * Execute a read-only SQL query (SELECT) on the vault.
     */
    @Suppress("NestedBlockDepth")
    fun executeQuery(query: String, params: Array<Any?>): List<Map<String, Any?>> {
        val results = mutableListOf<Map<String, Any?>>()

        database.dbConnection?.let { db ->
            val convertedParams = params.map { param ->
                if (param is String && param.startsWith("av-base64-to-blob:")) {
                    val base64 = param.substring("av-base64-to-blob:".length)
                    Base64.decode(base64, Base64.NO_WRAP)
                } else {
                    param
                }
            }.toTypedArray()

            val cursor = db.query(query, convertedParams.map { it?.toString() }.toTypedArray())

            cursor.use {
                val columnNames = it.columnNames
                while (it.moveToNext()) {
                    val row = mutableMapOf<String, Any?>()
                    for (columnName in columnNames) {
                        when (it.getType(it.getColumnIndexOrThrow(columnName))) {
                            android.database.Cursor.FIELD_TYPE_NULL -> row[columnName] = null
                            android.database.Cursor.FIELD_TYPE_INTEGER -> row[columnName] = it.getLong(
                                it.getColumnIndexOrThrow(columnName),
                            )
                            android.database.Cursor.FIELD_TYPE_FLOAT -> row[columnName] = it.getDouble(
                                it.getColumnIndexOrThrow(columnName),
                            )
                            android.database.Cursor.FIELD_TYPE_STRING -> row[columnName] = it.getString(
                                it.getColumnIndexOrThrow(columnName),
                            )
                            android.database.Cursor.FIELD_TYPE_BLOB -> row[columnName] = it.getBlob(
                                it.getColumnIndexOrThrow(columnName),
                            )
                        }
                    }
                    results.add(row)
                }
            }
        }

        return results
    }

    /**
     * Execute an SQL update on the vault that mutates it.
     */
    fun executeUpdate(query: String, params: Array<Any?>): Int {
        database.dbConnection?.let { db ->
            val convertedParams = params.map { param ->
                if (param is String && param.startsWith("av-base64-to-blob:")) {
                    val base64 = param.substring("av-base64-to-blob:".length)
                    Base64.decode(base64, Base64.NO_WRAP)
                } else {
                    param
                }
            }.toTypedArray()

            // Execute the statement using compileStatement for non-SELECT queries
            val stmt = db.compileStatement(query)
            try {
                // Bind parameters
                convertedParams.forEachIndexed { index, param ->
                    when (param) {
                        null -> stmt.bindNull(index + 1)
                        is ByteArray -> stmt.bindBlob(index + 1, param)
                        is Long -> stmt.bindLong(index + 1, param)
                        is Double -> stmt.bindDouble(index + 1, param)
                        else -> stmt.bindString(index + 1, param.toString())
                    }
                }
                stmt.execute()
            } finally {
                stmt.close()
            }

            // Get the number of affected rows
            val cursor = db.rawQuery("SELECT changes()", null)
            cursor.use {
                if (it.moveToFirst()) {
                    return it.getInt(0)
                }
            }
        }
        return 0
    }

    /**
     * Execute a raw SQL command on the vault without parameters.
     */
    fun executeRaw(query: String) {
        database.dbConnection?.let { db ->
            val statements = query.split(";")

            for (statement in statements) {
                val trimmedStatement = statement.smartTrim()

                if (trimmedStatement.isEmpty() ||
                    trimmedStatement.uppercase().startsWith("BEGIN") ||
                    trimmedStatement.uppercase().startsWith("COMMIT") ||
                    trimmedStatement.uppercase().startsWith("ROLLBACK")
                ) {
                    continue
                }

                // Use compileStatement and execute for all non-SELECT statements
                val stmt = db.compileStatement(trimmedStatement)
                try {
                    stmt.execute()
                } finally {
                    stmt.close()
                }
            }
        }
    }

    // endregion

    // region Credential Operations

    /**
     * Get all credentials from the vault.
     */
    fun getAllCredentials(): List<Credential> {
        if (database.dbConnection == null) {
            error("Database not initialized")
        }

        val query = """
            WITH LatestPasswords AS (
                SELECT
                    p.Id as password_id,
                    p.CredentialId,
                    p.Value,
                    p.CreatedAt,
                    p.UpdatedAt,
                    p.IsDeleted,
                    ROW_NUMBER() OVER (PARTITION BY p.CredentialId ORDER BY p.CreatedAt DESC) as rn
                FROM Passwords p
                WHERE p.IsDeleted = 0
            )
            SELECT
                c.Id,
                c.AliasId,
                c.Username,
                c.Notes,
                c.CreatedAt,
                c.UpdatedAt,
                c.IsDeleted,
                s.Id as service_id,
                s.Name as service_name,
                s.Url as service_url,
                s.Logo as service_logo,
                s.CreatedAt as service_created_at,
                s.UpdatedAt as service_updated_at,
                s.IsDeleted as service_is_deleted,
                lp.password_id,
                lp.Value as password_value,
                lp.CreatedAt as password_created_at,
                lp.UpdatedAt as password_updated_at,
                lp.IsDeleted as password_is_deleted,
                a.Id as alias_id,
                a.Gender as alias_gender,
                a.FirstName as alias_first_name,
                a.LastName as alias_last_name,
                a.NickName as alias_nick_name,
                a.BirthDate as alias_birth_date,
                a.Email as alias_email,
                a.CreatedAt as alias_created_at,
                a.UpdatedAt as alias_updated_at,
                a.IsDeleted as alias_is_deleted
            FROM Credentials c
            LEFT JOIN Services s ON s.Id = c.ServiceId AND s.IsDeleted = 0
            LEFT JOIN LatestPasswords lp ON lp.CredentialId = c.Id AND lp.rn = 1
            LEFT JOIN Aliases a ON a.Id = c.AliasId AND a.IsDeleted = 0
            WHERE c.IsDeleted = 0
            ORDER BY c.CreatedAt DESC
        """

        val result = mutableListOf<Credential>()
        val cursor = database.dbConnection?.query(query)

        cursor?.use {
            while (it.moveToNext()) {
                try {
                    val id = UUID.fromString(it.getString(0))
                    val isDeleted = it.getInt(6) == 1

                    val serviceId = UUID.fromString(it.getString(7))
                    val service = Service(
                        id = serviceId,
                        name = it.getString(8),
                        url = it.getString(9),
                        logo = it.getBlob(10),
                        createdAt = DateHelpers.parseDateString(it.getString(11)) ?: MIN_DATE,
                        updatedAt = DateHelpers.parseDateString(it.getString(12)) ?: MIN_DATE,
                        isDeleted = it.getInt(13) == 1,
                    )

                    var password: Password? = null
                    if (!it.isNull(14)) {
                        password = Password(
                            id = UUID.fromString(it.getString(14)),
                            credentialId = id,
                            value = it.getString(15),
                            createdAt = DateHelpers.parseDateString(it.getString(16)) ?: MIN_DATE,
                            updatedAt = DateHelpers.parseDateString(it.getString(17)) ?: MIN_DATE,
                            isDeleted = it.getInt(18) == 1,
                        )
                    }

                    var alias: Alias? = null
                    if (!it.isNull(19)) {
                        alias = Alias(
                            id = UUID.fromString(it.getString(19)),
                            gender = it.getString(20),
                            firstName = it.getString(21),
                            lastName = it.getString(22),
                            nickName = it.getString(23),
                            birthDate = DateHelpers.parseDateString(it.getString(24)) ?: MIN_DATE,
                            email = it.getString(25),
                            createdAt = DateHelpers.parseDateString(it.getString(26)) ?: MIN_DATE,
                            updatedAt = DateHelpers.parseDateString(it.getString(27)) ?: MIN_DATE,
                            isDeleted = it.getInt(28) == 1,
                        )
                    }

                    val credential = Credential(
                        id = id,
                        alias = alias,
                        service = service,
                        username = it.getString(2),
                        notes = it.getString(3),
                        password = password,
                        createdAt = DateHelpers.parseDateString(it.getString(4)) ?: MIN_DATE,
                        updatedAt = DateHelpers.parseDateString(it.getString(5)) ?: MIN_DATE,
                        isDeleted = isDeleted,
                    )
                    result.add(credential)
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing credential row", e)
                }
            }
        }

        return result
    }

    /**
     * Attempts to get all credentials using only the cached encryption key.
     */
    fun tryGetAllCredentials(callback: CredentialOperationCallback, crypto: VaultCrypto, unlockVault: () -> Unit): Boolean {
        if (crypto.encryptionKey == null) {
            Log.d(TAG, "Encryption key not in memory, authentication required")
            return false
        }

        try {
            if (!database.isVaultUnlocked()) {
                unlockVault()
            }

            callback.onSuccess(getAllCredentials())
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error retrieving credentials", e)
            callback.onError(e)
            return false
        }
    }

    /**
     * Get the database version from the __EFMigrationsHistory table.
     */
    fun getDatabaseVersion(): String {
        val query = "SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1"
        val results = executeQuery(query, emptyArray())

        if (results.isEmpty()) {
            Log.d(TAG, "No migrations found in database, returning default version")
            return "0.0.0"
        }

        val migrationId = results[0]["MigrationId"] as? String
        if (migrationId == null) {
            return "0.0.0"
        }

        val versionRegex = Regex("_(\\d+\\.\\d+\\.\\d+)-")
        val match = versionRegex.find(migrationId)

        return if (match != null && match.groupValues.size > 1) {
            match.groupValues[1]
        } else {
            Log.d(TAG, "Could not extract version from migration ID '$migrationId', returning default")
            "0.0.0"
        }
    }

    // endregion

    // region Helper Functions

    private fun String.smartTrim(): String {
        val invisible = "[\\uFEFF\\u200B\\u00A0\\u202A-\\u202E\\u2060\\u180E]"
        return this.replace(Regex("^($invisible)+|($invisible)+$"), "").trim()
    }

    // endregion
}
