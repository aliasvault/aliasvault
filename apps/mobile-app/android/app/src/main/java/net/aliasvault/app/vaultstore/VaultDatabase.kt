package net.aliasvault.app.vaultstore

import android.database.sqlite.SQLiteDatabase
import android.util.Base64
import android.util.Log
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
     */
    private fun setupDatabaseWithDecryptedData(decryptedDbBase64: String) {
        var tempDbFile: File? = null
        try {
            val decryptedDbData = Base64.decode(decryptedDbBase64, Base64.NO_WRAP)

            tempDbFile = File.createTempFile("temp_db", ".sqlite")
            tempDbFile.deleteOnExit()
            tempDbFile.writeBytes(decryptedDbData)

            dbConnection?.close()

            dbConnection = SQLiteDatabase.create(null)

            dbConnection?.beginTransaction()

            try {
                val attachQuery = "ATTACH DATABASE '${tempDbFile.path}' AS source"
                dbConnection?.execSQL(attachQuery)

                val verifyCursor = dbConnection?.rawQuery(
                    "SELECT name FROM source.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
                    null,
                )

                if (verifyCursor == null) {
                    throw android.database.sqlite.SQLiteException("Failed to attach source database")
                }

                verifyCursor.use {
                    if (!it.moveToFirst()) {
                        throw android.database.sqlite.SQLiteException("No tables found in source database")
                    }

                    do {
                        val tableName = it.getString(0)
                        dbConnection?.execSQL(
                            "CREATE TABLE $tableName AS SELECT * FROM source.$tableName",
                        )
                    } while (it.moveToNext())
                }

                dbConnection?.setTransactionSuccessful()
            } finally {
                dbConnection?.endTransaction()
            }

            dbConnection?.rawQuery("DETACH DATABASE source", null)

            dbConnection?.rawQuery("PRAGMA journal_mode = WAL", null)
            dbConnection?.rawQuery("PRAGMA synchronous = NORMAL", null)
            dbConnection?.rawQuery("PRAGMA foreign_keys = ON", null)
        } catch (e: Exception) {
            Log.e(TAG, "Error setting up database with decrypted data", e)
            throw e
        } finally {
            tempDbFile?.let {
                if (it.exists()) {
                    it.setWritable(true, true)
                    it.delete()
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
        dbConnection?.beginTransaction()
    }

    /**
     * Persist the in-memory database to encrypted local storage.
     * This method can be called independently to persist the database without committing a transaction.
     */
    fun persistDatabaseToEncryptedStorage() {
        val tempDbFile = File.createTempFile("temp_db", ".sqlite")
        tempDbFile.deleteOnExit()

        try {
            dbConnection?.execSQL("ATTACH DATABASE '${tempDbFile.path}' AS target")

            dbConnection?.beginTransaction()

            try {
                val cursor = dbConnection?.rawQuery(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%'",
                    null,
                )

                cursor?.use {
                    while (it.moveToNext()) {
                        val tableName = it.getString(0)
                        dbConnection?.execSQL(
                            "CREATE TABLE target.$tableName AS SELECT * FROM main.$tableName",
                        )
                    }
                }

                dbConnection?.setTransactionSuccessful()
            } finally {
                dbConnection?.endTransaction()
            }

            dbConnection?.execSQL("DETACH DATABASE target")

            val rawData = tempDbFile.readBytes()

            val base64String = Base64.encodeToString(rawData, Base64.NO_WRAP)
            val encryptedBase64Data = crypto.encryptData(base64String)

            storeEncryptedDatabase(encryptedBase64Data)
        } catch (e: Exception) {
            Log.e(TAG, "Error exporting and encrypting database", e)
            throw e
        } finally {
            if (tempDbFile.exists()) {
                tempDbFile.setWritable(true, true)
                tempDbFile.delete()
            }
        }
    }

    /**
     * Commit a SQL transaction and persist the encrypted vault.
     */
    fun commitTransaction() {
        dbConnection?.setTransactionSuccessful()
        dbConnection?.endTransaction()
        persistDatabaseToEncryptedStorage()
    }

    /**
     * Rollback a SQL transaction on the vault.
     */
    fun rollbackTransaction() {
        dbConnection?.endTransaction()
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
