package net.aliasvault.app

import android.database.sqlite.SQLiteDatabase
import android.util.Base64
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.aliasvault.app.vaultstore.models.VaultSql
import net.aliasvault.app.vaultstore.models.VaultVersions
import org.json.JSONArray
import org.json.JSONObject
import uniffi.aliasvault_core.argon2HashPassword
import uniffi.aliasvault_core.srpDerivePrivateKey
import uniffi.aliasvault_core.srpDeriveVerifier
import uniffi.aliasvault_core.srpGenerateSalt
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Test user credentials and token.
 */
data class TestUser(
    val username: String,
    val password: String,
    val token: String,
    val refreshToken: String,
)

/**
 * Token response from the API.
 */
data class TokenResponse(
    val token: String,
    val refreshToken: String,
)

/**
 * Test user registration helper using SRP protocol.
 * Uses the Rust core library for SRP operations via UniFFI bindings.
 */
object TestUserRegistration {
    private const val TAG = "TestUserRegistration"

    /**
     * API URL for testing.
     */
    val apiUrl: String
        get() = TestConfiguration.apiUrl

    // region Username/Password Generation

    /**
     * Generate a random test username.
     */
    fun generateTestUsername(): String {
        val chars = "abcdefghijklmnopqrstuvwxyz0123456789"
        val randomPart = (1..10)
            .map { chars.random() }
            .joinToString("")
        return "test_$randomPart@example.tld"
    }

    /**
     * Generate a test password.
     * Uses a static password for easier debugging and test reproducibility.
     */
    fun generateTestPassword(): String = "password"

    /**
     * Normalize username by converting to lowercase and trimming whitespace.
     */
    fun normalizeUsername(username: String): String =
        username.lowercase().trim()

    // endregion

    // region Hex Conversion

    /**
     * Convert ByteArray to uppercase hex string.
     */
    fun bytesToHex(data: ByteArray): String =
        data.joinToString("") { "%02X".format(it) }

    /**
     * Convert hex string to ByteArray.
     */
    fun hexToBytes(hex: String): ByteArray {
        val cleanHex = hex.removePrefix("0x").removePrefix("0X").trim()
        require(cleanHex.length % 2 == 0) { "Invalid hex string length" }

        return ByteArray(cleanHex.length / 2) { i ->
            cleanHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
    }

    // endregion

    // region Registration

    /**
     * Register a new test user via the API using SRP protocol.
     * Uses Rust core for all SRP operations.
     */
    suspend fun registerTestUser(
        apiBaseUrl: String,
        username: String,
        password: String,
    ): TokenResponse = withContext(Dispatchers.IO) {
        val baseUrl = apiBaseUrl.trimEnd('/') + "/v1/"
        val normalizedUsername = normalizeUsername(username)

        // Generate salt using Rust core
        val salt = srpGenerateSalt()

        // Derive key from password using Rust core Argon2
        val passwordHashHex = argon2HashPassword(password, salt)

        // Derive SRP private key and verifier using Rust core
        val privateKey = srpDerivePrivateKey(salt, normalizedUsername, passwordHashHex)
        val verifier = srpDeriveVerifier(privateKey)

        // Build registration request
        val registerRequest = JSONObject().apply {
            put("username", normalizedUsername)
            put("salt", salt)
            put("verifier", verifier)
            put("encryptionType", TestConfiguration.EncryptionDefaults.TYPE)
            put("encryptionSettings", TestConfiguration.EncryptionDefaults.settingsJson)
        }

        // Send registration request
        val connection = URL("${baseUrl}Auth/register").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true

            connection.outputStream.bufferedWriter().use {
                it.write(registerRequest.toString())
            }

            if (connection.responseCode != 200) {
                val errorBody = try {
                    connection.errorStream?.bufferedReader()?.readText() ?: "Unknown error"
                } catch (e: Exception) {
                    "HTTP ${connection.responseCode}"
                }
                throw Exception("Registration failed: $errorBody")
            }

            val responseBody = connection.inputStream.bufferedReader().readText()
            val json = JSONObject(responseBody)

            val tokenResponse = TokenResponse(
                token = json.getString("token"),
                refreshToken = json.getString("refreshToken"),
            )

            // Upload initial empty vault
            val encryptionKey = hexToBytes(passwordHashHex)
            uploadInitialVault(
                apiBaseUrl = apiBaseUrl,
                token = tokenResponse.token,
                username = normalizedUsername,
                encryptionKey = encryptionKey,
            )

            tokenResponse
        } finally {
            connection.disconnect()
        }
    }

    // endregion

    // region Vault Upload

    /**
     * Upload an initial empty vault to the server.
     */
    private suspend fun uploadInitialVault(
        apiBaseUrl: String,
        token: String,
        username: String,
        encryptionKey: ByteArray,
    ) = withContext(Dispatchers.IO) {
        val baseUrl = apiBaseUrl.trimEnd('/') + "/v1/"

        // Create empty vault database
        val vaultBase64 = createEmptyVaultDatabase()

        // Encrypt the vault using AES-GCM
        val encryptedVault = symmetricEncrypt(vaultBase64, encryptionKey)

        // Generate RSA key pair for the vault
        val rsaKeyPair = generateRsaKeyPair()

        // Get current timestamp in ISO8601 format
        val now = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(java.util.Date())

        // Build vault upload request
        val vaultRequest = JSONObject().apply {
            put("username", normalizeUsername(username))
            put("blob", encryptedVault)
            put("version", VaultVersions.latestVersion)
            put("currentRevisionNumber", VaultVersions.latestRevision)
            put("encryptionPublicKey", rsaKeyPair.first)
            put("credentialsCount", 0)
            put("emailAddressList", JSONArray())
            put("privateEmailDomainList", JSONArray())
            put("hiddenPrivateEmailDomainList", JSONArray())
            put("publicEmailDomainList", JSONArray())
            put("createdAt", now)
            put("updatedAt", now)
        }

        val connection = URL("${baseUrl}Vault").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.doOutput = true

            connection.outputStream.bufferedWriter().use {
                it.write(vaultRequest.toString())
            }

            if (connection.responseCode != 200) {
                val errorBody = try {
                    connection.errorStream?.bufferedReader()?.readText() ?: "Unknown error"
                } catch (e: Exception) {
                    "HTTP ${connection.responseCode}"
                }
                throw Exception("Failed to upload vault: $errorBody")
            }
        } finally {
            connection.disconnect()
        }
    }

    // endregion

    // region Encryption Helpers

    /**
     * Encrypt data using AES-GCM.
     */
    private fun symmetricEncrypt(plaintext: String, key: ByteArray): String {
        val iv = ByteArray(12)
        SecureRandom().nextBytes(iv)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keySpec = SecretKeySpec(key, "AES")
        val gcmSpec = GCMParameterSpec(128, iv)

        cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec)
        val encrypted = cipher.doFinal(plaintext.toByteArray(StandardCharsets.UTF_8))

        // Combined format: nonce + ciphertext + tag
        val combined = ByteArray(iv.size + encrypted.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(encrypted, 0, combined, iv.size, encrypted.size)

        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    /**
     * Generate RSA key pair for vault encryption.
     */
    private fun generateRsaKeyPair(): Pair<String, String> {
        val keyPairGenerator = KeyPairGenerator.getInstance("RSA")
        keyPairGenerator.initialize(2048)
        val keyPair = keyPairGenerator.generateKeyPair()

        val publicKey = keyPair.public as java.security.interfaces.RSAPublicKey
        val privateKey = keyPair.private as java.security.interfaces.RSAPrivateKey

        // Export as simple JWK format
        val publicKeyJwk = JSONObject().apply {
            put("kty", "RSA")
            put("key_ops", JSONArray().put("encrypt"))
            put("ext", true)
            put(
                "n",
                Base64.encodeToString(
                    publicKey.modulus.toByteArray(),
                    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
                ),
            )
            put(
                "e",
                Base64.encodeToString(
                    publicKey.publicExponent.toByteArray(),
                    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
                ),
            )
        }

        val privateKeyJwk = JSONObject().apply {
            put("kty", "RSA")
            put("key_ops", JSONArray().put("decrypt"))
            put("ext", true)
            put(
                "n",
                Base64.encodeToString(
                    privateKey.modulus.toByteArray(),
                    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
                ),
            )
        }

        return Pair(publicKeyJwk.toString(), privateKeyJwk.toString())
    }

    // endregion

    // region Empty Vault Creation

    /**
     * Create an empty vault database as base64 string.
     */
    private fun createEmptyVaultDatabase(): String {
        val tempFile = File.createTempFile("vault", ".db")
        try {
            val db = SQLiteDatabase.openOrCreateDatabase(tempFile, null)
            try {
                // Execute the complete schema SQL
                val statements = VaultSql.completeSchema.split(";")
                for (statement in statements) {
                    val trimmed = statement.trim()
                    if (trimmed.isNotEmpty()) {
                        db.execSQL("$trimmed;")
                    }
                }
            } finally {
                db.close()
            }

            // Read the database file and encode as base64
            val dbBytes = tempFile.readBytes()
            return Base64.encodeToString(dbBytes, Base64.NO_WRAP)
        } finally {
            tempFile.delete()
        }
    }

    // endregion

    // region Public API

    /**
     * Create a test user with random credentials.
     */
    suspend fun createTestUser(apiBaseUrl: String? = null): TestUser {
        val url = apiBaseUrl ?: apiUrl
        val username = generateTestUsername()
        val password = generateTestPassword()

        val tokenResponse = registerTestUser(
            apiBaseUrl = url,
            username = username,
            password = password,
        )

        return TestUser(
            username = username,
            password = password,
            token = tokenResponse.token,
            refreshToken = tokenResponse.refreshToken,
        )
    }

    /**
     * Check if the API is available.
     */
    suspend fun isApiAvailable(apiBaseUrl: String? = null): Boolean = withContext(Dispatchers.IO) {
        val url = (apiBaseUrl ?: apiUrl).trimEnd('/') + "/v1/"

        try {
            val connection = URL("${url}Auth/status").openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.connectTimeout = 5000
            connection.readTimeout = 5000

            val responseCode = connection.responseCode
            connection.disconnect()

            // Status endpoint returns 401 when not authenticated, but that means API is running
            responseCode == 401 || responseCode == 200
        } catch (e: Exception) {
            Log.e(TAG, "API not available", e)
            false
        }
    }

    // endregion

    // region Test Helpers (DEV API Endpoints)

    /**
     * Get vault revision information for a user by username.
     * This is an anonymous endpoint that doesn't require authentication.
     */
    suspend fun getVaultRevisionsByUsername(
        username: String,
        apiBaseUrl: String? = null,
    ): Pair<Int, Int> = withContext(Dispatchers.IO) {
        val url = (apiBaseUrl ?: apiUrl).trimEnd('/') + "/v1/"
        val encodedUsername = java.net.URLEncoder.encode(username, "UTF-8")

        val connection =
            URL("${url}Test/vault-revisions/by-username/$encodedUsername").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("Content-Type", "application/json")

            if (connection.responseCode != 200) {
                throw Exception("Failed to get vault revisions: HTTP ${connection.responseCode}")
            }

            val responseBody = connection.inputStream.bufferedReader().readText()
            val json = JSONObject(responseBody)

            Pair(
                json.optInt("count", 0),
                json.optInt("currentRevision", 0),
            )
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Delete the newest vault revisions for a user by username.
     */
    suspend fun deleteVaultRevisionsByUsername(
        username: String,
        count: Int,
        apiBaseUrl: String? = null,
    ): Int = withContext(Dispatchers.IO) {
        val url = (apiBaseUrl ?: apiUrl).trimEnd('/') + "/v1/"
        val encodedUsername = java.net.URLEncoder.encode(username, "UTF-8")

        val connection =
            URL("${url}Test/vault-revisions/by-username/$encodedUsername/$count").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "DELETE"
            connection.setRequestProperty("Content-Type", "application/json")

            if (connection.responseCode != 200) {
                throw Exception("Failed to delete vault revisions: HTTP ${connection.responseCode}")
            }

            val responseBody = connection.inputStream.bufferedReader().readText()
            val json = JSONObject(responseBody)

            json.optInt("deleted", 0)
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Block a user's account by username.
     */
    suspend fun blockUserByUsername(
        username: String,
        apiBaseUrl: String? = null,
    ) = withContext(Dispatchers.IO) {
        val url = (apiBaseUrl ?: apiUrl).trimEnd('/') + "/v1/"
        val encodedUsername = java.net.URLEncoder.encode(username, "UTF-8")

        val connection =
            URL("${url}Test/block-user/by-username/$encodedUsername").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")

            if (connection.responseCode != 200) {
                throw Exception("Failed to block user: HTTP ${connection.responseCode}")
            }
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Unblock a user's account by username.
     */
    suspend fun unblockUserByUsername(
        username: String,
        apiBaseUrl: String? = null,
    ) = withContext(Dispatchers.IO) {
        val url = (apiBaseUrl ?: apiUrl).trimEnd('/') + "/v1/"
        val encodedUsername = java.net.URLEncoder.encode(username, "UTF-8")

        val connection =
            URL("${url}Test/unblock-user/by-username/$encodedUsername").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")

            if (connection.responseCode != 200) {
                throw Exception("Failed to unblock user: HTTP ${connection.responseCode}")
            }
        } finally {
            connection.disconnect()
        }
    }

    // endregion
}
