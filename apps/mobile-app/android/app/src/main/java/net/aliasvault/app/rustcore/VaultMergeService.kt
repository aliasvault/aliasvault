package net.aliasvault.app.rustcore

import android.database.sqlite.SQLiteDatabase
import android.util.Base64
import android.util.Log
import net.aliasvault.app.vaultstore.VaultCrypto
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Service for vault merge operations using the Rust core library.
 * Wraps UniFFI-generated bindings for LWW merge operations on SQLite vault databases.
 */
object VaultMergeService {
    private const val TAG = "VaultMergeService"

    init {
        // Ensure JNA is initialized before loading the Rust library
        JnaInitializer.ensureInitialized()
        System.loadLibrary("aliasvault_core")
        Log.d(TAG, "Rust core library loaded")
    }

    /**
     * Base exception for vault merge operations.
     */
    sealed class VaultMergeException(message: String) : Exception(message) {
        /**
         * Exception thrown when JSON parsing or serialization fails.
         */
        class JsonError(message: String) : VaultMergeException("JSON error: $message")

        /**
         * Exception thrown when Rust core operations fail.
         */
        class RustError(message: String) : VaultMergeException("Rust error: $message")

        /**
         * Exception thrown when database operations fail.
         */
        class DatabaseError(message: String) : VaultMergeException("Database error: $message")

        /**
         * Exception thrown when input validation fails.
         */
        class InvalidInput(message: String) : VaultMergeException("Invalid input: $message")
    }

    /**
     * Get the list of syncable table names from Rust.
     */
    fun getTableNames(): List<String> {
        return uniffi.aliasvault_core.getSyncableTableNames()
    }

    /**
     * Merge local and server vaults using LWW strategy.
     */
    @Suppress("SwallowedException") // Exceptions are logged and re-thrown with context
    @Throws(VaultMergeException::class)
    fun mergeVaults(
        localVaultBase64: String,
        serverVaultBase64: String,
        encryptionKey: ByteArray,
        tempDir: File,
    ): String {
        // Decrypt both vaults
        val localDecrypted = try {
            VaultCrypto.decrypt(Base64.decode(localVaultBase64, Base64.DEFAULT), encryptionKey)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decrypt local vault", e)
            throw VaultMergeException.InvalidInput("Failed to decrypt local vault: ${e.message}")
        }

        val serverDecrypted = try {
            VaultCrypto.decrypt(Base64.decode(serverVaultBase64, Base64.DEFAULT), encryptionKey)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decrypt server vault", e)
            throw VaultMergeException.InvalidInput("Failed to decrypt server vault: ${e.message}")
        }

        // Create temporary database files
        val localDbFile = File(tempDir, "local_merge_temp.db")
        val serverDbFile = File(tempDir, "server_merge_temp.db")

        try {
            localDbFile.writeBytes(localDecrypted)
            serverDbFile.writeBytes(serverDecrypted)

            val localDb = SQLiteDatabase.openDatabase(localDbFile.absolutePath, null, SQLiteDatabase.OPEN_READWRITE)
            val serverDb = SQLiteDatabase.openDatabase(serverDbFile.absolutePath, null, SQLiteDatabase.OPEN_READONLY)

            try {
                // Read all syncable tables
                val tableNames = getTableNames()
                val localTables = JSONArray()
                val serverTables = JSONArray()

                for (tableName in tableNames) {
                    localTables.put(
                        JSONObject().apply {
                            put("name", tableName)
                            put("records", readTable(localDb, tableName))
                        },
                    )
                    serverTables.put(
                        JSONObject().apply {
                            put("name", tableName)
                            put("records", readTable(serverDb, tableName))
                        },
                    )
                }

                // Call Rust merge
                val mergeInput = JSONObject().apply {
                    put("local_tables", localTables)
                    put("server_tables", serverTables)
                }

                val outputJson = uniffi.aliasvault_core.mergeVaultsJson(mergeInput.toString())
                val statements = parseStatements(outputJson)

                // Apply SQL statements
                localDb.beginTransaction()
                try {
                    for ((sql, params) in statements) {
                        localDb.execSQL(sql, params.toTypedArray())
                    }
                    localDb.setTransactionSuccessful()
                } finally {
                    localDb.endTransaction()
                }

                localDb.close()
                serverDb.close()

                // Encrypt and return
                val mergedData = localDbFile.readBytes()
                val encrypted = VaultCrypto.encrypt(mergedData, encryptionKey)
                return Base64.encodeToString(encrypted, Base64.DEFAULT)
            } finally {
                if (localDb.isOpen) localDb.close()
                if (serverDb.isOpen) serverDb.close()
            }
        } finally {
            localDbFile.delete()
            serverDbFile.delete()
        }
    }

    /**
     * Prune expired items from trash.
     */
    @Suppress("SwallowedException") // Exceptions are logged and re-thrown with context
    @Throws(VaultMergeException::class)
    fun pruneVault(
        vaultBase64: String,
        retentionDays: Int = 30,
        encryptionKey: ByteArray,
        tempDir: File,
    ): Pair<String, Int> {
        val decrypted = try {
            VaultCrypto.decrypt(Base64.decode(vaultBase64, Base64.DEFAULT), encryptionKey)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decrypt vault for pruning", e)
            throw VaultMergeException.InvalidInput("Failed to decrypt vault: ${e.message}")
        }

        val dbFile = File(tempDir, "prune_temp.db")

        try {
            dbFile.writeBytes(decrypted)
            val db = SQLiteDatabase.openDatabase(dbFile.absolutePath, null, SQLiteDatabase.OPEN_READWRITE)

            try {
                // Read tables needed for pruning
                val pruneTableNames = listOf("Items", "FieldValues", "Attachments", "TotpCodes", "Passkeys")
                val tables = JSONArray()

                for (tableName in pruneTableNames) {
                    tables.put(
                        JSONObject().apply {
                            put("name", tableName)
                            put("records", readTable(db, tableName))
                        },
                    )
                }

                // Call Rust prune
                val pruneInput = JSONObject().apply {
                    put("tables", tables)
                    put("retention_days", retentionDays)
                }

                val outputJson = uniffi.aliasvault_core.pruneVaultJson(pruneInput.toString())
                val statements = parseStatements(outputJson)

                // Apply SQL statements
                db.beginTransaction()
                try {
                    for ((sql, params) in statements) {
                        db.execSQL(sql, params.toTypedArray())
                    }
                    db.setTransactionSuccessful()
                } finally {
                    db.endTransaction()
                }

                db.close()

                // Encrypt and return
                val prunedData = dbFile.readBytes()
                val encrypted = VaultCrypto.encrypt(prunedData, encryptionKey)
                return Pair(Base64.encodeToString(encrypted, Base64.DEFAULT), statements.size)
            } finally {
                if (db.isOpen) db.close()
            }
        } finally {
            dbFile.delete()
        }
    }

    private fun readTable(db: SQLiteDatabase, tableName: String): JSONArray {
        val records = JSONArray()

        // Check if table exists
        val checkCursor = db.rawQuery(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            arrayOf(tableName),
        )
        val tableExists = checkCursor.moveToFirst()
        checkCursor.close()
        if (!tableExists) return records

        // Read all records
        val cursor = db.rawQuery("SELECT * FROM $tableName", null)
        try {
            while (cursor.moveToNext()) {
                val record = JSONObject()
                for (i in 0 until cursor.columnCount) {
                    val columnName = cursor.getColumnName(i)
                    val value = when (cursor.getType(i)) {
                        android.database.Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(i)
                        android.database.Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(i)
                        android.database.Cursor.FIELD_TYPE_STRING -> cursor.getString(i)
                        android.database.Cursor.FIELD_TYPE_BLOB -> Base64.encodeToString(cursor.getBlob(i), Base64.DEFAULT)
                        else -> JSONObject.NULL
                    }
                    record.put(columnName, value)
                }
                records.put(record)
            }
        } finally {
            cursor.close()
        }

        return records
    }

    private fun parseStatements(json: String): List<Pair<String, List<String?>>> {
        val output = JSONObject(json)
        val statementsArray = output.optJSONArray("statements") ?: JSONArray()
        val statements = mutableListOf<Pair<String, List<String?>>>()

        for (i in 0 until statementsArray.length()) {
            val stmt = statementsArray.getJSONObject(i)
            val sql = stmt.getString("sql")
            val paramsArray = stmt.optJSONArray("params") ?: JSONArray()
            val params = (0 until paramsArray.length()).map { j ->
                val param = paramsArray.opt(j)
                if (param == JSONObject.NULL || param == null) null else param.toString()
            }
            statements.add(Pair(sql, params))
        }

        return statements
    }
}
