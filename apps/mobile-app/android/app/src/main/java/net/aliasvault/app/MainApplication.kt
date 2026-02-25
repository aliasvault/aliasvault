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
import net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider
import net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider

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
     */
    private fun setupProcessLifecycleObserver() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                // Called when app goes to background (all activities stopped)
                try {
                    val vaultStore = VaultStore.getInstance(
                        AndroidKeystoreProvider(this@MainApplication) { null },
                        AndroidStorageProvider(this@MainApplication),
                    )
                    vaultStore.vaultAuth.onAppBackgrounded()
                } catch (e: Exception) {
                    android.util.Log.e("MainApplication", "Error handling app background", e)
                }
            }

            override fun onStart(owner: LifecycleOwner) {
                // Called when app comes to foreground (at least one activity visible)
                try {
                    val vaultStore = VaultStore.getInstance(
                        AndroidKeystoreProvider(this@MainApplication) { null },
                        AndroidStorageProvider(this@MainApplication),
                    )
                    vaultStore.vaultAuth.onAppForegrounded()
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
