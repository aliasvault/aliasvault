package net.aliasvault.app.nativevaultmanager

import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.net.toUri
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.TurboModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import net.aliasvault.app.qrscanner.QRScannerActivity
import net.aliasvault.app.vaultstore.AppError
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider
import net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider
import net.aliasvault.app.webapi.WebApiService
import org.json.JSONArray
import org.json.JSONObject

/**
 * The native vault manager that manages the vault store and all input/output operations on it.
 * This class implements the NativeVaultManagerSpec React Native interface and then calls the
 * VaultStore class to perform the actual operations.
 *
 * @param reactContext The React context
 */
@Suppress("TooManyFunctions") // Required by React Native TurboModule interface
@ReactModule(name = NativeVaultManager.NAME)
class NativeVaultManager(reactContext: ReactApplicationContext) :
    NativeVaultManagerSpec(reactContext), TurboModule, LifecycleEventListener {

    companion object {
        /**
         * The name of the module.
         */
        const val NAME = "NativeVaultManager"

        /**
         * The tag for logging.
         */
        private const val TAG = "NativeVaultManager"

        /**
         * Request code for PIN unlock activity.
         */
        const val PIN_UNLOCK_REQUEST_CODE = 1001

        /**
         * Request code for PIN setup activity.
         */
        const val PIN_SETUP_REQUEST_CODE = 1002

        /**
         * Request code for QR scanner activity.
         */
        const val QR_SCANNER_REQUEST_CODE = 1003

        /**
         * Request code for password unlock activity.
         */
        const val PASSWORD_UNLOCK_REQUEST_CODE = 1004

        /**
         * Static holder for the pending promise from showPinUnlock.
         * This allows MainActivity to resolve/reject the promise directly without
         * depending on React context availability.
         */
        @Volatile
        var pendingActivityResultPromise: Promise? = null

        /**
         * Static holder for the pending promise from showPinSetup.
         * This allows MainActivity to resolve/reject the promise directly without
         * depending on React context availability.
         */
        @Volatile
        var pinSetupPromise: Promise? = null

        /**
         * Static holder for the pending promise from showPasswordUnlock.
         * This allows MainActivity to resolve/reject the promise directly without
         * depending on React context availability.
         */
        @Volatile
        var passwordUnlockPromise: Promise? = null

        /**
         * Static holder for authentication context (title, subtitle) to support password fallback
         * when PIN is cancelled in authenticateUser flow.
         */
        @Volatile
        var pendingAuthContext: Pair<String?, String?>? = null
    }

    private val vaultStore = VaultStore.getInstance(
        AndroidKeystoreProvider(reactContext) { getFragmentActivity() },
        AndroidStorageProvider(reactContext),
    )

    private val webApiService = WebApiService(reactContext)

    init {
        // Register for lifecycle callbacks
        reactContext.addLifecycleEventListener(this)
    }

    /**
     * Called when the app enters the background.
     */
    override fun onHostPause() {
        Log.d(TAG, "App entered background")
        vaultStore.onAppBackgrounded()
    }

    /**
     * Called when the app enters the foreground.
     */
    override fun onHostResume() {
        Log.d(TAG, "App entered foreground")
        vaultStore.onAppForegrounded()
    }

    /**
     * Called when the app is destroyed.
     */
    override fun onHostDestroy() {
        // Not needed
    }

    /**
     * Get the name of the module.
     * @return The name of the module
     */
    override fun getName(): String {
        return NAME
    }

    /**
     * Clear session data only (for forced logout).
     * Preserves vault data on disk for recovery on next login.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun clearSession(promise: Promise) {
        try {
            vaultStore.clearSession()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing session", e)
            promise.reject("ERR_CLEAR_SESSION", "Failed to clear session: ${e.message}", e)
        }
    }

    /**
     * Clear all vault data including from persisted storage.
     * This is used for user-initiated logout.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun clearVault(promise: Promise) {
        try {
            vaultStore.clearVault()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing vault", e)
            promise.reject("ERR_CLEAR_VAULT", "Failed to clear vault: ${e.message}", e)
        }
    }

    /**
     * Check if the vault is unlocked.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun isVaultUnlocked(promise: Promise) {
        promise.resolve(vaultStore.isVaultUnlocked())
    }

    /**
     * Get the vault metadata.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun getVaultMetadata(promise: Promise) {
        try {
            val metadata = vaultStore.getMetadata()
            promise.resolve(metadata)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting vault metadata", e)
            promise.reject("ERR_GET_METADATA", "Failed to get vault metadata: ${e.message}", e)
        }
    }

    /**
     * Unlock the vault.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun unlockVault(promise: Promise) {
        try {
            vaultStore.unlockVault()
            promise.resolve(null)
        } catch (e: AppError) {
            Log.e(TAG, "Error unlocking vault: ${e.code}", e)
            promise.reject(e.code, e.message, e)
        } catch (e: Exception) {
            Log.e(TAG, "Error unlocking vault", e)
            promise.reject("E-001", "Failed to unlock vault: ${e.message}", e)
        }
    }

    /**
     * Store the metadata.
     * @param metadata The metadata as a string
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun storeMetadata(metadata: String, promise: Promise) {
        try {
            vaultStore.storeMetadata(metadata)
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error storing metadata", e)
            promise.reject("ERR_STORE_METADATA", "Failed to store metadata: ${e.message}", e)
        }
    }

    /**
     * Set the auth methods.
     * @param authMethods The auth methods
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun setAuthMethods(authMethods: ReadableArray, promise: Promise) {
        try {
            val jsonArray = JSONArray()
            for (i in 0 until authMethods.size()) {
                jsonArray.put(authMethods.getString(i))
            }
            vaultStore.setAuthMethods(jsonArray.toString())
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error setting auth methods", e)
            promise.reject("ERR_SET_AUTH_METHODS", "Failed to set auth methods: ${e.message}", e)
        }
    }

    /**
     * Store the encryption key in memory only (no keystore persistence).
     * Use this to test if a password-derived key is valid before persisting.
     * @param base64EncryptionKey The encryption key as a base64 encoded string
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun storeEncryptionKeyInMemory(base64EncryptionKey: String, promise: Promise) {
        try {
            vaultStore.storeEncryptionKeyInMemory(base64EncryptionKey)
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error storing encryption key in memory", e)
            promise.reject("ERR_STORE_KEY_MEMORY", "Failed to store encryption key in memory: ${e.message}", e)
        }
    }

    /**
     * Store the encryption key in memory AND persist to keystore (may trigger biometric prompt).
     * @param base64EncryptionKey The encryption key as a base64 encoded string
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun storeEncryptionKey(base64EncryptionKey: String, promise: Promise) {
        try {
            vaultStore.storeEncryptionKey(base64EncryptionKey)
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error storing encryption key", e)
            promise.reject("ERR_STORE_KEY", "Failed to store encryption key: ${e.message}", e)
        }
    }

    /**
     * Clear the encryption key from memory.
     * This forces getEncryptionKey() to fetch from keystore on next biometric access.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun clearEncryptionKeyFromMemory(promise: Promise) {
        vaultStore.clearEncryptionKeyFromMemory()
        promise.resolve(null)
    }

    /**
     * Store the encryption key derivation parameters.
     * @param keyDerivationParams The encryption key derivation parameters
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun storeEncryptionKeyDerivationParams(keyDerivationParams: String, promise: Promise) {
        try {
            vaultStore.storeEncryptionKeyDerivationParams(keyDerivationParams)
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error storing key derivation params", e)
            promise.reject(
                "ERR_STORE_KEY_PARAMS",
                "Failed to store key derivation params: ${e.message}",
                e,
            )
        }
    }

    /**
     * Get the encryption key derivation parameters.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun getEncryptionKeyDerivationParams(promise: Promise) {
        try {
            val params = vaultStore.getEncryptionKeyDerivationParams()
            promise.resolve(params)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting key derivation params", e)
            promise.reject(
                "ERR_GET_KEY_PARAMS",
                "Failed to get key derivation params: ${e.message}",
                e,
            )
        }
    }

    /**
     * Encrypt the decryption key for mobile login.
     * @param publicKeyJWK The public key in JWK format
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun encryptDecryptionKeyForMobileLogin(publicKeyJWK: String, promise: Promise) {
        try {
            val encryptedKey = vaultStore.encryptDecryptionKeyForMobileLogin(publicKeyJWK)
            promise.resolve(encryptedKey)
        } catch (e: Exception) {
            Log.e(TAG, "Error encrypting key for mobile login", e)
            promise.reject(
                "ERR_ENCRYPT_KEY_MOBILE_LOGIN",
                "Failed to encrypt key for mobile login: ${e.message}",
                e,
            )
        }
    }

    /**
     * Check if the encrypted database exists.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun hasEncryptedDatabase(promise: Promise) {
        try {
            val hasDb = vaultStore.hasEncryptedDatabase()
            promise.resolve(hasDb)
        } catch (e: Exception) {
            Log.e(TAG, "Error checking encrypted database", e)
            promise.reject("ERR_CHECK_DB", "Failed to check encrypted database: ${e.message}", e)
        }
    }

    /**
     * Get the encrypted database.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun getEncryptedDatabase(promise: Promise) {
        try {
            val encryptedDb = vaultStore.getEncryptedDatabase()
            promise.resolve(encryptedDb)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting encrypted database", e)
            promise.reject("ERR_GET_DB", "Failed to get encrypted database: ${e.message}", e)
        }
    }

    /**
     * Execute a query on the vault.
     * @param query The query
     * @param params The parameters to the query
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun executeQuery(query: String, params: ReadableArray, promise: Promise) {
        try {
            val paramsArray = Array<Any?>(params.size()) { i ->
                when (params.getType(i)) {
                    ReadableType.Null -> null
                    ReadableType.Boolean -> params.getBoolean(i)
                    ReadableType.Number -> params.getDouble(i)
                    ReadableType.String -> params.getString(i)
                    else -> null
                }
            }

            val results = vaultStore.executeQuery(query, paramsArray)
            val resultArray = Arguments.createArray()

            for (row in results) {
                val rowMap = Arguments.createMap()
                for ((key, value) in row) {
                    when (value) {
                        null -> rowMap.putNull(key)
                        is Boolean -> rowMap.putBoolean(key, value)
                        is Int -> rowMap.putInt(key, value)
                        is Long -> rowMap.putDouble(key, value.toDouble())
                        is Float -> rowMap.putDouble(key, value.toDouble())
                        is Double -> rowMap.putDouble(key, value)
                        is String -> rowMap.putString(key, value)
                        is ByteArray -> rowMap.putString(
                            key,
                            android.util.Base64.encodeToString(value, android.util.Base64.NO_WRAP),
                        )
                        else -> rowMap.putString(key, value.toString())
                    }
                }
                resultArray.pushMap(rowMap)
            }

            promise.resolve(resultArray)
        } catch (e: Exception) {
            Log.e(TAG, "Error executing query", e)
            promise.reject("ERR_EXECUTE_QUERY", "Failed to execute query: ${e.message}", e)
        }
    }

    /**
     * Execute an update on the vault.
     * @param query The query
     * @param params The parameters to the query
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun executeUpdate(query: String, params: ReadableArray, promise: Promise) {
        try {
            val paramsArray = Array<Any?>(params.size()) { i ->
                when (params.getType(i)) {
                    ReadableType.Null -> null
                    ReadableType.Boolean -> params.getBoolean(i)
                    ReadableType.Number -> params.getDouble(i)
                    ReadableType.String -> params.getString(i)
                    else -> null
                }
            }

            val affectedRows = vaultStore.executeUpdate(query, paramsArray)
            promise.resolve(affectedRows)
        } catch (e: Exception) {
            Log.e(TAG, "Error executing update", e)
            promise.reject("ERR_EXECUTE_UPDATE", "Failed to execute update: ${e.message}", e)
        }
    }

    /**
     * Execute a raw SQL query on the vault without parameters.
     * @param query The raw SQL query
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun executeRaw(query: String, promise: Promise) {
        try {
            vaultStore.executeRaw(query)
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error executing raw query", e)
            promise.reject("ERR_EXECUTE_RAW", "Failed to execute raw query: ${e.message}", e)
        }
    }

    /**
     * Begin a transaction on the vault.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun beginTransaction(promise: Promise) {
        try {
            vaultStore.beginTransaction()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error beginning transaction", e)
            promise.reject("ERR_BEGIN_TRANSACTION", "Failed to begin transaction: ${e.message}", e)
        }
    }

    /**
     * Commit a transaction on the vault.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun commitTransaction(promise: Promise) {
        try {
            vaultStore.commitTransaction()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error committing transaction", e)
            promise.reject(
                "ERR_COMMIT_TRANSACTION",
                "Failed to commit transaction: ${e.message}",
                e,
            )
        }
    }

    /**
     * Rollback a transaction on the vault.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun rollbackTransaction(promise: Promise) {
        try {
            vaultStore.rollbackTransaction()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error rolling back transaction", e)
            promise.reject(
                "ERR_ROLLBACK_TRANSACTION",
                "Failed to rollback transaction: ${e.message}",
                e,
            )
        }
    }

    /**
     * Persist the in-memory database to encrypted storage and mark as dirty.
     * Used after migrations where SQL handles its own transactions but we need to persist and sync.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun persistAndMarkDirty(promise: Promise) {
        try {
            vaultStore.persistAndMarkDirty()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error persisting and marking dirty", e)
            promise.reject(
                "ERR_PERSIST_AND_MARK_DIRTY",
                "Failed to persist and mark dirty: ${e.message}",
                e,
            )
        }
    }

    /**
     * Set the auto-lock timeout.
     * @param timeout The timeout in seconds
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun setAutoLockTimeout(timeout: Double, promise: Promise?) {
        try {
            vaultStore.setAutoLockTimeout(timeout.toInt())
            promise?.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error setting auto-lock timeout", e)
            promise?.reject("ERR_SET_TIMEOUT", "Failed to set auto-lock timeout: ${e.message}", e)
        }
    }

    /**
     * Get the auto-lock timeout.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun getAutoLockTimeout(promise: Promise) {
        try {
            val timeout = vaultStore.getAutoLockTimeout()
            promise.resolve(timeout)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting auto-lock timeout", e)
            promise.reject("ERR_GET_TIMEOUT", "Failed to get auto-lock timeout: ${e.message}", e)
        }
    }

    /**
     * Clear clipboard after a delay.
     * @param delayInSeconds The delay in seconds after which to clear the clipboard
     * @param promise Optional promise to resolve (for internal calls)
     */
    private fun clearClipboardAfterDelay(delayInSeconds: Double, promise: Promise?) {
        Log.d(TAG, "Scheduling clipboard clear after $delayInSeconds seconds")

        if (delayInSeconds <= 0) {
            Log.d(TAG, "Delay is 0 or negative, not scheduling clipboard clear")
            promise?.resolve(null)
            return
        }

        // Use AlarmManager to ensure execution even if app is backgrounded
        try {
            val alarmManager = reactApplicationContext.getSystemService(android.content.Context.ALARM_SERVICE) as android.app.AlarmManager

            // Check if we can schedule exact alarms (Android 12+/API 31+)
            val canScheduleExactAlarms = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                alarmManager.canScheduleExactAlarms()
            } else {
                true // Pre-Android 12 doesn't require permission
            }

            if (!canScheduleExactAlarms) {
                Log.w(TAG, "Cannot schedule exact alarms - permission denied. Falling back to Handler.")
                throw SecurityException("Exact alarm permission not granted")
            }

            val intent = Intent(reactApplicationContext, ClipboardClearReceiver::class.java)
            val pendingIntent = android.app.PendingIntent.getBroadcast(
                reactApplicationContext,
                0,
                intent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )

            // Cancel any existing alarm
            alarmManager.cancel(pendingIntent)

            // Set new alarm
            val triggerTime = System.currentTimeMillis() + (delayInSeconds * 1000).toLong()

            try {
                alarmManager.setExactAndAllowWhileIdle(
                    android.app.AlarmManager.RTC_WAKEUP,
                    triggerTime,
                    pendingIntent,
                )
                Log.d(TAG, "Scheduled clipboard clear using AlarmManager for $delayInSeconds seconds")
            } catch (securityException: SecurityException) {
                Log.w(TAG, "SecurityException when scheduling exact alarm: ${securityException.message}")
                throw securityException
            }
        } catch (e: Exception) {
            when (e) {
                is SecurityException -> {
                    Log.w(TAG, "Exact alarm permission denied. Using inexact alarm fallback.")
                    // Try inexact alarm as fallback
                    try {
                        val alarmManager = reactApplicationContext.getSystemService(android.content.Context.ALARM_SERVICE) as android.app.AlarmManager
                        val intent = Intent(reactApplicationContext, ClipboardClearReceiver::class.java)
                        val pendingIntent = android.app.PendingIntent.getBroadcast(
                            reactApplicationContext,
                            0,
                            intent,
                            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
                        )

                        val triggerTime = System.currentTimeMillis() + (delayInSeconds * 1000).toLong()
                        alarmManager.set(android.app.AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
                        Log.d(TAG, "Scheduled inexact clipboard clear using AlarmManager for ~$delayInSeconds seconds")
                    } catch (fallbackException: Exception) {
                        Log.e(TAG, "Fallback inexact alarm also failed, using Handler: ${fallbackException.message}")
                        useHandlerFallback(delayInSeconds)
                    }
                }
                else -> {
                    Log.e(TAG, "Error scheduling clipboard clear with AlarmManager, using Handler: ${e.message}")
                    useHandlerFallback(delayInSeconds)
                }
            }
        }

        promise?.resolve(null)
    }

    /**
     * Fallback method to clear clipboard using Handler when AlarmManager fails.
     */
    private fun useHandlerFallback(delayInSeconds: Double) {
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        val delayMs = (delayInSeconds * 1000).toLong()
        handler.postDelayed({
            try {
                val clipboardManager = reactApplicationContext.getSystemService(
                    android.content.Context.CLIPBOARD_SERVICE,
                ) as android.content.ClipboardManager
                clipboardManager.clearPrimaryClip()
                Log.d(TAG, "Clipboard cleared using Handler fallback after $delayInSeconds seconds")
            } catch (e: Exception) {
                Log.e(TAG, "Error clearing clipboard with Handler fallback", e)
            }
        }, delayMs)
    }

    /**
     * Copy text to clipboard with automatic expiration.
     * @param text The text to copy to clipboard
     * @param expirationSeconds The number of seconds after which to clear the clipboard
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun copyToClipboardWithExpiration(text: String, expirationSeconds: Double, promise: Promise?) {
        try {
            val clipboardManager = reactApplicationContext.getSystemService(
                android.content.Context.CLIPBOARD_SERVICE,
            ) as android.content.ClipboardManager
            val clip = android.content.ClipData.newPlainText("AliasVault", text)

            // Android 13+ handling
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU && expirationSeconds > 0) {
                // Mark as sensitive to prevent preview display
                val persistableBundle = android.os.PersistableBundle()
                persistableBundle.putBoolean(android.content.ClipDescription.EXTRA_IS_SENSITIVE, true)
                clip.description.extras = persistableBundle

                // Android 13+ automatically clears clipboard after 1 hour (3600 seconds)
                val androidAutoClearSeconds = 3600.0

                if (expirationSeconds <= androidAutoClearSeconds) {
                    // For shorter delays, we still need manual clearing for precision
                    Log.d(TAG, "Using manual clearing for $expirationSeconds seconds (Android 13+ with sensitive flag)")
                    clipboardManager.setPrimaryClip(clip)
                    clearClipboardAfterDelay(expirationSeconds, null)
                } else {
                    // For longer delays, rely on Android's automatic clearing
                    Log.d(TAG, "Relying on Android 13+ automatic clipboard clearing (${androidAutoClearSeconds}s)")
                    clipboardManager.setPrimaryClip(clip)
                    // No manual clearing needed - Android will handle it
                }
            } else {
                // Pre-Android 13 or no expiration
                clipboardManager.setPrimaryClip(clip)

                if (expirationSeconds > 0) {
                    Log.d(TAG, "Using manual clearing for $expirationSeconds seconds (pre-Android 13)")
                    clearClipboardAfterDelay(expirationSeconds, null)
                }
            }

            Log.d(TAG, "Text copied to clipboard successfully")
            promise?.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error copying to clipboard", e)
            promise?.reject("ERR_CLIPBOARD", "Failed to copy to clipboard: ${e.message}", e)
        }
    }

    /**
     * Check if the app is ignoring battery optimizations.
     * @param promise The promise to resolve with boolean result
     */
    @ReactMethod
    override fun isIgnoringBatteryOptimizations(promise: Promise?) {
        try {
            val isIgnoring = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                val powerManager = reactApplicationContext.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
                powerManager.isIgnoringBatteryOptimizations(reactApplicationContext.packageName)
            } else {
                true // Pre-Android 6.0 doesn't have battery optimization
            }
            promise?.resolve(isIgnoring)
        } catch (e: Exception) {
            Log.e(TAG, "Error checking battery optimization status", e)
            promise?.reject("ERR_BATTERY_OPTIMIZATION_CHECK", "Failed to check battery optimization status: ${e.message}", e)
        }
    }

    /**
     * Request battery optimization exemption by opening system settings.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun requestIgnoreBatteryOptimizations(promise: Promise?) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                val powerManager = reactApplicationContext.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager

                if (!powerManager.isIgnoringBatteryOptimizations(reactApplicationContext.packageName)) {
                    Log.d(TAG, "Requesting battery optimization exemption via system settings")
                    val intent = Intent().apply {
                        action = Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
                        data = Uri.parse("package:${reactApplicationContext.packageName}")
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    reactApplicationContext.startActivity(intent)
                    promise?.resolve("Battery optimization exemption request sent - user will be taken to settings")
                } else {
                    Log.d(TAG, "App is already ignoring battery optimizations")
                    promise?.resolve("App is already ignoring battery optimizations")
                }
            } else {
                Log.d(TAG, "Battery optimization not applicable on this Android version")
                promise?.resolve("Battery optimization not applicable on this Android version")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error requesting battery optimization exemption", e)
            promise?.reject("ERR_BATTERY_OPTIMIZATION_REQUEST", "Failed to request battery optimization exemption: ${e.message}", e)
        }
    }

    /**
     * Get the auth methods.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun getAuthMethods(promise: Promise) {
        try {
            val methodsJson = vaultStore.getAuthMethods()
            val jsonArray = JSONArray(methodsJson)
            val methods = Arguments.createArray()

            for (i in 0 until jsonArray.length()) {
                methods.pushString(jsonArray.getString(i))
            }

            promise.resolve(methods)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting auth methods", e)
            promise.reject("ERR_GET_AUTH_METHODS", "Failed to get auth methods: ${e.message}", e)
        }
    }

    /**
     * Derive a key from a password using Argon2Id.
     * @param password The password to derive from
     * @param salt The salt to use
     * @param encryptionType The type of encryption (should be "Argon2Id")
     * @param encryptionSettings JSON string with encryption parameters
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun deriveKeyFromPassword(password: String, salt: String, encryptionType: String, encryptionSettings: String, promise: Promise) {
        try {
            val derivedKey = vaultStore.deriveKeyFromPassword(password, salt, encryptionType, encryptionSettings)
            // Return as base64 string
            val base64Key = android.util.Base64.encodeToString(derivedKey, android.util.Base64.NO_WRAP)
            promise.resolve(base64Key)
        } catch (e: Exception) {
            Log.e(TAG, "Error deriving key from password", e)
            promise.reject("ERR_DERIVE_KEY", "Failed to derive key from password: ${e.message}", e)
        }
    }

    /**
     * Open the autofill settings page.
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun openAutofillSettingsPage(promise: Promise) {
        try {
            // Note: we add a 2 to the packageUri on purpose because if we don't,
            // when the user has configured AliasVault as the autofill service already
            // this action won't open the settings anymore, making the button in the UI
            // become broken and not do anything anymore. This is not good UX so instead
            // we append a "2" so Android will always open the page as it does not equal
            // the actual chosen option.
            val packageUri = "package:${reactApplicationContext.packageName}2".toUri()
            val autofillIntent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
                data = packageUri
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            // Try to resolve the intent first
            if (autofillIntent.resolveActivity(reactApplicationContext.packageManager) != null) {
                reactApplicationContext.startActivity(autofillIntent)
            } else {
                // Fallback to privacy settings (may contain Autofill on Samsung)
                val fallbackIntent = Intent(Settings.ACTION_PRIVACY_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactApplicationContext.startActivity(fallbackIntent)
            }

            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error opening autofill settings", e)
            promise.reject(
                "ERR_OPEN_AUTOFILL_SETTINGS",
                "Failed to open autofill settings: ${e.message}",
                e,
            )
        }
    }

    /**
     * Get the autofill show search text setting.
     * @param promise The promise to resolve with boolean result
     */
    @ReactMethod
    override fun getAutofillShowSearchText(promise: Promise) {
        try {
            val sharedPreferences = reactApplicationContext.getSharedPreferences("AliasVaultPrefs", android.content.Context.MODE_PRIVATE)
            val showSearchText = sharedPreferences.getBoolean("autofill_show_search_text", false)
            promise.resolve(showSearchText)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting autofill show search text setting", e)
            promise.reject("ERR_GET_AUTOFILL_SETTING", "Failed to get autofill show search text setting: ${e.message}", e)
        }
    }

    /**
     * Set the autofill show search text setting.
     * @param showSearchText Whether to show search text in autofill
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun setAutofillShowSearchText(showSearchText: Boolean, promise: Promise) {
        try {
            val sharedPreferences = reactApplicationContext.getSharedPreferences("AliasVaultPrefs", android.content.Context.MODE_PRIVATE)
            sharedPreferences.edit().putBoolean("autofill_show_search_text", showSearchText).apply()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error setting autofill show search text setting", e)
            promise.reject("ERR_SET_AUTOFILL_SETTING", "Failed to set autofill show search text setting: ${e.message}", e)
        }
    }

    /**
     * Get the current fragment activity.
     * @return The fragment activity
     */
    private fun getFragmentActivity(): FragmentActivity? {
        return currentActivity as? FragmentActivity
    }

    // MARK: - WebAPI Configuration

    /**
     * Set the API URL.
     * @param url The API URL to set
     * @param promise The promise to resolve
     */
    @ReactMethod
    override fun setApiUrl(url: String, promise: Promise) {
        try {
            webApiService.setApiUrl(url)
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error setting API URL", e)
            promise.reject("ERR_SET_API_URL", "Failed to set API URL: ${e.message}", e)
        }
    }

    /**
     * Get the API URL.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun getApiUrl(promise: Promise) {
        try {
            val apiUrl = webApiService.getApiUrl()
            promise.resolve(apiUrl)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting API URL", e)
            promise.reject("ERR_GET_API_URL", "Failed to get API URL: ${e.message}", e)
        }
    }

    // MARK: - WebAPI Token Management

    /**
     * Set both access and refresh tokens.
     * @param accessToken The access token.
     * @param refreshToken The refresh token.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun setAuthTokens(accessToken: String, refreshToken: String, promise: Promise) {
        try {
            webApiService.setAuthTokens(accessToken, refreshToken)
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error setting auth tokens", e)
            promise.reject("ERR_SET_AUTH_TOKENS", "Failed to set auth tokens: ${e.message}", e)
        }
    }

    /**
     * Get the access token.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun getAccessToken(promise: Promise) {
        try {
            val accessToken = webApiService.getAccessToken()
            promise.resolve(accessToken)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting access token", e)
            promise.reject("ERR_GET_ACCESS_TOKEN", "Failed to get access token: ${e.message}", e)
        }
    }

    /**
     * Clear both access and refresh tokens.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun clearAuthTokens(promise: Promise) {
        try {
            webApiService.clearAuthTokens()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing auth tokens", e)
            promise.reject("ERR_CLEAR_AUTH_TOKENS", "Failed to clear auth tokens: ${e.message}", e)
        }
    }

    /**
     * Revoke tokens via WebAPI (called when logging out).
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun revokeTokens(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                webApiService.revokeTokens()
                withContext(Dispatchers.Main) {
                    promise.resolve(null)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Log.e(TAG, "Error revoking tokens", e)
                    promise.reject("ERR_REVOKE_TOKENS", "Failed to revoke tokens: ${e.message}", e)
                }
            }
        }
    }

    // MARK: - WebAPI Request Execution

    /**
     * Execute a WebAPI request.
     * @param method The HTTP method.
     * @param endpoint The API endpoint.
     * @param body The request body (nullable).
     * @param headers The request headers as JSON string.
     * @param requiresAuth Whether authentication is required.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun executeWebApiRequest(
        method: String,
        endpoint: String,
        body: String?,
        headers: String,
        requiresAuth: Boolean,
        promise: Promise,
    ) {
        try {
            // Parse headers from JSON string
            val headersMap = mutableMapOf<String, String>()
            val headersJson = JSONObject(headers)
            headersJson.keys().forEach { key ->
                headersMap[key] = headersJson.getString(key)
            }

            // Execute request using coroutines
            runBlocking {
                val response = webApiService.executeRequest(
                    method = method,
                    endpoint = endpoint,
                    body = body,
                    headers = headersMap,
                    requiresAuth = requiresAuth,
                )

                // Build response JSON
                val responseJson = JSONObject()
                responseJson.put("statusCode", response.statusCode)
                responseJson.put("body", response.body)
                responseJson.put("headers", JSONObject(response.headers))

                promise.resolve(responseJson.toString())
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error executing WebAPI request", e)
            promise.reject("ERR_WEB_API_REQUEST", "Failed to execute WebAPI request: ${e.message}", e)
        }
    }

    /**
     * Register credential identities in the Native Autofill API cache.
     * This stores passkey metadata so they can be shown without unlocking the vault.
     * Runs asynchronously to avoid blocking the UI thread.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun registerCredentialIdentities(promise: Promise) {
        // Resolve promise immediately to avoid blocking navigation
        promise.resolve(null)

        // Execute registration in background thread
        Thread {
            try {
                // Save credential identities to the identity store
                val identityStore = net.aliasvault.app.credentialprovider.CredentialIdentityStore.getInstance(
                    reactApplicationContext,
                )
                identityStore.saveCredentialIdentities(vaultStore)
            } catch (e: Exception) {
                Log.e(TAG, "Error registering credential identities in background", e)
            }
        }.start()
    }

    /**
     * Remove all credential identities from the credential identity store.
     * Called during logout to clear all locally stored credential metadata.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun removeCredentialIdentities(promise: Promise) {
        try {
            Log.d(TAG, "Removing all credential identities from Android store")
            val identityStore = net.aliasvault.app.credentialprovider.CredentialIdentityStore.getInstance(
                reactApplicationContext,
            )
            identityStore.removeAllCredentialIdentities()
            Log.d(TAG, "Successfully removed all credential identities")
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error removing credential identities", e)
            promise.reject("CREDENTIAL_REMOVAL_ERROR", "Failed to remove credential identities: ${e.message}", e)
        }
    }

    // MARK: - Username Management

    /**
     * Set the username.
     * @param username The username to set.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun setUsername(username: String, promise: Promise) {
        try {
            vaultStore.setUsername(username)
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error setting username", e)
            promise.reject("ERR_SET_USERNAME", "Failed to set username: ${e.message}", e)
        }
    }

    /**
     * Get the username.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun getUsername(promise: Promise) {
        try {
            val username = vaultStore.getUsername()
            promise.resolve(username)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting username", e)
            promise.reject("ERR_GET_USERNAME", "Failed to get username: ${e.message}", e)
        }
    }

    /**
     * Clear the username.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun clearUsername(promise: Promise) {
        try {
            vaultStore.clearUsername()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing username", e)
            promise.reject("ERR_CLEAR_USERNAME", "Failed to clear username: ${e.message}", e)
        }
    }

    // MARK: - Server Version Management

    /**
     * Check if the stored server version is greater than or equal to the specified version.
     * @param targetVersion The version to compare against (e.g., "0.25.0")
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun isServerVersionGreaterThanOrEqualTo(targetVersion: String, promise: Promise) {
        try {
            val isGreaterOrEqual = vaultStore.metadata.isServerVersionGreaterThanOrEqualTo(targetVersion)
            promise.resolve(isGreaterOrEqual)
        } catch (e: Exception) {
            Log.e(TAG, "Error comparing server version", e)
            promise.reject("ERR_COMPARE_SERVER_VERSION", "Failed to compare server version: ${e.message}", e)
        }
    }

    // MARK: - Offline Mode Management

    /**
     * Set offline mode flag.
     * @param isOffline Whether app is offline.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun setOfflineMode(isOffline: Boolean, promise: Promise) {
        try {
            vaultStore.setOfflineMode(isOffline)
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error setting offline mode", e)
            promise.reject("ERR_SET_OFFLINE_MODE", "Failed to set offline mode: ${e.message}", e)
        }
    }

    /**
     * Get offline mode flag.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun getOfflineMode(promise: Promise) {
        try {
            val isOffline = vaultStore.getOfflineMode()
            promise.resolve(isOffline)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting offline mode", e)
            promise.reject("ERR_GET_OFFLINE_MODE", "Failed to get offline mode: ${e.message}", e)
        }
    }

    // MARK: - Vault Sync and Mutate

    /**
     * Quick check if sync is needed without doing the actual sync.
     * Used to show appropriate UI indicator before starting sync.
     * @param promise The promise to resolve with sync status.
     */
    @ReactMethod
    override fun checkSyncStatus(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val versionCheck = vaultStore.checkVaultVersion(webApiService)
                val resultMap = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putBoolean("hasNewerVault", versionCheck.isNewVersionAvailable)
                    putBoolean("hasDirtyChanges", versionCheck.syncState.isDirty)
                    putBoolean("isOffline", false)
                    putBoolean("requiresLogout", false)
                    putNull("errorKey")
                }
                withContext(Dispatchers.Main) {
                    promise.resolve(resultMap)
                }
            } catch (e: AppError) {
                withContext(Dispatchers.Main) {
                    // Check for specific error types that require logout
                    val requiresLogout = e.isAuthenticationError || e.isVersionError
                    val errorKey = e.translationKey
                    val isOffline = e.isNetworkError

                    if (isOffline) {
                        val syncState = vaultStore.getSyncState()
                        val resultMap = Arguments.createMap().apply {
                            putBoolean("success", true)
                            putBoolean("hasNewerVault", false)
                            putBoolean("hasDirtyChanges", syncState.isDirty)
                            putBoolean("isOffline", true)
                            putBoolean("requiresLogout", false)
                            putNull("errorKey")
                        }
                        promise.resolve(resultMap)
                    } else {
                        val resultMap = Arguments.createMap().apply {
                            putBoolean("success", !requiresLogout)
                            putBoolean("hasNewerVault", false)
                            putBoolean("hasDirtyChanges", false)
                            putBoolean("isOffline", false)
                            putBoolean("requiresLogout", requiresLogout)
                            if (errorKey != null) {
                                putString("errorKey", errorKey)
                            } else {
                                putNull("errorKey")
                            }
                        }
                        promise.resolve(resultMap)
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Log.e(TAG, "Error checking sync status", e)
                    val resultMap = Arguments.createMap().apply {
                        putBoolean("success", false)
                        putBoolean("hasNewerVault", false)
                        putBoolean("hasDirtyChanges", false)
                        putBoolean("isOffline", false)
                        putBoolean("requiresLogout", false)
                        putNull("errorKey")
                    }
                    promise.resolve(resultMap)
                }
            }
        }
    }

    /**
     * Unified vault sync method that handles all sync scenarios.
     * @param promise The promise to resolve with VaultSyncResult.
     */
    @ReactMethod
    override fun syncVaultWithServer(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val result = vaultStore.syncVaultWithServer(webApiService)
                val resultMap = Arguments.createMap().apply {
                    putBoolean("success", result.success)
                    putString("action", result.action.value)
                    putInt("newRevision", result.newRevision)
                    putBoolean("wasOffline", result.wasOffline)
                    if (result.error != null) {
                        putString("error", result.error)
                    } else {
                        putNull("error")
                    }
                }
                withContext(Dispatchers.Main) {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Log.e(TAG, "Error syncing vault with server", e)
                    promise.reject("VAULT_SYNC_ERROR", "Failed to sync vault: ${e.message}", e)
                }
            }
        }
    }

    // MARK: - PIN Unlock Methods

    /**
     * Check if PIN unlock is enabled.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun isPinEnabled(promise: Promise) {
        try {
            val enabled = vaultStore.isPinEnabled()
            promise.resolve(enabled)
        } catch (e: Exception) {
            Log.e(TAG, "Error checking if PIN is enabled", e)
            promise.reject("ERR_IS_PIN_ENABLED", "Failed to check if PIN is enabled: ${e.message}", e)
        }
    }

    /**
     * Show native PIN setup UI.
     * Launches the native PinUnlockActivity in setup mode.
     * Gets the vault encryption key from memory (vault must be unlocked).
     * @param promise The promise to resolve when setup completes or rejects if cancelled/error.
     */
    @ReactMethod
    override fun showPinSetup(promise: Promise) {
        // Get encryption key first
        vaultStore.getEncryptionKey(object : net.aliasvault.app.vaultstore.interfaces.CryptoOperationCallback {
            override fun onSuccess(encryptionKey: String) {
                try {
                    val activity = currentActivity
                    if (activity == null) {
                        promise.reject("ERR_NO_ACTIVITY", "No activity available")
                        return
                    }

                    // Store the promise for later resolution
                    pinSetupPromise = promise

                    // Launch PIN setup activity
                    val intent = android.content.Intent(activity, net.aliasvault.app.pinunlock.PinUnlockActivity::class.java)
                    intent.putExtra(net.aliasvault.app.pinunlock.PinUnlockActivity.EXTRA_MODE, net.aliasvault.app.pinunlock.PinUnlockActivity.MODE_SETUP)
                    intent.putExtra(net.aliasvault.app.pinunlock.PinUnlockActivity.EXTRA_SETUP_ENCRYPTION_KEY, encryptionKey)

                    activity.startActivityForResult(intent, PIN_SETUP_REQUEST_CODE)
                } catch (e: Exception) {
                    Log.e(TAG, "Error launching PIN setup activity", e)
                    promise.reject("ERR_LAUNCH_PIN_SETUP", "Failed to launch PIN setup: ${e.message}", e)
                }
            }

            override fun onError(error: Exception) {
                Log.e(TAG, "Error getting encryption key for PIN setup", error)
                promise.reject("ERR_SETUP_PIN", "Failed to get encryption key: ${error.message}", error)
            }
        })
    }

    /**
     * Disable PIN unlock and remove all stored data.
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun removeAndDisablePin(promise: Promise) {
        try {
            vaultStore.removeAndDisablePin()
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error removing and disabling PIN", e)
            promise.reject("ERR_REMOVE_AND_DISABLE_PIN", "Failed to remove and disable PIN: ${e.message}", e)
        }
    }

    /**
     * Show PIN unlock UI.
     * This presents a native PIN unlock screen modally and handles the unlock flow.
     * On success, the vault is unlocked and the encryption key is stored in memory.
     * On cancel or error, the promise is rejected.
     *
     * @param promise The promise to resolve on success or reject on error/cancel.
     */
    @ReactMethod
    override fun showPinUnlock(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No activity available", null)
            return
        }

        // Store promise in static companion object so MainActivity can resolve it directly
        // This avoids race conditions with React context availability
        pendingActivityResultPromise = promise

        // Launch PIN unlock activity
        val intent = Intent(activity, net.aliasvault.app.pinunlock.PinUnlockActivity::class.java)
        activity.startActivityForResult(intent, PIN_UNLOCK_REQUEST_CODE)
    }

    /**
     * Show native password unlock screen.
     * Returns encryption key (base64) if successful, null if cancelled.
     *
     * @param title Custom title for the password unlock screen. If null or empty, uses default.
     * @param subtitle Custom subtitle for the password unlock screen. If null or empty, uses default.
     * @param promise The promise to resolve with encryption key or null.
     */
    @ReactMethod
    override fun showPasswordUnlock(title: String?, subtitle: String?, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No activity available", null)
            return
        }

        // Store promise in static companion object so MainActivity can resolve it directly
        passwordUnlockPromise = promise

        // Launch password unlock activity
        val intent = Intent(activity, net.aliasvault.app.passwordunlock.PasswordUnlockActivity::class.java)
        if (!title.isNullOrEmpty()) {
            intent.putExtra(net.aliasvault.app.passwordunlock.PasswordUnlockActivity.EXTRA_CUSTOM_TITLE, title)
        }
        if (!subtitle.isNullOrEmpty()) {
            intent.putExtra(net.aliasvault.app.passwordunlock.PasswordUnlockActivity.EXTRA_CUSTOM_SUBTITLE, subtitle)
        }
        activity.startActivityForResult(intent, PASSWORD_UNLOCK_REQUEST_CODE)
    }

    @ReactMethod
    override fun scanQRCode(prefixes: ReadableArray?, statusText: String?, promise: Promise) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val activity = currentActivity
                if (activity == null) {
                    promise.reject("NO_ACTIVITY", "No activity available", null)
                    return@launch
                }

                // Store promise for later resolution by MainActivity
                pendingActivityResultPromise = promise

                // Launch QR scanner activity with optional prefixes and status text
                val intent = Intent(activity, QRScannerActivity::class.java)
                if (prefixes != null && prefixes.size() > 0) {
                    val prefixList = ArrayList<String>()
                    for (i in 0 until prefixes.size()) {
                        val prefix = prefixes.getString(i)
                        if (prefix != null) {
                            prefixList.add(prefix)
                        }
                    }
                    intent.putStringArrayListExtra(QRScannerActivity.EXTRA_PREFIXES, prefixList)
                }
                if (statusText != null && statusText.isNotEmpty()) {
                    intent.putExtra(QRScannerActivity.EXTRA_STATUS_TEXT, statusText)
                }
                activity.startActivityForResult(intent, QR_SCANNER_REQUEST_CODE)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to launch QR scanner", e)
                promise.reject("SCANNER_ERROR", "Failed to launch QR scanner: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    override fun authenticateUser(title: String?, subtitle: String?, promise: Promise) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                // Get enabled authentication methods
                val authMethods = vaultStore.getAuthMethods()
                val isBiometricEnabled = authMethods.contains("faceid")
                val pinEnabled = vaultStore.isPinEnabled()

                // Check if password auth is available as fallback
                val hasPasswordFallback = authMethods.contains("password")

                // If PIN is enabled, prefer PIN (with biometric first if available)
                if (pinEnabled) {
                    // Try biometric authentication first if enabled
                    if (isBiometricEnabled) {
                        try {
                            val authenticated = vaultStore.issueBiometricAuthentication(title)
                            if (authenticated) {
                                promise.resolve(true)
                                return@launch
                            }
                            // Biometric failed or cancelled - fall through to PIN fallback
                        } catch (e: Exception) {
                            Log.d(TAG, "Biometric authentication failed or cancelled, trying PIN fallback", e)
                            // Fall through to PIN fallback
                        }
                    }

                    // Show PIN unlock (either as primary or fallback)
                    try {
                        // Store promise for later resolution by MainActivity
                        pendingActivityResultPromise = promise

                        // Store auth context in case PIN is cancelled and we need to fall back to password
                        if (hasPasswordFallback) {
                            pendingAuthContext = Pair(title, subtitle)
                        }

                        // Launch PIN unlock activity
                        val activity = currentActivity
                        if (activity == null) {
                            promise.reject("NO_ACTIVITY", "No activity available", null)
                            pendingAuthContext = null
                            return@launch
                        }

                        val intent = Intent(activity, net.aliasvault.app.pinunlock.PinUnlockActivity::class.java)
                        // Add custom title/subtitle if provided
                        if (!title.isNullOrEmpty()) {
                            intent.putExtra(net.aliasvault.app.pinunlock.PinUnlockActivity.EXTRA_CUSTOM_TITLE, title)
                        }
                        if (!subtitle.isNullOrEmpty()) {
                            intent.putExtra(net.aliasvault.app.pinunlock.PinUnlockActivity.EXTRA_CUSTOM_SUBTITLE, subtitle)
                        }
                        activity.startActivityForResult(intent, PIN_UNLOCK_REQUEST_CODE)
                        return@launch
                    } catch (e: Exception) {
                        Log.e(TAG, "PIN authentication failed", e)
                        promise.reject("AUTH_ERROR", "PIN authentication failed: ${e.message}", e)
                        pendingAuthContext = null
                        return@launch
                    }
                }

                // No PIN enabled - check for biometric + password
                if (isBiometricEnabled) {
                    try {
                        val authenticated = vaultStore.issueBiometricAuthentication(title)
                        if (authenticated) {
                            promise.resolve(true)
                            return@launch
                        }
                        // Biometric failed or cancelled - fall through to password fallback if available
                    } catch (e: Exception) {
                        Log.d(TAG, "Biometric authentication failed or cancelled, trying password fallback", e)
                        // Fall through to password fallback
                    }
                }

                // Show password unlock (either as primary or fallback from biometric)
                try {
                    // Store promise for later resolution by MainActivity
                    // Use pendingActivityResultPromise to match PIN unlock behavior (returns boolean)
                    pendingActivityResultPromise = promise

                    // Launch password unlock activity
                    val activity = currentActivity
                    if (activity == null) {
                        promise.reject("NO_ACTIVITY", "No activity available", null)
                        return@launch
                    }

                    val intent = Intent(activity, net.aliasvault.app.passwordunlock.PasswordUnlockActivity::class.java)
                    // Add custom title/subtitle if provided
                    if (!title.isNullOrEmpty()) {
                        intent.putExtra(net.aliasvault.app.passwordunlock.PasswordUnlockActivity.EXTRA_CUSTOM_TITLE, title)
                    }
                    if (!subtitle.isNullOrEmpty()) {
                        intent.putExtra(net.aliasvault.app.passwordunlock.PasswordUnlockActivity.EXTRA_CUSTOM_SUBTITLE, subtitle)
                    }
                    activity.startActivityForResult(intent, PASSWORD_UNLOCK_REQUEST_CODE)
                } catch (e: Exception) {
                    Log.e(TAG, "Password authentication failed", e)
                    promise.reject("AUTH_ERROR", "Password authentication failed: ${e.message}", e)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Authentication failed", e)
                promise.reject("AUTH_ERROR", "Authentication failed: ${e.message}", e)
            }
        }
    }

    // MARK: - Sync State Management

    /**
     * Get the sync state (isDirty, mutationSequence, serverRevision, isSyncing).
     * @param promise The promise to resolve.
     */
    @ReactMethod
    override fun getSyncState(promise: Promise) {
        try {
            val syncState = vaultStore.getSyncState()
            val result = Arguments.createMap()
            result.putBoolean("isDirty", syncState.isDirty)
            result.putInt("mutationSequence", syncState.mutationSequence)
            result.putInt("serverRevision", syncState.serverRevision)
            result.putBoolean("isSyncing", syncState.isSyncing)
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting sync state", e)
            promise.reject("ERR_GET_SYNC_STATE", "Failed to get sync state: ${e.message}", e)
        }
    }

    /**
     * Mark the vault as clean after successful sync.
     * Only clears dirty flag if no mutations happened during sync.
     *
     * @param mutationSeqAtStart The mutation sequence when sync started.
     * @param newServerRevision The new server revision after successful upload.
     * @param promise The promise to resolve with boolean indicating if dirty flag was cleared.
     */
    @ReactMethod
    override fun markVaultClean(mutationSeqAtStart: Double, newServerRevision: Double, promise: Promise) {
        try {
            val cleared = vaultStore.markVaultClean(
                mutationSeqAtStart = mutationSeqAtStart.toInt(),
                newServerRevision = newServerRevision.toInt(),
            )
            promise.resolve(cleared)
        } catch (e: Exception) {
            Log.e(TAG, "Error marking vault clean", e)
            promise.reject("ERR_MARK_VAULT_CLEAN", "Failed to mark vault clean: ${e.message}", e)
        }
    }

    /**
     * Clear encrypted vault and reset sync state to force a fresh download on next sync.
     * Deletes the corrupted vault and resets sync state so sync will download fresh.
     * Called when existing vault cannot be decrypted (e.g. password changed).
     * @param promise The promise to resolve when complete.
     */
    @ReactMethod
    override fun clearEncryptedVaultForFreshDownload(promise: Promise) {
        try {
            // Delete only the encrypted database file (not all storage)
            val encryptedDbFile = java.io.File(reactApplicationContext.filesDir, "encrypted_database.db")
            if (encryptedDbFile.exists()) {
                encryptedDbFile.delete()
                Log.d(TAG, "Deleted corrupted encrypted database for fresh download")
            }

            // Close in-memory database connection if open
            vaultStore.clearCache()

            // Reset sync state - set isDirty=false and revision=0 so sync sees server as newer
            vaultStore.metadata.setIsDirty(false)
            vaultStore.setVaultRevisionNumber(0)

            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing encrypted vault for fresh download", e)
            promise.reject("ERR_CLEAR_VAULT_FOR_DOWNLOAD", "Failed to clear vault for fresh download: ${e.message}", e)
        }
    }

    // MARK: - SRP Functions (via Rust Core UniFFI)

    /**
     * Generate a cryptographic salt for SRP.
     * @param promise The promise to resolve with the generated salt (hex string).
     */
    @ReactMethod
    override fun srpGenerateSalt(promise: Promise) {
        try {
            val salt = uniffi.aliasvault_core.srpGenerateSalt()
            promise.resolve(salt)
        } catch (e: Exception) {
            Log.e(TAG, "Error generating SRP salt", e)
            promise.reject("ERR_SRP_GENERATE_SALT", "Failed to generate SRP salt: ${e.message}", e)
        }
    }

    /**
     * Derive the SRP private key (x) from credentials.
     * @param salt The salt (hex string).
     * @param identity The identity (username).
     * @param passwordHash The password hash (hex string).
     * @param promise The promise to resolve with the private key (hex string).
     */
    @ReactMethod
    override fun srpDerivePrivateKey(salt: String, identity: String, passwordHash: String, promise: Promise) {
        try {
            val privateKey = uniffi.aliasvault_core.srpDerivePrivateKey(salt, identity, passwordHash)
            promise.resolve(privateKey)
        } catch (e: Exception) {
            Log.e(TAG, "Error deriving SRP private key", e)
            promise.reject("ERR_SRP_DERIVE_PRIVATE_KEY", "Failed to derive SRP private key: ${e.message}", e)
        }
    }

    /**
     * Derive the SRP verifier (v) from a private key.
     * @param privateKey The private key (hex string).
     * @param promise The promise to resolve with the verifier (hex string).
     */
    @ReactMethod
    override fun srpDeriveVerifier(privateKey: String, promise: Promise) {
        try {
            val verifier = uniffi.aliasvault_core.srpDeriveVerifier(privateKey)
            promise.resolve(verifier)
        } catch (e: Exception) {
            Log.e(TAG, "Error deriving SRP verifier", e)
            promise.reject("ERR_SRP_DERIVE_VERIFIER", "Failed to derive SRP verifier: ${e.message}", e)
        }
    }

    /**
     * Generate client ephemeral values (a, A) for SRP.
     * @param promise The promise to resolve with JSON containing public and secret values.
     */
    @ReactMethod
    override fun srpGenerateEphemeral(promise: Promise) {
        try {
            val ephemeral = uniffi.aliasvault_core.srpGenerateEphemeral()
            val result = Arguments.createMap()
            result.putString("public", ephemeral.public)
            result.putString("secret", ephemeral.secret)
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error generating SRP ephemeral", e)
            promise.reject("ERR_SRP_GENERATE_EPHEMERAL", "Failed to generate SRP ephemeral: ${e.message}", e)
        }
    }

    /**
     * Derive the SRP session key and proof.
     * @param clientSecret The client secret (a, hex string).
     * @param serverPublic The server public value (B, hex string).
     * @param salt The salt (hex string).
     * @param identity The identity (username).
     * @param privateKey The private key (x, hex string).
     * @param promise The promise to resolve with JSON containing key and proof.
     */
    @ReactMethod
    override fun srpDeriveSession(
        clientSecret: String,
        serverPublic: String,
        salt: String,
        identity: String,
        privateKey: String,
        promise: Promise,
    ) {
        try {
            val session = uniffi.aliasvault_core.srpDeriveSession(
                clientSecret,
                serverPublic,
                salt,
                identity,
                privateKey,
            )
            val result = Arguments.createMap()
            result.putString("key", session.key)
            result.putString("proof", session.proof)
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error deriving SRP session", e)
            promise.reject("ERR_SRP_DERIVE_SESSION", "Failed to derive SRP session: ${e.message}", e)
        }
    }
}
