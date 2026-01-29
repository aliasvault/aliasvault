package net.aliasvault.app

/**
 * Configuration for E2E UI tests.
 */
object TestConfiguration {
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
     */
    const val DEFAULT_TIMEOUT_MS = 10_000L

    /**
     * Extended timeout for operations that may take longer (like login with network).
     */
    const val EXTENDED_TIMEOUT_MS = 30_000L

    /**
     * Short timeout for quick checks (milliseconds).
     */
    const val SHORT_TIMEOUT_MS = 2_000L

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
