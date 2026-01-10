package net.aliasvault.app.vaultstore.repositories

import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.VaultDatabase
import java.util.UUID

/**
 * Base repository class with common database operations.
 * Provides transaction handling, soft delete, and other shared functionality.
 */
open class BaseRepository(
    /** The database component used for executing queries. */
    protected val database: VaultDatabase,
) {
    // MARK: - Transaction Helpers

    /**
     * Execute a function within a transaction.
     * Automatically handles begin, commit, and rollback.
     * @param operation The function to execute within the transaction
     * @return The result of the function
     */
    fun <T> withTransaction(operation: () -> T): T {
        database.beginTransaction()
        return try {
            val result = operation()
            database.commitTransaction()
            result
        } catch (e: Exception) {
            database.rollbackTransaction()
            throw e
        }
    }

    // MARK: - Soft Delete Helpers

    /**
     * Soft delete a record by setting IsDeleted = 1.
     * @param table The table name
     * @param id The record ID
     * @return Number of rows affected
     */
    fun softDelete(table: String, id: String): Int {
        val timestamp = now()
        return executeUpdate(
            "UPDATE $table SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?",
            arrayOf(timestamp, id),
        )
    }

    /**
     * Soft delete records by a foreign key.
     * @param table The table name
     * @param foreignKey The foreign key column name
     * @param foreignKeyValue The foreign key value
     * @return Number of rows affected
     */
    fun softDeleteByForeignKey(table: String, foreignKey: String, foreignKeyValue: String): Int {
        val timestamp = now()
        return executeUpdate(
            "UPDATE $table SET IsDeleted = 1, UpdatedAt = ? WHERE $foreignKey = ?",
            arrayOf(timestamp, foreignKeyValue),
        )
    }

    // MARK: - Hard Delete Helpers

    /**
     * Hard delete a record permanently.
     * @param table The table name
     * @param id The record ID
     * @return Number of rows affected
     */
    fun hardDelete(table: String, id: String): Int {
        return executeUpdate(
            "DELETE FROM $table WHERE Id = ?",
            arrayOf(id),
        )
    }

    /**
     * Hard delete records by a foreign key.
     * @param table The table name
     * @param foreignKey The foreign key column name
     * @param foreignKeyValue The foreign key value
     * @return Number of rows affected
     */
    fun hardDeleteByForeignKey(table: String, foreignKey: String, foreignKeyValue: String): Int {
        return executeUpdate(
            "DELETE FROM $table WHERE $foreignKey = ?",
            arrayOf(foreignKeyValue),
        )
    }

    // MARK: - Utility Methods

    /**
     * Check if a table exists in the database.
     * @param tableName The name of the table to check
     * @return True if the table exists
     */
    fun tableExists(tableName: String): Boolean {
        val results = executeQuery(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            arrayOf(tableName),
        )
        return results.isNotEmpty()
    }

    /**
     * Generate a new UUID in uppercase format.
     * @return A new UUID string
     */
    fun generateId(): String {
        return UUID.randomUUID().toString().uppercase()
    }

    /**
     * Get the current timestamp in the standard format.
     * @return Current timestamp string
     */
    fun now(): String {
        return DateHelpers.now()
    }

    /**
     * Build a parameterized IN clause for SQL queries.
     * @param values Array of values for the IN clause
     * @return Pair with placeholders string and values array
     */
    fun buildInClause(values: List<String>): Pair<String, Array<String>> {
        val placeholders = values.joinToString(",") { "?" }
        return Pair(placeholders, values.toTypedArray())
    }

    // MARK: - Database Operation Helpers

    /**
     * Execute a SELECT query on the database.
     */
    protected fun executeQuery(query: String, params: Array<Any?>): List<Map<String, Any?>> {
        val db = database.dbConnection ?: error("Database not initialized")
        val cursor = db.query(query, params.map { it?.toString() }.toTypedArray())

        val results = mutableListOf<Map<String, Any?>>()
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

        return results
    }

    /**
     * Execute an UPDATE, INSERT, or DELETE query on the database.
     */
    protected fun executeUpdate(query: String, params: Array<Any?>): Int {
        val db = database.dbConnection ?: error("Database not initialized")

        val statement = db.compileStatement(query)
        try {
            // Bind parameters
            params.forEachIndexed { index, param ->
                when (param) {
                    null -> statement.bindNull(index + 1)
                    is ByteArray -> statement.bindBlob(index + 1, param)
                    is Long -> statement.bindLong(index + 1, param)
                    is Double -> statement.bindDouble(index + 1, param)
                    else -> statement.bindString(index + 1, param.toString())
                }
            }
            statement.execute()
        } finally {
            statement.close()
        }

        // Get the number of affected rows
        val cursor = db.rawQuery("SELECT changes()", null)
        cursor.use {
            if (it.moveToFirst()) {
                return it.getInt(0)
            }
        }

        return 0
    }
}
