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
        // This ensures our settings persist even if other code tries to override them
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
     * Handle activity results - forward to NativeVaultManager for PIN unlock.
     */
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        // Forward result to NativeVaultManager to handle PIN unlock
        val reactInstanceManager = reactNativeHost.reactInstanceManager
        val nativeModule = reactInstanceManager.currentReactContext
            ?.getNativeModule(net.aliasvault.app.nativevaultmanager.NativeVaultManager::class.java)

        nativeModule?.handleActivityResult(requestCode, resultCode, data)
    }
}
