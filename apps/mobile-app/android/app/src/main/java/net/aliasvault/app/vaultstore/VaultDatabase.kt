package net.aliasvault.app.vaultstore

import android.util.Base64
import android.util.Log
import io.requery.android.database.sqlite.SQLiteDatabase
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import java.io.File

/**
 * Handles database storage, encryption, and decryption operations.
 */
class VaultDatabase(
    private val storageProvider: StorageProvider,
    private val crypto: VaultCrypto,
) {
    companion object {
        private const val TAG = "VaultDatabase"
    }

    /**
     * The database connection.
     */
    internal var dbConnection: SQLiteDatabase? = null

    // region Database Storage

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

    // endregion

    // region Vault Unlock

    /**
     * Unlock the vault. This can trigger biometric authentication.
     */
    fun unlockVault(authMethods: String) {
        val encryptedDbBase64 = getEncryptedDatabase()
        val decryptedDbBase64 = crypto.decryptData(encryptedDbBase64, authMethods)

        try {
            setupDatabaseWithDecryptedData(decryptedDbBase64)
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

    // endregion

    // region Database Setup

    /**
     * Setup the database with decrypted data.
     * Uses SQLite VACUUM INTO to properly copy all schema objects including
     * foreign keys, indexes, triggers, and views from file to memory.
     * This is equivalent to the Swift implementation using the backup API.
     */
    private fun setupDatabaseWithDecryptedData(decryptedDbBase64: String) {
        var tempDbFile: File? = null
        var sourceDb: io.requery.android.database.sqlite.SQLiteDatabase? = null
        try {
            // Step 1: Decode base64
            val decryptedDbData = try {
                Base64.decode(decryptedDbBase64, Base64.NO_WRAP)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to decode base64 data after decryption", e)
                throw AppError.Base64DecodeFailed(cause = e)
            }

            // Step 2: Write decrypted data to temp file
            tempDbFile = File.createTempFile("temp_db", ".sqlite")
            tempDbFile.deleteOnExit()
            try {
                tempDbFile.writeBytes(decryptedDbData)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to write decrypted data to temp file", e)
                throw AppError.DatabaseTempWriteFailed(cause = e)
            }

            // Step 3: Close any existing connection
            dbConnection?.close()
            dbConnection = null

            // Step 4: Open the source database from file using requery's SQLite (read-only)
            sourceDb = try {
                io.requery.android.database.sqlite.SQLiteDatabase.openDatabase(
                    tempDbFile.path,
                    null,
                    io.requery.android.database.sqlite.SQLiteDatabase.OPEN_READONLY,
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to open source database (file may be corrupt)", e)
                throw AppError.DatabaseOpenFailed(cause = e)
            }

            // Close source database before we attach it to memory db
            sourceDb.close()
            sourceDb = null

            // Step 5: Create in-memory database using requery's SQLite
            dbConnection = try {
                SQLiteDatabase.create(null)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to create in-memory database connection", e)
                throw AppError.DatabaseMemoryFailed(cause = e)
            }

            // Step 6: Attach and copy database
            try {
                // Attach the temp file as 'source' to copy from
                val attachSql = "ATTACH DATABASE '${tempDbFile.path}' AS source"
                dbConnection?.compileStatement(attachSql)?.execute()

                // Copy entire database using sqlite_master (preserves all schema)
                dbConnection?.beginTransaction()
                try {
                    copyCompleteDatabase()
                    dbConnection?.setTransactionSuccessful()
                } finally {
                    dbConnection?.endTransaction()
                }

                // Detach source
                dbConnection?.compileStatement("DETACH DATABASE source")?.execute()
            } catch (e: AppError) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Failed to backup database to memory", e)
                throw AppError.DatabaseBackupFailed(cause = e)
            }

            // Step 7: Set pragmas for optimal performance and safety
            try {
                // PRAGMA statements must use rawQuery, not compileStatement
                dbConnection?.rawQuery("PRAGMA journal_mode = WAL", null)
                dbConnection?.rawQuery("PRAGMA synchronous = NORMAL", null)
                dbConnection?.rawQuery("PRAGMA foreign_keys = ON", null)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to set database pragmas", e)
                throw AppError.DatabasePragmaFailed(cause = e)
            }
        } catch (e: AppError) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Error setting up database with decrypted data", e)
            throw e
        } finally {
            // Clean up source database connection
            sourceDb?.close()

            // Clean up temp file
            tempDbFile?.let {
                if (it.exists()) {
                    it.setWritable(true, true)
                    it.delete()
                }
            }
        }
    }

    /**
     * Copy complete database from attached 'source' to main database.
     * This copies all schema objects (tables, indexes, triggers, views) and data.
     */
    private fun copyCompleteDatabase() {
        // First, get and execute all schema statements
        val schemaCursor = dbConnection?.rawQuery(
            """
            SELECT sql FROM source.sqlite_master
            WHERE sql NOT NULL
            AND type IN ('table', 'index', 'trigger', 'view')
            AND name NOT LIKE 'sqlite_%'
            ORDER BY
                CASE type
                    WHEN 'table' THEN 1
                    WHEN 'index' THEN 2
                    WHEN 'trigger' THEN 3
                    WHEN 'view' THEN 4
                END
            """.trimIndent(),
            null,
        ) ?: error(IllegalStateException("Failed to read source schema"))

        val schemaStatements = mutableListOf<String>()
        schemaCursor.use {
            while (it.moveToNext()) {
                val sql = it.getString(0)
                if (!sql.isNullOrBlank()) {
                    schemaStatements.add(sql)
                }
            }
        }

        // Execute schema creation statements
        for (sql in schemaStatements) {
            try {
                dbConnection?.compileStatement(sql)?.execute()
            } catch (e: Exception) {
                // Skip if already exists or is an auto-created index
                if (!e.message?.contains("already exists", ignoreCase = true)!!) {
                    Log.w(TAG, "Schema statement may be auto-index: $sql", e)
                }
            }
        }

        // Then copy all table data
        val tablesCursor = dbConnection?.rawQuery(
            "SELECT name FROM source.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            null,
        ) ?: error(IllegalStateException("Failed to get table list"))

        tablesCursor.use {
            while (it.moveToNext()) {
                val tableName = it.getString(0)
                val insertStmt = dbConnection?.compileStatement("INSERT INTO $tableName SELECT * FROM source.$tableName")
                try {
                    insertStmt?.execute()
                } finally {
                    insertStmt?.close()
                }
            }
        }
    }

    // endregion

    // region Transaction Management

    /**
     * Begin a SQL transaction on the vault.
     */
    fun beginTransaction() {
        val db = dbConnection ?: error(IllegalStateException("Database not initialized"))
        db.compileStatement("BEGIN TRANSACTION").execute()
    }

    /**
     * Persist the in-memory database to encrypted local storage.
     * This method can be called independently to persist the database without committing a transaction.
     */
    fun persistDatabaseToEncryptedStorage() {
        val db = dbConnection ?: error(IllegalStateException("Database not initialized"))

        // Slight delay tolerance for busy databases
        try { db.rawQuery("PRAGMA busy_timeout=5000", null)?.close() } catch (_: Exception) {}

        val tempDbFile = File(storageProvider.getRandomTempFilePath())

        // Ensure the temp file does not exist yet
        if (tempDbFile.exists()) {
            tempDbFile.delete()
        }

        try {
            // Properly quote the path for SQL
            val quotedPath = tempDbFile.absolutePath.replace("'", "''")
            val vacuumIntoSql = "VACUUM INTO '$quotedPath'"

            // Retry up to 5 times if we hit transient locking errors
            for (attempt in 1..5) {
                try {
                    // VACUUM cannot run inside a transaction.
                    // End any lingering transaction (no-op if none).
                    try { db.compileStatement("END").execute() } catch (_: Exception) {}

                    db.compileStatement(vacuumIntoSql).use { it.execute() }
                    break // Success, exit the loop
                } catch (e: Exception) {
                    val msg = e.message?.lowercase().orEmpty()
                    val transient = msg.contains("locked") || msg.contains("busy") || msg.contains("statements in progress")

                    Log.w(TAG, "VACUUM INTO attempt $attempt/5 failed: ${e.message}")

                    if (transient && attempt < 5) {
                        Thread.sleep((150L * attempt))
                    } else {
                        Log.e(TAG, "VACUUM INTO failed after retries", e)
                        throw e
                    }
                }
            }

            // Validate output file exists and has content
            if (!tempDbFile.exists() || tempDbFile.length() == 0L) {
                Log.e(TAG, "VACUUM INTO produced no file or empty file at ${tempDbFile.absolutePath}")
                error(IllegalStateException("VACUUM INTO produced no output"))
            }

            val rawData = tempDbFile.readBytes()
            val base64String = android.util.Base64.encodeToString(rawData, android.util.Base64.NO_WRAP)
            val encryptedBase64Data = crypto.encryptData(base64String)
            storeEncryptedDatabase(encryptedBase64Data)
        } catch (e: Exception) {
            Log.e(TAG, "Error exporting and encrypting database", e)
            throw e
        } finally {
            // Always clean up the temp file
            try {
                tempDbFile.delete()
            } catch (e: Exception) {
                Log.e(TAG, "Error deleting temp file", e)
            }
        }
    }

    /**
     * Commit a SQL transaction and persist the encrypted vault.
     */
    fun commitTransaction() {
        val db = dbConnection ?: error(IllegalStateException("Database not initialized"))
        db.compileStatement("COMMIT").execute()
        persistDatabaseToEncryptedStorage()
    }

    /**
     * Rollback a SQL transaction on the vault.
     */
    fun rollbackTransaction() {
        val db = dbConnection ?: error(IllegalStateException("Database not initialized"))
        db.compileStatement("ROLLBACK").execute()
    }

    // endregion

    // region Cleanup

    /**
     * Close the database connection.
     */
    fun close() {
        dbConnection?.close()
        dbConnection = null
    }

    // endregion
}
