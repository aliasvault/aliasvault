package net.aliasvault.app
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.view.WindowInsetsController
import androidx.core.content.ContextCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper
import expo.modules.splashscreen.SplashScreenManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * The main activity of the app.
 */
class MainActivity : ReactActivity() {

    /**
     * Called when the activity is created.
     */
    override fun onCreate(savedInstanceState: Bundle?) {
        // Set the theme to AppTheme BEFORE onCreate to support
        // coloring the background, status bar, and navigation bar.
        // This is required for expo-splash-screen.
        // setTheme(R.style.AppTheme);
        // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
        SplashScreenManager.registerOnActivity(this)
        // @generated end expo-splashscreen

        super.onCreate(null)

        // Configure system bars based on dark mode
        configureSystemBars()
    }

    override fun onResume() {
        super.onResume()
        // Reapply system bar configuration when app resumes
        configureSystemBars()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Reapply system bar configuration when theme changes
        configureSystemBars()
    }

    /**
     * Configure system bars (status bar and navigation bar) colors and appearance based on current theme (light/dark mode).
     */
    private fun configureSystemBars() {
        val isDarkMode = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

        window.apply {
            if (isDarkMode) {
                // Dark mode: black background with light icons
                val bgColor = ContextCompat.getColor(context, R.color.av_background)
                statusBarColor = bgColor
                navigationBarColor = bgColor

                insetsController?.apply {
                    setSystemBarsAppearance(
                        0, // Light icons/text
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    )
                }
            } else {
                // Light mode: light gray background with dark icons
                statusBarColor = ContextCompat.getColor(context, R.color.av_background)
                navigationBarColor = ContextCompat.getColor(context, R.color.av_background)

                insetsController?.apply {
                    setSystemBarsAppearance(
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    )
                }
            }
        }
    }

    /**
     * Returns the name of the main component registered from JavaScript. This is used to schedule
     * rendering of the component.
     */
    override fun getMainComponentName(): String = "main"

    /**
     * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
     * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
     */
    override fun createReactActivityDelegate(): ReactActivityDelegate {
        return ReactActivityDelegateWrapper(
            this,
            BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
            object : DefaultReactActivityDelegate(
                this,
                mainComponentName,
                fabricEnabled,
            ) {},
        )
    }

    /**
     * Handle activity results.
     */
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode == net.aliasvault.app.nativevaultmanager.NativeVaultManager.PIN_UNLOCK_REQUEST_CODE) {
            handlePinUnlockResult(resultCode, data)
        } else if (requestCode == net.aliasvault.app.nativevaultmanager.NativeVaultManager.PIN_SETUP_REQUEST_CODE) {
            handlePinSetupResult(resultCode, data)
        } else if (requestCode == net.aliasvault.app.nativevaultmanager.NativeVaultManager.PASSWORD_UNLOCK_REQUEST_CODE) {
            handlePasswordUnlockResult(resultCode, data)
        } else if (requestCode == net.aliasvault.app.nativevaultmanager.NativeVaultManager.QR_SCANNER_REQUEST_CODE) {
            handleQRScannerResult(resultCode, data)
        }
    }

    /**
     * Handle PIN unlock result directly without going through React context.
     * This avoids race conditions with React context initialization.
     * @param resultCode The result code from the PIN unlock activity.
     * @param data The intent data containing the encryption key.
     */
    private fun handlePinUnlockResult(resultCode: Int, data: Intent?) {
        val promise = net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingActivityResultPromise
        net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingActivityResultPromise = null

        if (promise == null) {
            // Clear auth context even if promise is null
            net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingAuthContext = null
            return
        }

        val vaultStore = net.aliasvault.app.vaultstore.VaultStore.getInstance(
            net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider(this) { null },
            net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider(this),
        )

        when (resultCode) {
            net.aliasvault.app.pinunlock.PinUnlockActivity.RESULT_SUCCESS -> {
                // Clear auth context on success
                net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingAuthContext = null
                val encryptionKeyBase64 = data?.getStringExtra(
                    net.aliasvault.app.pinunlock.PinUnlockActivity.EXTRA_ENCRYPTION_KEY,
                )

                if (encryptionKeyBase64 == null) {
                    promise.reject("UNLOCK_ERROR", "Failed to get encryption key from PIN unlock", null)
                    return
                }

                // Run vault unlock on IO thread to avoid blocking the main thread
                // (unlockVault involves file I/O and database operations)
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        /*
                         * Use storeEncryptionKeyInMemory instead of storeEncryptionKey.
                         * storeEncryptionKey would trigger biometric prompt if biometrics is enabled
                         * since it tries to store the key in the biometric-protected keystore.
                         * For PIN unlock, we just want to set the key in memory.
                         */
                        vaultStore.storeEncryptionKeyInMemory(encryptionKeyBase64)
                        vaultStore.unlockVault()
                        promise.resolve(true)
                    } catch (e: Exception) {
                        promise.reject("UNLOCK_ERROR", "Failed to unlock vault: ${e.message}", e)
                    }
                }
            }
            net.aliasvault.app.pinunlock.PinUnlockActivity.RESULT_CANCELLED -> {
                // Check if password fallback is available (from authenticateUser flow)
                val authContext = net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingAuthContext
                if (authContext != null) {
                    // Password fallback is available - launch password unlock
                    net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingAuthContext = null
                    net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingActivityResultPromise = promise

                    val intent = Intent(this, net.aliasvault.app.passwordunlock.PasswordUnlockActivity::class.java)
                    if (!authContext.first.isNullOrEmpty()) {
                        intent.putExtra(net.aliasvault.app.passwordunlock.PasswordUnlockActivity.EXTRA_CUSTOM_TITLE, authContext.first)
                    }
                    if (!authContext.second.isNullOrEmpty()) {
                        intent.putExtra(net.aliasvault.app.passwordunlock.PasswordUnlockActivity.EXTRA_CUSTOM_SUBTITLE, authContext.second)
                    }
                    startActivityForResult(intent, net.aliasvault.app.nativevaultmanager.NativeVaultManager.PASSWORD_UNLOCK_REQUEST_CODE)
                } else {
                    // No fallback - reject promise
                    promise.reject("USER_CANCELLED", "User cancelled PIN unlock", null)
                }
            }
            net.aliasvault.app.pinunlock.PinUnlockActivity.RESULT_PIN_DISABLED -> {
                net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingAuthContext = null
                promise.reject("PIN_DISABLED", "PIN was disabled", null)
            }
            else -> {
                net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingAuthContext = null
                promise.reject("UNKNOWN_ERROR", "Unknown error in PIN unlock", null)
            }
        }
    }

    /**
     * Handle PIN setup result.
     * @param resultCode The result code from the PIN setup activity.
     * @param data The intent data
     */
    @Suppress("UNUSED_PARAMETER")
    private fun handlePinSetupResult(resultCode: Int, data: Intent?) {
        val promise = net.aliasvault.app.nativevaultmanager.NativeVaultManager.pinSetupPromise
        net.aliasvault.app.nativevaultmanager.NativeVaultManager.pinSetupPromise = null

        if (promise == null) {
            return
        }

        when (resultCode) {
            net.aliasvault.app.pinunlock.PinUnlockActivity.RESULT_SUCCESS -> {
                // PIN setup successful
                promise.resolve(null)
            }
            net.aliasvault.app.pinunlock.PinUnlockActivity.RESULT_CANCELLED -> {
                // User cancelled PIN setup
                promise.reject("USER_CANCELLED", "User cancelled PIN setup", null)
            }
            else -> {
                promise.reject("SETUP_ERROR", "PIN setup failed", null)
            }
        }
    }

    /**
     * Handle password unlock result.
     * @param resultCode The result code from the password unlock activity.
     * @param data The intent data containing the encryption key.
     */
    private fun handlePasswordUnlockResult(resultCode: Int, data: Intent?) {
        // Check both promise types - one for showPasswordUnlock() and one for authenticateUser()
        val passwordPromise = net.aliasvault.app.nativevaultmanager.NativeVaultManager.passwordUnlockPromise
        val authPromise = net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingActivityResultPromise

        net.aliasvault.app.nativevaultmanager.NativeVaultManager.passwordUnlockPromise = null
        net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingActivityResultPromise = null
        net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingAuthContext = null

        when (resultCode) {
            net.aliasvault.app.passwordunlock.PasswordUnlockActivity.RESULT_SUCCESS -> {
                val encryptionKeyBase64 = data?.getStringExtra(
                    net.aliasvault.app.passwordunlock.PasswordUnlockActivity.EXTRA_ENCRYPTION_KEY,
                )

                if (encryptionKeyBase64 == null) {
                    passwordPromise?.resolve(null)
                    authPromise?.resolve(false)
                    return
                }

                val vaultStore = net.aliasvault.app.vaultstore.VaultStore.getInstance(
                    net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider(this) { null },
                    net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider(this),
                )

                // Run on IO thread to avoid blocking main thread
                kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                    try {
                        // Store encryption key in memory only
                        vaultStore.storeEncryptionKeyInMemory(encryptionKeyBase64)

                        // Unlock the vault with the key now in memory
                        vaultStore.unlockVault()

                        // For both showPasswordUnlock() and authenticateUser(), resolve with success (true)
                        passwordPromise?.resolve(true)
                        authPromise?.resolve(true)
                    } catch (e: Exception) {
                        android.util.Log.e("MainActivity", "Failed to unlock vault with password", e)
                        passwordPromise?.resolve(null)
                        authPromise?.resolve(false)
                    }
                }
            }
            net.aliasvault.app.passwordunlock.PasswordUnlockActivity.RESULT_CANCELLED -> {
                // For showPasswordUnlock(), resolve with null
                passwordPromise?.resolve(null)
                // For authenticateUser(), resolve with false
                authPromise?.resolve(false)
            }
            else -> {
                // For showPasswordUnlock(), resolve with null
                passwordPromise?.resolve(null)
                // For authenticateUser(), resolve with false
                authPromise?.resolve(false)
            }
        }
    }

    /**
     * Handle QR scanner result.
     * @param resultCode The result code from the QR scanner activity.
     * @param data The intent data containing the scanned QR code.
     */
    private fun handleQRScannerResult(resultCode: Int, data: Intent?) {
        val promise = net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingActivityResultPromise
        net.aliasvault.app.nativevaultmanager.NativeVaultManager.pendingActivityResultPromise = null

        if (promise == null) {
            return
        }

        when (resultCode) {
            RESULT_OK -> {
                val scannedData = data?.getStringExtra("SCAN_RESULT")
                promise.resolve(scannedData)
            }
            RESULT_CANCELED -> {
                promise.resolve(null)
            }
            else -> {
                promise.resolve(null)
            }
        }
    }
}
