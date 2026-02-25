package net.aliasvault.app

import android.app.Application
import android.content.res.Configuration
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper
import net.aliasvault.app.nativevaultmanager.NativeVaultManagerPackage
import net.aliasvault.app.vaultstore.VaultStore

/**
 * The main application class.
 */
class MainApplication : Application(), ReactApplication {

    /**
     * The react native host.
     */
    override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
        this,
        object : DefaultReactNativeHost(this) {
            override fun getPackages(): List<ReactPackage> {
                val packages = PackageList(this).packages
                // Packages that cannot be autolinked yet can be added manually here, for example:
                // packages.add(new MyReactNativePackage());
                packages.add(NativeVaultManagerPackage())
                return packages
            }

            override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
        },
    )

    override val reactHost: ReactHost
        get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()
        SoLoader.init(this, OpenSourceMergedSoMapping)
        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
            // If you opted-in for the New Architecture, we load the native entry point for this app.
            load()
        }
        ApplicationLifecycleDispatcher.onApplicationCreate(this)

        // Setup process lifecycle observer for auto-lock functionality
        setupProcessLifecycleObserver()
    }

    /**
     * Setup process-level lifecycle observer to track when the app backgrounds/foregrounds.
     *
     * If the instance doesn't exist yet (e.g., app backgrounded before React Native initialized),
     * we skip the lifecycle callbacks. This is safe because there's no vault to lock yet.
     */
    private fun setupProcessLifecycleObserver() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                // Called when app goes to background (all activities stopped)
                try {
                    // Only notify existing instance
                    val vaultStore = VaultStore.getExistingInstance()
                    if (vaultStore != null) {
                        vaultStore.vaultAuth.onAppBackgrounded()
                    } else {
                        android.util.Log.d("MainApplication", "VaultStore not initialized yet, skipping background callback")
                    }
                } catch (e: Exception) {
                    android.util.Log.e("MainApplication", "Error handling app background", e)
                }
            }

            override fun onStart(owner: LifecycleOwner) {
                // Called when app comes to foreground (at least one activity visible)
                try {
                    // Only notify existing instance
                    val vaultStore = VaultStore.getExistingInstance()
                    if (vaultStore != null) {
                        vaultStore.vaultAuth.onAppForegrounded()
                    } else {
                        android.util.Log.d("MainApplication", "VaultStore not initialized yet, skipping foreground callback")
                    }
                } catch (e: Exception) {
                    android.util.Log.e("MainApplication", "Error handling app foreground", e)
                }
            }
        })
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
    }
}
