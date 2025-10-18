package net.aliasvault.app.webapi

import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * Response object from a WebAPI request containing status code, body, and headers
 */
data class WebApiResponse(
    val statusCode: Int,
    val body: String,
    val headers: Map<String, String>,
)

/**
 * Native Kotlin WebAPI service for making HTTP requests to the AliasVault server.
 * This service handles authentication, token refresh, and all HTTP operations.
 */
class WebApiService(private val context: Context) {
    companion object {
        private const val TAG = "WebApiService"
        private const val API_URL_KEY = "apiUrl"
        private const val ACCESS_TOKEN_KEY = "accessToken"
        private const val REFRESH_TOKEN_KEY = "refreshToken"
        private const val DEFAULT_API_URL = "https://app.aliasvault.net/api"
        private const val SHARED_PREFS_NAME = "aliasvault"
    }

    private val sharedPreferences = context.getSharedPreferences(SHARED_PREFS_NAME, Context.MODE_PRIVATE)

    // MARK: - Configuration Management

    /**
     * Set the API URL
     */
    fun setApiUrl(url: String) {
        sharedPreferences.edit().putString(API_URL_KEY, url).apply()
    }

    /**
     * Get the API URL
     */
    fun getApiUrl(): String {
        return sharedPreferences.getString(API_URL_KEY, DEFAULT_API_URL) ?: DEFAULT_API_URL
    }

    /**
     * Get the base URL with /v1/ appended
     */
    private fun getBaseUrl(): String {
        val apiUrl = getApiUrl()
        val trimmedUrl = apiUrl.trimEnd('/')
        return "$trimmedUrl/v1/"
    }

    // MARK: - Token Management

    /**
     * Set both access and refresh tokens
     */
    fun setAuthTokens(accessToken: String, refreshToken: String) {
        sharedPreferences.edit()
            .putString(ACCESS_TOKEN_KEY, accessToken)
            .putString(REFRESH_TOKEN_KEY, refreshToken)
            .commit() // Use commit() instead of apply() to ensure synchronous write
    }

    /**
     * Get the access token
     */
    fun getAccessToken(): String? {
        return sharedPreferences.getString(ACCESS_TOKEN_KEY, null)
    }

    /**
     * Get the refresh token
     */
    private fun getRefreshToken(): String? {
        return sharedPreferences.getString(REFRESH_TOKEN_KEY, null)
    }

    /**
     * Clear both access and refresh tokens
     */
    fun clearAuthTokens() {
        sharedPreferences.edit()
            .remove(ACCESS_TOKEN_KEY)
            .remove(REFRESH_TOKEN_KEY)
            .apply()
    }

    // MARK: - HTTP Request Execution

    /**
     * Execute a WebAPI request with support for authentication and token refresh
     */
    suspend fun executeRequest(
        method: String,
        endpoint: String,
        body: String?,
        headers: Map<String, String>,
        requiresAuth: Boolean,
    ): WebApiResponse = withContext(Dispatchers.IO) {
        val requestHeaders = headers.toMutableMap()

        // Add authorization header if authentication is required AND not already provided
        if (requiresAuth && !requestHeaders.containsKey("Authorization")) {
            getAccessToken()?.let { accessToken ->
                requestHeaders["Authorization"] = "Bearer $accessToken"
                Log.d(TAG, "Added Authorization header from stored token")
            }
        } else if (requiresAuth && requestHeaders.containsKey("Authorization")) {
            Log.d(TAG, "Using provided Authorization header instead of stored token")
        }

        // Add client version header
        requestHeaders["X-AliasVault-Client"] = getClientVersionHeader()

        // Execute the request
        val response = executeRawRequest(
            method = method,
            endpoint = endpoint,
            body = body,
            headers = requestHeaders,
        )

        // Handle 401 Unauthorized - attempt token refresh
        if (response.statusCode == 401 && requiresAuth) {
            Log.d(TAG, "Received 401, attempting token refresh")

            val newToken = refreshAccessToken()
            if (newToken != null) {
                // Retry the request with the new token
                val retryHeaders = headers.toMutableMap()
                retryHeaders["Authorization"] = "Bearer $newToken"
                retryHeaders["X-AliasVault-Client"] = getClientVersionHeader()

                val retryResponse = executeRawRequest(
                    method = method,
                    endpoint = endpoint,
                    body = body,
                    headers = retryHeaders,
                )

                return@withContext retryResponse
            } else {
                Log.w(TAG, "Token refresh failed, returning 401")
                // Token refresh failed, return 401 response
                return@withContext response
            }
        }

        response
    }

    /**
     * Execute a raw HTTP request without token refresh logic
     */
    private suspend fun executeRawRequest(
        method: String,
        endpoint: String,
        body: String?,
        headers: Map<String, String>,
    ): WebApiResponse = withContext(Dispatchers.IO) {
        val baseUrl = getBaseUrl()
        val urlString = "$baseUrl$endpoint"

        Log.d(TAG, "Executing $method request to $urlString")

        var connection: HttpURLConnection? = null
        try {
            val url = URL(urlString)
            connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = method.uppercase()
            connection.connectTimeout = 30000 // 30 seconds
            connection.readTimeout = 30000 // 30 seconds
            connection.doInput = true

            // Set headers
            for ((key, value) in headers) {
                connection.setRequestProperty(key, value)
            }

            // Set body if present
            if (body != null && (method.uppercase() == "POST" || method.uppercase() == "PUT" || method.uppercase() == "PATCH")) {
                connection.doOutput = true
                OutputStreamWriter(connection.outputStream).use { writer ->
                    writer.write(body)
                    writer.flush()
                }
            }

            // Get response code
            val statusCode = connection.responseCode

            // Read response body
            val responseBody = try {
                if (statusCode in 200..299) {
                    BufferedReader(InputStreamReader(connection.inputStream)).use { reader ->
                        reader.readText()
                    }
                } else {
                    BufferedReader(InputStreamReader(connection.errorStream ?: connection.inputStream)).use { reader ->
                        reader.readText()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error reading response body", e)
                ""
            }

            // Extract headers
            val responseHeaders = mutableMapOf<String, String>()
            for ((key, values) in connection.headerFields) {
                if (key != null && values.isNotEmpty()) {
                    responseHeaders[key] = values[0]
                }
            }

            Log.d(TAG, "Response status: $statusCode")

            WebApiResponse(
                statusCode = statusCode,
                body = responseBody,
                headers = responseHeaders,
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error executing request", e)
            throw e
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * Refresh the access token using the refresh token
     */
    private suspend fun refreshAccessToken(): String? = withContext(Dispatchers.IO) {
        val refreshToken = getRefreshToken()
        val accessToken = getAccessToken()

        if (refreshToken == null || accessToken == null) {
            Log.w(TAG, "No tokens available for refresh")
            return@withContext null
        }

        try {
            // Prepare refresh request body
            val refreshBody = JSONObject()
            refreshBody.put("token", accessToken)
            refreshBody.put("refreshToken", refreshToken)

            val headers = mutableMapOf(
                "Content-Type" to "application/json",
                "X-Ignore-Failure" to "true",
            )
            headers["X-AliasVault-Client"] = getClientVersionHeader()

            val response = executeRawRequest(
                method = "POST",
                endpoint = "Auth/refresh",
                body = refreshBody.toString(),
                headers = headers,
            )

            if (response.statusCode != 200) {
                Log.w(TAG, "Token refresh failed with status ${response.statusCode}")
                return@withContext null
            }

            // Parse the response JSON
            val json = JSONObject(response.body)
            val newToken = if (json.has("token")) json.getString("token") else null
            val newRefreshToken = if (json.has("refreshToken")) json.getString("refreshToken") else null

            if (newToken == null || newRefreshToken == null) {
                Log.w(TAG, "Token refresh response missing tokens")
                return@withContext null
            }

            // Update stored tokens
            setAuthTokens(accessToken = newToken, refreshToken = newRefreshToken)

            Log.d(TAG, "Token refresh successful")
            newToken
        } catch (e: Exception) {
            Log.e(TAG, "Token refresh failed", e)
            null
        }
    }

    // MARK: - Helper Methods

    /**
     * Get the client version header value
     */
    private fun getClientVersionHeader(): String {
        return try {
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            val version = packageInfo.versionName ?: "0.0.0"
            val baseVersion = version.split("-").firstOrNull() ?: "0.0.0"
            "android-$baseVersion"
        } catch (e: PackageManager.NameNotFoundException) {
            Log.e(TAG, "Error getting package version", e)
            "android-0.0.0"
        }
    }

    // MARK: - Token Revocation

    /**
     * Revoke tokens via WebAPI (called when logging out)
     */
    suspend fun revokeTokens() = withContext(Dispatchers.IO) {
        try {
            // Get tokens to revoke
            val refreshToken = getRefreshToken()
            val accessToken = getAccessToken()

            if (refreshToken == null || accessToken == null) {
                // No tokens to revoke
                clearAuthTokens()
                return@withContext
            }

            // Prepare revoke request body
            val revokeBody = JSONObject()
            revokeBody.put("token", accessToken)
            revokeBody.put("refreshToken", refreshToken)

            // Execute revoke request
            val response = executeRequest(
                method = "POST",
                endpoint = "Auth/revoke",
                body = revokeBody.toString(),
                headers = mapOf("Content-Type" to "application/json"),
                requiresAuth = false,
            )

            // Log if revoke failed, but always clear tokens
            if (response.statusCode != 200) {
                Log.w(TAG, "Token revoke failed with status ${response.statusCode}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Token revoke error", e)
        }

        // Always clear tokens, even if revoke fails
        clearAuthTokens()
    }
}
