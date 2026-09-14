package net.aliasvault.app.vaultstore

import android.database.Cursor
import android.database.MatrixCursor
import android.util.Base64
import android.util.Log
import net.aliasvault.app.rustcore.JnaInitializer
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import uniffi.aliasvault_core.SqlValue
import uniffi.aliasvault_core.SqliteMemoryDatabase

/**
 * The live vault database: the decrypted bytes are opened in memory using the Rust core's SQLite client.
 */
class VaultDatabase(
    private val storageProvider: StorageProvider,
    private val crypto: VaultCrypto,
) {
    companion object {
        private const val TAG = "VaultDatabase"
    }

    private var db: SqliteMemoryDatabase? = null

    /**
     * Store the encrypted database in the storage provider.
     */
    fun storeEncryptedDatabase(encryptedData: String) {
        storageProvider.setEncryptedDatabaseFile(encryptedData)
    }

    /**
     * Get the encrypted database from the storage provider.
     */
    fun getEncryptedDatabase(): String {
        return storageProvider.getEncryptedDatabaseFile().readText()
    }

    /**
     * Check if the encrypted database exists in the storage provider.
     */
    fun hasEncryptedDatabase(): Boolean {
        return storageProvider.getEncryptedDatabaseFile().exists()
    }

    /**
     * The id of the user's personal manifest as the last sync recorded it (engine state, stored as `{"v": id}`),
     * or null before the first pull.
     */
    fun getPersonalManifestId(): String? {
        val json = storageProvider.getSyncEngineState("vaultPersonalManifestId") ?: return null
        return org.json.JSONObject(json).optString("v").takeIf { it.isNotEmpty() }
    }

    /**
     * Unlock the vault. This can trigger biometric authentication.
     */
    fun unlockVault(authMethods: String) {
        val decrypted = crypto.decryptDataBytes(getEncryptedDatabase(), authMethods)
        try {
            open(decrypted)
        } catch (e: Exception) {
            Log.e(TAG, "Error unlocking vault", e)
            throw e
        }
    }

    /**
     * Check if the vault is unlocked.
     */
    fun isVaultUnlocked(): Boolean {
        return crypto.encryptionKey != null
    }

    /**
     * Whether a database is open.
     */
    fun isOpen(): Boolean = db != null

    /**
     * Open the decrypted vault in memory. The plaintext is either the raw SQLite bytes
     * or base64 text of them (legacy pre-0.31.0).
     */
    private fun open(decrypted: ByteArray) {
        val bytes = if (isSqliteDatabase(decrypted)) {
            decrypted
        } else {
            try {
                Base64.decode(String(decrypted, Charsets.UTF_8), Base64.NO_WRAP)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to decode base64 data after decryption", e)
                throw AppError.Base64DecodeFailed(cause = e)
            }
        }

        close()
        JnaInitializer.ensureInitialized()
        val opened = try {
            SqliteMemoryDatabase.fromBytes(bytes).also {
                it.queryValues("SELECT count(*) FROM sqlite_master", emptyList())
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open the vault database (data may be corrupt)", e)
            throw AppError.DatabaseOpenFailed(cause = e)
        }
        try {
            opened.executeBatch("PRAGMA foreign_keys = ON")
        } catch (e: Exception) {
            opened.destroy()
            Log.e(TAG, "Failed to set database pragmas", e)
            throw AppError.DatabasePragmaFailed(cause = e)
        }
        db = opened
    }

    /**
     * The open database.
     */
    internal fun connection(): SqliteMemoryDatabase = db ?: error("Database not initialized")

    /**
     * Run a SELECT and return its rows keyed by column name. Values are String, Long, Double, ByteArray or null.
     */
    fun query(sql: String, params: List<Any?> = emptyList()): List<Map<String, Any?>> {
        val result = connection().queryValues(sql, params.map(::toSqlValue))
        return result.rows.map { row -> row.indices.associate { result.columns[it] to fromSqlValue(row[it]) } }
    }

    /**
     * Run a SELECT and return its rows as a cursor, for positional column access.
     */
    fun queryCursor(sql: String, params: List<Any?> = emptyList()): Cursor {
        val result = connection().queryValues(sql, params.map(::toSqlValue))
        return MatrixCursor(result.columns.toTypedArray(), result.rows.size).also { cursor ->
            for (row in result.rows) {
                cursor.addRow(row.map(::fromSqlValue).toTypedArray())
            }
        }
    }

    /**
     * Run one INSERT, UPDATE or DELETE and return the number of rows it changed.
     */
    fun execute(sql: String, params: List<Any?> = emptyList()): Int {
        return connection().execute(sql, params.map(::toSqlValue)).toInt()
    }

    /**
     * Run a multi-statement script without parameters. Migration scripts manage their own transactions and
     * pragmas, so nothing is wrapped around them.
     */
    fun executeScript(sql: String) {
        connection().executeBatch(sql)
    }

    private fun toSqlValue(value: Any?): SqlValue = when (value) {
        null -> SqlValue.Null
        is SqlValue -> value
        is ByteArray -> SqlValue.Blob(value)
        is Boolean -> SqlValue.Integer(if (value) 1L else 0L)
        is Int -> SqlValue.Integer(value.toLong())
        is Long -> SqlValue.Integer(value)
        is Float -> SqlValue.Real(value.toDouble())
        is Double -> SqlValue.Real(value)
        else -> SqlValue.Text(value.toString())
    }

    private fun fromSqlValue(value: SqlValue): Any? = when (value) {
        is SqlValue.Null -> null
        is SqlValue.Integer -> value.v1
        is SqlValue.Real -> value.v1
        is SqlValue.Text -> value.v1
        is SqlValue.Blob -> value.v1
    }

    /**
     * Begin a SQL transaction on the vault.
     */
    fun beginTransaction() {
        connection().executeBatch("BEGIN TRANSACTION")
    }

    /**
     * Commit a SQL transaction and persist the encrypted vault.
     */
    fun commitTransaction() {
        connection().executeBatch("COMMIT")
        persistDatabaseToEncryptedStorage()
    }

    /**
     * Rollback a SQL transaction on the vault.
     */
    fun rollbackTransaction() {
        connection().executeBatch("ROLLBACK")
    }

    /**
     * Persist the in-memory database to encrypted local storage.
     * This method can be called independently to persist the database without committing a transaction.
     */
    fun persistDatabaseToEncryptedStorage() {
        val connection = connection()
        // End any open transactions.
        try { connection.executeBatch("END") } catch (_: Exception) {}
        try {
            storeEncryptedDatabase(crypto.encryptBytes(export()))
        } catch (e: Exception) {
            Log.e(TAG, "Error exporting and encrypting database", e)
            throw e
        }
    }

    /**
     * The database as SQLite file bytes, compacted first when no transaction is open.
     */
    fun export(): ByteArray {
        val connection = connection()
        try { connection.executeBatch("VACUUM") } catch (_: Exception) {}
        return connection.export()
    }

    /**
     * Close the database connection.
     */
    fun close() {
        db?.destroy()
        db = null
    }

    /**
     * Whether these plaintext bytes are a SQLite database rather than base64 text of one.
     */
    private fun isSqliteDatabase(bytes: ByteArray): Boolean {
        val header = "SQLite format 3\u0000".toByteArray(Charsets.UTF_8)
        return bytes.size >= header.size && header.indices.all { bytes[it] == header[it] }
    }
}
