package net.aliasvault.app.vaultstore

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import com.lambdapioneer.argon2kt.Argon2Kt
import com.lambdapioneer.argon2kt.Argon2Mode
import com.lambdapioneer.argon2kt.Argon2Version
import net.aliasvault.app.vaultstore.interfaces.CredentialOperationCallback
import net.aliasvault.app.vaultstore.interfaces.CryptoOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreProvider
import net.aliasvault.app.vaultstore.models.Alias
import net.aliasvault.app.vaultstore.models.Credential
import net.aliasvault.app.vaultstore.models.Password
import net.aliasvault.app.vaultstore.models.Service
import net.aliasvault.app.vaultstore.models.VaultMetadata
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.*
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The vault store that manages the encrypted vault and all input/output operations on it.
 * This class is used both by React Native and by the native Android autofill service.
 *
 * @param storageProvider The storage provider
 * @param keystoreProvider The keystore provider
 */
class VaultStore(
    private val storageProvider: StorageProvider,
    private val keystoreProvider: KeystoreProvider,
) {
    companion object {
        /**
         * The tag for logging.
         */
        private const val TAG = "VaultStore"

        /**
         * The biometrics auth method.
         */
        private const val BIOMETRICS_AUTH_METHOD = "faceid"

        /**
         * Minimum date definition.
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
         * The instance of the vault store.
         */
        @Volatile
        private var instance: VaultStore? = null

        /**
         * Get the instance of the vault store.
         * @param keystoreProvider The keystore provider
         * @param storageProvider The storage provider
         * @return The instance of the vault store
         */
        @JvmStatic
        fun getInstance(
            keystoreProvider: KeystoreProvider,
            storageProvider: StorageProvider,
        ): VaultStore {
            return instance ?: synchronized(this) {
                instance ?: VaultStore(storageProvider, keystoreProvider).also { instance = it }
            }
        }

        /**
         * Get the existing instance of the vault store.
         * @return The existing instance of the vault store
         */
        @JvmStatic
        fun getExistingInstance(): VaultStore? {
            return instance
        }
    }

    /**
     * The encryption key.
     */
    private var encryptionKey: ByteArray? = null

    /**
     * The database connection.
     */
    private var dbConnection: SQLiteDatabase? = null

    /**
     * The auto-lock handler.
     */
    private var autoLockHandler: Handler? = null

    /**
     * The auto-lock runnable.
     */
    private var autoLockRunnable: Runnable? = null

    /**
     * The last unlock time.
     */
    private var lastUnlockTime: Long = 0

    init {
        // Initialize the auto-lock handler on the main thread
        autoLockHandler = Handler(Looper.getMainLooper())
    }

    /**
     * Called when the app enters the background.
     */
    fun onAppBackgrounded() {
        Log.d(TAG, "App entered background, starting auto-lock timer with ${getAutoLockTimeout()}s")
        if (getAutoLockTimeout() > 0) {
            // Cancel any existing auto-lock timer
            autoLockRunnable?.let { autoLockHandler?.removeCallbacks(it) }

            // Create and schedule new auto-lock timer
            autoLockRunnable = Runnable {
                Log.d(TAG, "Auto-lock timer fired, clearing cache")
                clearCache()
            }
            autoLockHandler?.postDelayed(autoLockRunnable!!, getAutoLockTimeout().toLong() * 1000)
        }
    }

    /**
     * Called when the app enters the foreground.
     */
    fun onAppForegrounded() {
        Log.d(TAG, "App entered foreground, canceling auto-lock timer")
        // Cancel the auto-lock timer
        autoLockRunnable?.let { autoLockHandler?.removeCallbacks(it) }
        autoLockRunnable = null
    }

    /**
     * Store the encryption key.
     * @param base64EncryptionKey The encryption key as a base64 encoded string
     */
    fun storeEncryptionKey(base64EncryptionKey: String) {
        this.encryptionKey = Base64.decode(base64EncryptionKey, Base64.NO_WRAP)

        // Check if biometric auth is enabled in auth methods
        val authMethods = getAuthMethods()
        if (authMethods.contains(BIOMETRICS_AUTH_METHOD) && keystoreProvider.isBiometricAvailable()) {
            val latch = java.util.concurrent.CountDownLatch(1)
            var error: Exception? = null

            keystoreProvider.storeKey(
                key = base64EncryptionKey,
                object : KeystoreOperationCallback {
                    override fun onSuccess(result: String) {
                        Log.d(TAG, "Encryption key stored successfully with biometric protection")
                        latch.countDown()
                    }

                    override fun onError(e: Exception) {
                        Log.e(TAG, "Error storing encryption key with biometric protection", e)
                        error = e
                        latch.countDown()
                    }
                },
            )

            latch.await()
            error?.let { throw it }
        }
    }

    /**
     * Get the encryption key.
     * @param callback The callback to call when the key is retrieved
     */
    fun getEncryptionKey(callback: CryptoOperationCallback) {
        // If key is already in memory, use it
        encryptionKey?.let {
            Log.d(TAG, "Using cached encryption key")
            callback.onSuccess(Base64.encodeToString(it, Base64.NO_WRAP))
            return
        }

        // Check if biometric auth is enabled in auth methods
        val authMethods = getAuthMethods()
        if (authMethods.contains(BIOMETRICS_AUTH_METHOD) && keystoreProvider.isBiometricAvailable()) {
            keystoreProvider.retrieveKey(
                object : KeystoreOperationCallback {
                    override fun onSuccess(result: String) {
                        try {
                            // Cache the key
                            encryptionKey = Base64.decode(result, Base64.NO_WRAP)
                            callback.onSuccess(result)
                        } catch (e: Exception) {
                            Log.e(TAG, "Error decoding retrieved key", e)
                            callback.onError(e)
                        }
                    }

                    override fun onError(e: Exception) {
                        Log.e(TAG, "Error retrieving key", e)
                        callback.onError(e)
                    }
                },
            )
        } else {
            callback.onError(Exception("No encryption key found"))
        }
    }

    /**
     * Store the encryption key derivation parameters.
     * @param keyDerivationParams The encryption key derivation parameters
     */
    fun storeEncryptionKeyDerivationParams(keyDerivationParams: String) {
        this.storageProvider.setKeyDerivationParams(keyDerivationParams)
    }

    /**
     * Get the encryption key derivation parameters.
     * @return The encryption key derivation parameters
     */
    fun getEncryptionKeyDerivationParams(): String {
        return this.storageProvider.getKeyDerivationParams()
    }

    /**
     * Derive a key from a password using Argon2Id.
     * @param password The password to derive from
     * @param salt The salt to use
     * @param encryptionType The type of encryption (should be "Argon2Id")
     * @param encryptionSettings JSON string with encryption parameters
     * @return The derived key as a ByteArray
     */
    fun deriveKeyFromPassword(password: String, salt: String, encryptionType: String, encryptionSettings: String): ByteArray {
        if (encryptionType != "Argon2Id") {
            throw IllegalArgumentException("Unsupported encryption type: $encryptionType")
        }

        // Parse encryption settings JSON
        val settings = JSONObject(encryptionSettings)
        val iterations = settings.getInt("Iterations")
        val memorySize = settings.getInt("MemorySize")
        val parallelism = settings.getInt("DegreeOfParallelism")

        // Create Argon2 instance
        val argon2 = Argon2Kt()

        // Hash the password using Argon2Id
        val hashResult = argon2.hash(
            mode = Argon2Mode.ARGON2_ID,
            password = password.toByteArray(Charsets.UTF_8),
            salt = salt.toByteArray(Charsets.UTF_8),
            tCostInIterations = iterations,
            mCostInKibibyte = memorySize,
            parallelism = parallelism,
            hashLengthInBytes = 32,
            version = Argon2Version.V13,
        )

        return hashResult.rawHashAsByteArray()
    }

    /**
     * Store the encrypted database in the storage provider.
     * @param encryptedData The encrypted database as a base64 encoded string
     */
    fun storeEncryptedDatabase(encryptedData: String) {
        // Write the encrypted blob to the filesystem via the supplied file provider
        // which can either be the real Android file system or a mock file system for testing
        storageProvider.setEncryptedDatabaseFile(encryptedData)
    }

    /**
     * Get the encrypted database from the storage provider.
     * @return The encrypted database as a base64 encoded string
     */
    fun getEncryptedDatabase(): String {
        val encryptedDbBase64 = storageProvider.getEncryptedDatabaseFile().readText()
        return encryptedDbBase64
    }

    /**
     * Check if the encrypted database exists in the storage provider.
     * @return True if the encrypted database exists, false otherwise
     */
    fun hasEncryptedDatabase(): Boolean {
        return storageProvider.getEncryptedDatabaseFile().exists()
    }

    /**
     * Store the metadata in the storage provider.
     * @param metadata The metadata to store
     */
    fun storeMetadata(metadata: String) {
        storageProvider.setMetadata(metadata)
    }

    /**
     * Get the metadata from the storage provider.
     * @return The metadata as a string
     */
    fun getMetadata(): String {
        return storageProvider.getMetadata()
    }

    /**
     * Unlock the vault. This can trigger biometric authentication.
     */
    fun unlockVault() {
        val encryptedDbBase64 = getEncryptedDatabase()
        val decryptedDbBase64 = decryptData(encryptedDbBase64)

        try {
            setupDatabaseWithDecryptedData(decryptedDbBase64)
        } catch (e: Exception) {
            Log.e(TAG, "Error unlocking vault", e)
            throw e
        }
    }

    /**
     * Execute a read-only SQL query (SELECT) on the vault.
     * @param query The SQL query
     * @param params The parameters to the query
     * @return The results of the query
     */
    @Suppress("NestedBlockDepth")
    fun executeQuery(query: String, params: Array<Any?>): List<Map<String, Any?>> {
        val results = mutableListOf<Map<String, Any?>>()

        dbConnection?.let { db ->
            // Convert any base64 strings with the special flag to blobs
            val convertedParams = params.map { param ->
                if (param is String && param.startsWith("av-base64-to-blob:")) {
                    val base64 = param.substring("av-base64-to-blob:".length)
                    Base64.decode(base64, Base64.NO_WRAP)
                } else {
                    param
                }
            }.toTypedArray()

            val cursor = db.rawQuery(query, convertedParams.map { it?.toString() }.toTypedArray())

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
     * @param query The SQL query
     * @param params The parameters to the query
     * @return The number of affected rows
     */
    fun executeUpdate(query: String, params: Array<Any?>): Int {
        dbConnection?.let { db ->
            // Convert any base64 strings with the special flag to blobs
            val convertedParams = params.map { param ->
                if (param is String && param.startsWith("av-base64-to-blob:")) {
                    val base64 = param.substring("av-base64-to-blob:".length)
                    Base64.decode(base64, Base64.NO_WRAP)
                } else {
                    param
                }
            }.toTypedArray()

            db.execSQL(query, convertedParams)
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
     * Execute a raw SQL command on the vault without parameters (for DDL operations like CREATE TABLE).
     * @param query The SQL query
     */
    fun executeRaw(query: String) {
        dbConnection?.let { db ->
            // Split the query by semicolons to handle multiple statements
            val statements = query.split(";")

            for (statement in statements) {
                // Remove problematic invisible characters from string
                val trimmedStatement = statement.smartTrim()

                // Skip empty statements and transaction control statements (handled externally)
                if (trimmedStatement.isEmpty() ||
                    trimmedStatement.uppercase().startsWith("BEGIN") ||
                    trimmedStatement.uppercase().startsWith("COMMIT") ||
                    trimmedStatement.uppercase().startsWith("ROLLBACK")
                ) {
                    continue
                }

                db.execSQL(trimmedStatement)
            }
        }
    }

    /**
     * Begin a SQL transaction on the vault.
     */
    fun beginTransaction() {
        dbConnection?.beginTransaction()
    }

    /**
     * Commit a SQL transaction on the vault. This also persists the new version of the encrypted vault from memory to the filesystem.
     */
    fun commitTransaction() {
        dbConnection?.setTransactionSuccessful()
        dbConnection?.endTransaction()

        // Create a temporary file in app-specific storage
        val tempDbFile = File.createTempFile("temp_db", ".sqlite")
        tempDbFile.deleteOnExit() // Ensure cleanup on JVM exit

        try {
            // Attach the temporary file as target database
            dbConnection?.execSQL("ATTACH DATABASE '${tempDbFile.path}' AS target")

            // Begin transaction for copying data
            dbConnection?.beginTransaction()

            try {
                // Get all table names from the main database
                val cursor = dbConnection?.rawQuery(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%'",
                    null,
                )

                cursor?.use {
                    while (it.moveToNext()) {
                        val tableName = it.getString(0)
                        // Create table and copy data
                        dbConnection?.execSQL(
                            "CREATE TABLE target.$tableName AS SELECT * FROM main.$tableName",
                        )
                    }
                }

                // Commit the copy transaction
                dbConnection?.setTransactionSuccessful()
            } finally {
                dbConnection?.endTransaction()
            }

            // Detach the target database
            dbConnection?.execSQL("DETACH DATABASE target")

            // Read the temporary database file
            val rawData = tempDbFile.readBytes()

            // Convert to base64 and encrypt
            val base64String = Base64.encodeToString(rawData, Base64.NO_WRAP)
            val encryptedBase64Data = encryptData(base64String)

            // Store the encrypted database
            storeEncryptedDatabase(encryptedBase64Data)
        } catch (e: Exception) {
            Log.e(TAG, "Error exporting and encrypting database", e)
            throw e
        } finally {
            // Securely delete the temporary file
            if (tempDbFile.exists()) {
                tempDbFile.setWritable(true, true) // Temporarily enable write for deletion
                tempDbFile.delete()
            }
        }
    }

    /**
     * Rollback a SQL transaction on the vault.
     */
    fun rollbackTransaction() {
        dbConnection?.endTransaction()
    }

    /**
     * Check if the vault is unlocked.
     * @return True if the vault is unlocked, false otherwise
     */
    fun isVaultUnlocked(): Boolean {
        if (encryptionKey == null) {
            return false
        }

        return true
    }

    /**
     * Set the auto-lock timeout.
     * @param timeout The timeout in seconds
     */
    fun setAutoLockTimeout(timeout: Int) {
        storageProvider.setAutoLockTimeout(timeout)
    }

    /**
     * Get the auto-lock timeout.
     * @return The timeout in seconds
     */
    fun getAutoLockTimeout(): Int {
        return storageProvider.getAutoLockTimeout()
    }

    /**
     * Set the auth methods.
     * @param authMethods The auth methods
     */
    fun setAuthMethods(authMethods: String) {
        storageProvider.setAuthMethods(authMethods)

        // If the new auth methods no longer include biometrics, clear the biometric key.
        if (!authMethods.contains(BIOMETRICS_AUTH_METHOD)) {
            keystoreProvider.clearKeys()
        }
    }

    /**
     * Get the auth methods.
     * @return The auth methods
     */
    fun getAuthMethods(): String {
        return storageProvider.getAuthMethods()
    }

    /**
     * Set the vault revision number.
     * @param revisionNumber The revision number
     */
    fun setVaultRevisionNumber(revisionNumber: Int) {
        val metadata = getVaultMetadataObject() ?: VaultMetadata()
        val updatedMetadata = metadata.copy(vaultRevisionNumber = revisionNumber)
        storeMetadata(
            JSONObject().apply {
                put("publicEmailDomains", JSONArray(updatedMetadata.publicEmailDomains))
                put("privateEmailDomains", JSONArray(updatedMetadata.privateEmailDomains))
                put("vaultRevisionNumber", updatedMetadata.vaultRevisionNumber)
            }.toString(),
        )
    }

    /**
     * Get the vault revision number.
     * @return The revision number
     */
    fun getVaultRevisionNumber(): Int {
        return getVaultMetadataObject()?.vaultRevisionNumber ?: 0
    }

    /**
     * Get the vault metadata object.
     * @return The vault metadata object
     */
    private fun getVaultMetadataObject(): VaultMetadata? {
        val metadataJson = getMetadata()
        if (metadataJson.isBlank()) {
            return null
        }
        return try {
            val json = JSONObject(metadataJson)
            VaultMetadata(
                publicEmailDomains = json.optJSONArray("publicEmailDomains")?.let { array ->
                    List(array.length()) { i -> array.getString(i) }
                } ?: emptyList(),
                privateEmailDomains = json.optJSONArray("privateEmailDomains")?.let { array ->
                    List(array.length()) { i -> array.getString(i) }
                } ?: emptyList(),
                vaultRevisionNumber = json.optInt("vaultRevisionNumber", 0),
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing vault metadata", e)
            null
        }
    }

    /**
     * Clear the memory, removing the encryption key and decrypted database from memory.
     */
    fun clearCache() {
        Log.d(TAG, "Clearing cache - removing encryption key and decrypted database from memory")
        dbConnection?.close()
        encryptionKey = null
        dbConnection = null
    }

    /**
     * Clear all vault data including from persisted storage. This removes all data from the local device.
     */
    fun clearVault() {
        // Remove cached data from memory
        clearCache()

        // Remove the encryption key stored in the keystore
        keystoreProvider.clearKeys()

        // Remove all data from the storage provider
        storageProvider.clearStorage()
    }

    /**
     * Attempts to get all credentials using only the cached encryption key.
     * Returns false if the key isn't in memory, which signals the caller to authenticate.
     */
    fun tryGetAllCredentials(callback: CredentialOperationCallback): Boolean {
        // Check if the encryption key is already in memory
        if (encryptionKey == null) {
            Log.d(TAG, "Encryption key not in memory, authentication required")
            return false
        }

        try {
            Log.d(TAG, "Unlocking vault and retrieving all credentials")

            // Unlock vault if it's locked
            if (!isVaultUnlocked()) {
                unlockVault()
            }

            // Return all credentials
            callback.onSuccess(getAllCredentials())
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error retrieving credentials", e)
            callback.onError(e)
            return false
        }
    }

    /**
     * Decrypt data.
     * @param encryptedData The encrypted data
     * @return The decrypted data
     */
    private fun decryptData(encryptedData: String): String {
        var decryptedResult: String? = null
        var error: Exception? = null

        // Create a latch to wait for the callback
        val latch = java.util.concurrent.CountDownLatch(1)

        getEncryptionKey(object : CryptoOperationCallback {
            override fun onSuccess(result: String) {
                try {
                    val decoded = Base64.decode(encryptedData, Base64.NO_WRAP)

                    // Extract IV from the first 12 bytes
                    val iv = decoded.copyOfRange(0, 12)
                    val encryptedContent = decoded.copyOfRange(12, decoded.size)

                    // Create cipher
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    val keySpec = SecretKeySpec(encryptionKey!!, "AES")
                    val gcmSpec = GCMParameterSpec(128, iv)

                    // Initialize cipher for decryption
                    cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec)

                    // Decrypt
                    val decrypted = cipher.doFinal(encryptedContent)
                    decryptedResult = String(decrypted, Charsets.UTF_8)
                } catch (e: Exception) {
                    error = e
                    Log.e(TAG, "Error decrypting data", e)
                } finally {
                    latch.countDown()
                }
            }

            override fun onError(e: Exception) {
                error = e
                Log.e(TAG, "Error getting encryption key", e)
                latch.countDown()
            }
        })

        // Wait for the callback to complete
        latch.await()

        // Throw any error that occurred or return the result
        error?.let { throw it }
        return decryptedResult ?: error("Decryption failed")
    }

    /**
     * Get all credentials from the vault.
     * @return The list of credentials
     */
    fun getAllCredentials(): List<Credential> {
        if (dbConnection == null) {
            error("Database not initialized")
        }

        Log.d(TAG, "Executing get all credentials query..")

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
        val cursor = dbConnection?.rawQuery(query, null)

        cursor?.use {
            while (it.moveToNext()) {
                try {
                    val id = UUID.fromString(it.getString(0))
                    val isDeleted = it.getInt(6) == 1

                    // Service
                    val serviceId = UUID.fromString(it.getString(7))
                    val service = Service(
                        id = serviceId,
                        name = it.getString(8),
                        url = it.getString(9),
                        logo = it.getBlob(10),
                        createdAt = parseDateString(it.getString(11)) ?: MIN_DATE,
                        updatedAt = parseDateString(it.getString(12)) ?: MIN_DATE,
                        isDeleted = it.getInt(13) == 1,
                    )

                    // Password
                    var password: Password? = null
                    if (!it.isNull(14)) {
                        password = Password(
                            id = UUID.fromString(it.getString(14)),
                            credentialId = id,
                            value = it.getString(15),
                            createdAt = parseDateString(it.getString(16)) ?: MIN_DATE,
                            updatedAt = parseDateString(it.getString(17)) ?: MIN_DATE,
                            isDeleted = it.getInt(18) == 1,
                        )
                    }

                    // Alias
                    var alias: Alias? = null
                    if (!it.isNull(19)) {
                        alias = Alias(
                            id = UUID.fromString(it.getString(19)),
                            gender = it.getString(20),
                            firstName = it.getString(21),
                            lastName = it.getString(22),
                            nickName = it.getString(23),
                            birthDate = parseDateString(it.getString(24)) ?: MIN_DATE,
                            email = it.getString(25),
                            createdAt = parseDateString(it.getString(26)) ?: MIN_DATE,
                            updatedAt = parseDateString(it.getString(27)) ?: MIN_DATE,
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
                        createdAt = parseDateString(it.getString(4)) ?: MIN_DATE,
                        updatedAt = parseDateString(it.getString(5)) ?: MIN_DATE,
                        isDeleted = isDeleted,
                    )
                    result.add(credential)
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing credential row", e)
                }
            }
        }

        Log.d(TAG, "Found ${result.size} credentials")
        return result
    }

    /**
     * Encrypt data.
     * @param data The data to encrypt
     * @return The encrypted data
     */
    private fun encryptData(data: String): String {
        try {
            // Generate random IV
            val iv = ByteArray(12)
            SecureRandom().nextBytes(iv)

            // Create cipher
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val keySpec = SecretKeySpec(encryptionKey!!, "AES")
            val gcmSpec = GCMParameterSpec(128, iv)

            // Initialize cipher for encryption
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec)

            // Encrypt
            val encrypted = cipher.doFinal(data.toByteArray(Charsets.UTF_8))

            // Combine IV and encrypted content
            val result = ByteArray(iv.size + encrypted.size)
            System.arraycopy(iv, 0, result, 0, iv.size)
            System.arraycopy(encrypted, 0, result, iv.size, encrypted.size)

            return Base64.encodeToString(result, Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.e(TAG, "Error encrypting data", e)
            throw e
        }
    }

    /**
     * Setup the database with decrypted data. This initializes the decrypted database in memory.
     * @param decryptedDbBase64 The decrypted database as a base64 encoded string
     */
    private fun setupDatabaseWithDecryptedData(decryptedDbBase64: String) {
        var tempDbFile: File? = null
        try {
            // Decode the base64 data
            val decryptedDbData = Base64.decode(decryptedDbBase64, Base64.NO_WRAP)

            // Create a temporary file in app-specific storage
            tempDbFile = File.createTempFile("temp_db", ".sqlite")
            tempDbFile.deleteOnExit() // Ensure cleanup on JVM exit
            tempDbFile.writeBytes(decryptedDbData)

            // Close any existing connection if it exists
            dbConnection?.close()

            // Create an in-memory database
            dbConnection = SQLiteDatabase.create(null)

            // Begin transaction
            dbConnection?.beginTransaction()

            try {
                // Attach the temporary database
                val attachQuery = "ATTACH DATABASE '${tempDbFile.path}' AS source"
                dbConnection?.execSQL(attachQuery)

                // Verify the attachment worked by checking if we can access the source database
                val verifyCursor = dbConnection?.rawQuery(
                    "SELECT name FROM source.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
                    null,
                )

                if (verifyCursor == null) {
                    throw SQLiteException("Failed to attach source database")
                }

                verifyCursor.use {
                    if (!it.moveToFirst()) {
                        throw SQLiteException("No tables found in source database")
                    }

                    do {
                        val tableName = it.getString(0)
                        // Create table and copy data using rawQuery
                        dbConnection?.execSQL(
                            "CREATE TABLE $tableName AS SELECT * FROM source.$tableName",
                        )
                    } while (it.moveToNext())
                }

                // Commit transaction
                dbConnection?.setTransactionSuccessful()
            } finally {
                dbConnection?.endTransaction()
            }

            // Detach the source database
            dbConnection?.rawQuery("DETACH DATABASE source", null)

            // Set database pragmas using rawQuery
            dbConnection?.rawQuery("PRAGMA journal_mode = WAL", null)
            dbConnection?.rawQuery("PRAGMA synchronous = NORMAL", null)
            dbConnection?.rawQuery("PRAGMA foreign_keys = ON", null)

            lastUnlockTime = System.currentTimeMillis()
        } catch (e: Exception) {
            Log.e(TAG, "Error setting up database with decrypted data", e)
            throw e
        } finally {
            // Securely delete the temporary file
            tempDbFile?.let {
                if (it.exists()) {
                    it.setWritable(true, true) // Temporarily enable write for deletion
                    it.delete()
                }
            }
        }
    }

    /**
     * Parse a date string from the database into a Date object.
     *
     * @param dateString The date string to parse
     * @return The parsed Date object or null if the date string is null or cannot be parsed
     */
    private fun parseDateString(dateString: String?): Date? {
        if (dateString == null) {
            return null
        }

        val formats = listOf(
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            },
            SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            },
        )

        for (format in formats) {
            try {
                return format.parse(dateString)
            } catch (e: Exception) {
                // Log the parsing error for this format
                Log.d(TAG, "Failed to parse date '$dateString' with format '${format.toPattern()}': ${e.message}")
                continue
            }
        }

        Log.e(TAG, "Error parsing date: $dateString")
        return null
    }

    /**
     * Remove problematic invisible characters from string.
     * @return The trimmed string
     */
    private fun String.smartTrim(): String {
        val invisible = "[\\uFEFF\\u200B\\u00A0\\u202A-\\u202E\\u2060\\u180E]"
        return this.replace(Regex("^($invisible)+|($invisible)+$"), "").trim()
    }

    // MARK: - Username Management

    /**
     * Set the username.
     * @param username The username to store
     */
    fun setUsername(username: String) {
        storageProvider.setUsername(username)
    }

    /**
     * Get the username.
     * @return The username or null if not set
     */
    fun getUsername(): String? {
        return storageProvider.getUsername()
    }

    /**
     * Clear the username.
     */
    fun clearUsername() {
        storageProvider.clearUsername()
    }

    // MARK: - Offline Mode Management

    /**
     * Set offline mode flag.
     * @param isOffline Whether the app is in offline mode
     */
    fun setOfflineMode(isOffline: Boolean) {
        storageProvider.setOfflineMode(isOffline)
    }

    /**
     * Get offline mode flag.
     * @return True if app is in offline mode, false otherwise
     */
    fun getOfflineMode(): Boolean {
        return storageProvider.getOfflineMode()
    }

    // MARK: - Vault Sync Methods

    /**
     * Check if a new vault version is available on the server.
     * Returns a map with isNewVersionAvailable and newRevision keys.
     *
     * @param webApiService The WebApiService to use for the request
     * @return Map with "isNewVersionAvailable" (Boolean) and "newRevision" (Int?) keys
     */
    suspend fun isNewVaultVersionAvailable(webApiService: net.aliasvault.app.webapi.WebApiService): Map<String, Any?> {
        val status = fetchAndValidateStatus(webApiService)
        setOfflineMode(false)

        val currentRevision = getVaultRevisionNumber()
        return if (status.vaultRevision > currentRevision) {
            mapOf(
                "isNewVersionAvailable" to true,
                "newRevision" to status.vaultRevision,
            )
        } else {
            mapOf(
                "isNewVersionAvailable" to false,
                "newRevision" to null,
            )
        }
    }

    /**
     * Download and store the vault from the server.
     * This method assumes a version check has already been performed.
     *
     * @param webApiService The WebApiService to use for the request
     * @param newRevision The new revision number to download
     * @return True if successful
     */
    suspend fun downloadVault(webApiService: net.aliasvault.app.webapi.WebApiService, newRevision: Int): Boolean {
        try {
            downloadAndStoreVault(webApiService, newRevision)
            setOfflineMode(false)
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error downloading vault", e)
            throw e
        }
    }

    /**
     * Fetch and validate server status.
     */
    private suspend fun fetchAndValidateStatus(webApiService: net.aliasvault.app.webapi.WebApiService): StatusResponse {
        val statusResponse = try {
            webApiService.executeRequest(
                method = "GET",
                endpoint = "Auth/status",
                body = null,
                headers = emptyMap(),
                requiresAuth = true,
            )
        } catch (e: Exception) {
            throw Exception("Network error: ${e.message}", e)
        }

        // Check response status
        if (statusResponse.statusCode != 200) {
            if (statusResponse.statusCode == 401) {
                throw Exception("Session expired")
            }
            setOfflineMode(true)
            throw Exception("Server unavailable: ${statusResponse.statusCode}")
        }

        val status = try {
            val json = org.json.JSONObject(statusResponse.body)
            StatusResponse(
                clientVersionSupported = json.getBoolean("clientVersionSupported"),
                serverVersion = json.getString("serverVersion"),
                vaultRevision = json.getInt("vaultRevision"),
                srpSalt = json.getString("srpSalt"),
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode status response", e)
            throw Exception("Failed to decode status response: ${e.message}")
        }

        if (!status.clientVersionSupported) {
            throw Exception("Client version not supported")
        }

        validateSrpSalt(status.srpSalt)
        return status
    }

    /**
     * Validate SRP salt hasn't changed (password change detection).
     */
    private fun validateSrpSalt(srpSalt: String) {
        val keyDerivationParams = storageProvider.getKeyDerivationParams()
        if (keyDerivationParams.isEmpty()) {
            return
        }

        try {
            val json = org.json.JSONObject(keyDerivationParams)
            val salt = json.optString("salt", "")
            if (srpSalt.isNotEmpty() && srpSalt != salt) {
                throw Exception("Password changed")
            }
        } catch (e: Exception) {
            if (e.message == "Password changed") throw e
            // Ignore parsing errors
        }
    }

    /**
     * Download vault from server and store it locally.
     */
    private suspend fun downloadAndStoreVault(webApiService: net.aliasvault.app.webapi.WebApiService, newRevision: Int) {
        val vaultResponse = try {
            webApiService.executeRequest(
                method = "GET",
                endpoint = "Vault",
                body = null,
                headers = emptyMap(),
                requiresAuth = true,
            )
        } catch (e: Exception) {
            throw Exception("Network error: ${e.message}", e)
        }

        if (vaultResponse.statusCode != 200) {
            if (vaultResponse.statusCode == 401) {
                throw Exception("Session expired")
            }
            throw Exception("Server unavailable: ${vaultResponse.statusCode}")
        }

        val vault = parseVaultResponse(vaultResponse.body)
        validateVaultStatus(vault.status)
        storeEncryptedDatabase(vault.vault.blob)
        setVaultRevisionNumber(newRevision)

        if (isVaultUnlocked()) {
            unlockVault()
        }
    }

    /**
     * Parse vault response from JSON.
     */
    private fun parseVaultResponse(body: String): VaultResponse {
        return try {
            val json = org.json.JSONObject(body)
            val vaultJson = json.getJSONObject("vault")

            val emailList = mutableListOf<String>()
            val emailArray = vaultJson.getJSONArray("emailAddressList")
            for (i in 0 until emailArray.length()) {
                emailList.add(emailArray.getString(i))
            }

            val privateList = mutableListOf<String>()
            val privateArray = vaultJson.getJSONArray("privateEmailDomainList")
            for (i in 0 until privateArray.length()) {
                privateList.add(privateArray.getString(i))
            }

            val publicList = mutableListOf<String>()
            val publicArray = vaultJson.getJSONArray("publicEmailDomainList")
            for (i in 0 until publicArray.length()) {
                publicList.add(publicArray.getString(i))
            }

            VaultResponse(
                status = json.getInt("status"),
                vault = VaultData(
                    username = vaultJson.getString("username"),
                    blob = vaultJson.getString("blob"),
                    version = vaultJson.getString("version"),
                    currentRevisionNumber = vaultJson.getInt("currentRevisionNumber"),
                    encryptionPublicKey = vaultJson.getString("encryptionPublicKey"),
                    credentialsCount = vaultJson.getInt("credentialsCount"),
                    emailAddressList = emailList,
                    privateEmailDomainList = privateList,
                    publicEmailDomainList = publicList,
                    createdAt = vaultJson.getString("createdAt"),
                    updatedAt = vaultJson.getString("updatedAt"),
                ),
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode vault response", e)
            throw Exception("Failed to decode vault response: ${e.message}")
        }
    }

    /**
     * Validate vault response status.
     */
    private fun validateVaultStatus(status: Int) {
        when (status) {
            0 -> return
            1 -> throw Exception("Vault merge required")
            2 -> throw Exception("Vault outdated")
            else -> throw Exception("Unknown vault status: $status")
        }
    }

    // MARK: - Vault Mutate Methods

    /**
     * Prepare the vault for upload by assembling all metadata.
     * Returns a VaultUpload object ready to be sent to the server.
     */
    private fun prepareVault(): VaultUpload {
        val currentRevision = getVaultRevisionNumber()

        val encryptedDb = getEncryptedDatabase()

        val username = getUsername()
            ?: throw Exception("Username not found")

        if (!isVaultUnlocked()) {
            throw Exception("Vault must be unlocked to prepare for upload")
        }

        // Get all credentials
        val credentials = getAllCredentials()

        // Get private email domains from metadata
        val metadata = getVaultMetadataObject()
        val privateEmailDomains = metadata?.privateEmailDomains ?: emptyList()

        // Extract private email addresses from credentials
        val privateEmailAddresses = credentials
            .mapNotNull { it.alias?.email }
            .filter { email ->
                privateEmailDomains.any { domain ->
                    email.lowercase().endsWith("@${domain.lowercase()}")
                }
            }
            .distinct()

        // Get database version
        val dbVersion = getDatabaseVersion()

        // Get app version
        val version = try {
            val context = storageProvider as? net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider
            val pm = context?.javaClass?.getDeclaredField("context")?.get(context) as? android.content.Context
            pm?.packageManager?.getPackageInfo(pm.packageName, 0)?.versionName ?: "0.0.0"
        } catch (e: Exception) {
            "0.0.0"
        }
        val baseVersion = version.split("-").firstOrNull() ?: "0.0.0"
        val client = "android-$baseVersion"

        // Format dates in ISO 8601 format
        val dateFormat = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
        dateFormat.timeZone = java.util.TimeZone.getTimeZone("UTC")
        val now = dateFormat.format(java.util.Date())

        return VaultUpload(
            blob = encryptedDb,
            createdAt = now,
            credentialsCount = credentials.size,
            currentRevisionNumber = currentRevision,
            emailAddressList = privateEmailAddresses,
            privateEmailDomainList = emptyList(), // Empty on purpose
            publicEmailDomainList = emptyList(), // Empty on purpose
            encryptionPublicKey = "", // Empty on purpose
            updatedAt = now,
            username = username,
            version = dbVersion,
            client = client,
        )
    }

    /**
     * Execute a vault mutation operation.
     * This method uploads the vault to the server and updates the local revision number.
     *
     * @param webApiService The WebApiService to use for the request
     * @return True if successful
     */
    suspend fun mutateVault(webApiService: net.aliasvault.app.webapi.WebApiService): Boolean {
        try {
            // Prepare vault for upload
            val vault = prepareVault()

            // Convert to JSON
            val json = org.json.JSONObject()
            json.put("blob", vault.blob)
            json.put("createdAt", vault.createdAt)
            json.put("credentialsCount", vault.credentialsCount)
            json.put("currentRevisionNumber", vault.currentRevisionNumber)
            json.put("emailAddressList", org.json.JSONArray(vault.emailAddressList))
            json.put("privateEmailDomainList", org.json.JSONArray(vault.privateEmailDomainList))
            json.put("publicEmailDomainList", org.json.JSONArray(vault.publicEmailDomainList))
            json.put("encryptionPublicKey", vault.encryptionPublicKey)
            json.put("updatedAt", vault.updatedAt)
            json.put("username", vault.username)
            json.put("version", vault.version)
            json.put("client", vault.client)

            // Upload to server
            val response = webApiService.executeRequest(
                method = "POST",
                endpoint = "Vault",
                body = json.toString(),
                headers = mapOf("Content-Type" to "application/json"),
                requiresAuth = true,
            )

            if (response.statusCode != 200) {
                Log.e(TAG, "Server rejected vault upload with status ${response.statusCode}")
                throw Exception("Server returned error: ${response.statusCode}")
            }

            // Parse response
            val vaultResponse = try {
                val responseJson = org.json.JSONObject(response.body)
                VaultPostResponse(
                    status = responseJson.getInt("status"),
                    newRevisionNumber = responseJson.getInt("newRevisionNumber"),
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse vault upload response", e)
                throw Exception("Failed to parse vault upload response: ${e.message}")
            }

            // Check vault response status
            when (vaultResponse.status) {
                0 -> {
                    // Success - update local revision number
                    setVaultRevisionNumber(vaultResponse.newRevisionNumber)
                    setOfflineMode(false)
                    return true
                }
                1 -> throw Exception("Vault merge required")
                2 -> throw Exception("Vault is outdated, please sync first")
                else -> throw Exception("Failed to upload vault")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error mutating vault", e)
            throw e
        }
    }

    /**
     * Get the database version from the __EFMigrationsHistory table.
     */
    private fun getDatabaseVersion(): String {
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

        // Extract version using regex - matches patterns like "_1.4.1-"
        val versionRegex = Regex("_(\\d+\\.\\d+\\.\\d+)-")
        val match = versionRegex.find(migrationId)

        return if (match != null && match.groupValues.size > 1) {
            match.groupValues[1]
        } else {
            Log.d(TAG, "Could not extract version from migration ID '$migrationId', returning default")
            "0.0.0"
        }
    }

    // MARK: - Data Models for Sync/Mutate

    /**
     * Status response from Auth/status endpoint.
     */
    private data class StatusResponse(
        val clientVersionSupported: Boolean,
        val serverVersion: String,
        val vaultRevision: Int,
        val srpSalt: String,
    )

    /**
     * Vault data from API.
     */
    private data class VaultData(
        val username: String,
        val blob: String,
        val version: String,
        val currentRevisionNumber: Int,
        val encryptionPublicKey: String,
        val credentialsCount: Int,
        val emailAddressList: List<String>,
        val privateEmailDomainList: List<String>,
        val publicEmailDomainList: List<String>,
        val createdAt: String,
        val updatedAt: String,
    )

    /**
     * Vault response from Vault GET endpoint.
     */
    private data class VaultResponse(
        val status: Int,
        val vault: VaultData,
    )

    /**
     * Vault upload model that matches the API contract.
     */
    private data class VaultUpload(
        val blob: String,
        val createdAt: String,
        val credentialsCount: Int,
        val currentRevisionNumber: Int,
        val emailAddressList: List<String>,
        val privateEmailDomainList: List<String>,
        val publicEmailDomainList: List<String>,
        val encryptionPublicKey: String,
        val updatedAt: String,
        val username: String,
        val version: String,
        val client: String,
    )

    /**
     * Vault POST response from API.
     */
    private data class VaultPostResponse(
        val status: Int,
        val newRevisionNumber: Int,
    )
}
