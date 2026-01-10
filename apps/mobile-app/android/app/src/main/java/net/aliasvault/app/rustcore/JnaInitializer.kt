package net.aliasvault.app.rustcore

/**
 * Initializes JNA for Android before any UniFFI code runs.
 *
 * On Android, JNA needs to be configured to use Android's native library loading
 * instead of trying to unpack libraries from JAR resources (which doesn't work on Android).
 *
 * This object should be referenced before any UniFFI calls to ensure proper initialization.
 */
object JnaInitializer {
    @Volatile
    private var initialized = false

    init {
        ensureInitialized()
    }

    /**
     * Ensures JNA is properly initialized for Android.
     * This is idempotent and safe to call multiple times.
     */
    @Synchronized
    fun ensureInitialized() {
        if (initialized) return

        // Configure JNA to use Android's native library loading instead of unpacking from JAR
        System.setProperty("jna.nounpack", "true")
        System.setProperty("jna.noclasspath", "true")

        // Load the JNA dispatch library before any JNA code runs
        System.loadLibrary("jnidispatch")

        initialized = true
    }
}
