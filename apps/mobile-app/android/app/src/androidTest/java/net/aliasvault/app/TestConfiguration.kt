package net.aliasvault.app

import android.os.Bundle
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry

/**
 * Configuration for E2E UI tests.
 */
object TestConfiguration {
    private const val TAG = "TestConfiguration"

    /**
     * Get instrumentation arguments passed via gradle.
     */
    private val instrumentationArgs: Bundle by lazy {
        try {
            InstrumentationRegistry.getArguments()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to get instrumentation arguments: ${e.message}")
            Bundle()
        }
    }

    /**
     * Detect if running in CI environment (headless emulator).
     * CI is detected by checking:
     * 1. Instrumentation argument CI=true (passed from gradle)
     * 2. GITHUB_ACTIONS env var
     * 3. CI env var
     */
    val isCI: Boolean by lazy {
        // Check instrumentation argument first (most reliable)
        val ciArg = instrumentationArgs.getString("CI") == "true"

        // Fallback to environment variables
        val githubActions = System.getenv("GITHUB_ACTIONS") == "true" ||
            System.getProperty("GITHUB_ACTIONS") == "true"
        val ciEnv = System.getenv("CI") == "true" ||
            System.getProperty("CI") == "true"

        val result = ciArg || githubActions || ciEnv
        Log.i(
            TAG,
            "CI mode detected: $result (ciArg=$ciArg, GITHUB_ACTIONS=$githubActions, CI=$ciEnv)",
        )
        result
    }

    /**
     * Multiplier for timeouts in CI (headless emulator is slower).
     */
    private val timeoutMultiplier: Long
        get() = if (isCI) 3L else 1L

    /**
     * API URL for testing (defaults to local development server).
     * Can be overridden by setting the API_URL instrumentation argument.
     */
    val apiUrl: String
        get() = System.getProperty("API_URL") ?: "http://10.0.2.2:5092"

    /**
     * Generate a unique name for test items.
     */
    fun generateUniqueName(prefix: String = "E2E Test"): String {
        val timestamp = System.currentTimeMillis()
        return "$prefix $timestamp"
    }

    /**
     * Default timeout for element waiting (milliseconds).
     * Increased in CI mode where headless emulator is slower.
     */
    val DEFAULT_TIMEOUT_MS: Long
        get() = 10_000L * timeoutMultiplier

    /**
     * Extended timeout for operations that may take longer (like login with network).
     * Increased in CI mode where headless emulator is slower.
     */
    val EXTENDED_TIMEOUT_MS: Long
        get() = 30_000L * timeoutMultiplier

    /**
     * Short timeout for quick checks (milliseconds).
     * Increased in CI mode where headless emulator is slower.
     */
    val SHORT_TIMEOUT_MS: Long
        get() = 2_000L * timeoutMultiplier

    /**
     * Default Argon2Id encryption settings matching server defaults.
     */
    object EncryptionDefaults {
        const val TYPE = "Argon2Id"
        const val ITERATIONS = 2
        const val MEMORY_SIZE = 19456
        const val PARALLELISM = 1

        val settingsJson: String
            get() = """{"DegreeOfParallelism":$PARALLELISM,"MemorySize":$MEMORY_SIZE,"Iterations":$ITERATIONS}"""
    }
}
