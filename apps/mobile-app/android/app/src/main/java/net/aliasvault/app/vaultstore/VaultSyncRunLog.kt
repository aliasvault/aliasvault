package net.aliasvault.app.vaultstore

import android.util.Log
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * The log of one sync engine run for local performance analysis.
 */
class VaultSyncRunLog(private val operation: String) {
    companion object {
        const val TAG = "VaultSync"
        private const val ENGINE_TAG = "VaultSyncEngine"
        private const val SLOW_COMMAND_MS = 50L
        private const val KEPT_SYNCS = 5
        private const val MAX_ENTRIES = 20
        private val AUXILIARY_OPERATIONS = setOf("statusCheck", "migrationStatus", "resolveVaultKey")
        private const val NANOS_PER_MS = 1_000_000L
        private const val BYTES_PER_KB = 1024.0
        private val persistLock = Any()

        /**
         * Milliseconds since a [System.nanoTime] reading.
         */
        fun elapsedMsSince(startNanos: Long): Long = (System.nanoTime() - startNanos) / NANOS_PER_MS

        /**
         * The persisted run logs as JSON text, newest first.
         */
        fun persisted(storageProvider: StorageProvider): String = storageProvider.getSyncLogs() ?: "[]"

        /**
         * The size of a text payload (JSON or base64) for the logs, by character count.
         */
        private fun formatSize(value: Any?): String {
            val size = (value as? String)?.length ?: 0
            return when {
                size < BYTES_PER_KB -> "$size B"
                size < BYTES_PER_KB * BYTES_PER_KB -> String.format(Locale.US, "%.1f KB", size / BYTES_PER_KB)
                else -> String.format(Locale.US, "%.1f MB", size / (BYTES_PER_KB * BYTES_PER_KB))
            }
        }
    }

    private val startedAtMillis = System.currentTimeMillis()
    private val startedAtNanos = System.nanoTime()
    private val lines = mutableListOf<String>()
    private val commandNanos = mutableMapOf<String, Long>()
    private val commandCounts = mutableMapOf<String, Int>()
    private var engineNanos = 0L
    private var jsonNanos = 0L
    private var lastLineMs = 0L

    /**
     * Log a driver line and keep it.
     */
    fun note(message: String) {
        Log.d(TAG, keep(message))
    }

    /**
     * Log a line the Rust engine emitted and keep it; `phase` and `warn` lines keep their level in the text.
     */
    fun engineLine(level: String, message: String) {
        Log.d(ENGINE_TAG, keep(if (level == "log") message else "[$level] $message"))
    }

    /**
     * Keep a line, prefixed with its offset from the run start and the time since the previous line. The engine logs
     * before and after each heavy step (decrypt, canonicalize, merge, materialize, compress), so that gap is the step's time.
     */
    private fun keep(text: String): String {
        val offsetMs = elapsedMsSince(startedAtNanos)
        val line = "+${offsetMs}ms (Δ${offsetMs - lastLineMs}ms) $text"
        lastLineMs = offsetMs
        lines.add(line)
        return line
    }

    /**
     * Run [block], counting its time as time inside the Rust engine.
     */
    fun <T> engine(block: () -> T): T {
        val startNanos = System.nanoTime()
        try {
            return block()
        } finally {
            engineNanos += System.nanoTime() - startNanos
        }
    }

    /**
     * Run [block], counting its time as native JSON parsing and serialization.
     */
    fun <T> json(block: () -> T): T {
        val startNanos = System.nanoTime()
        try {
            return block()
        } finally {
            jsonNanos += System.nanoTime() - startNanos
        }
    }

    /**
     * Count one handled command, and log it on its own when it is a transfer or slow.
     */
    fun recordCommand(kind: String, command: JSONObject, response: JSONObject, nanos: Long) {
        commandNanos[kind] = (commandNanos[kind] ?: 0L) + nanos
        commandCounts[kind] = (commandCounts[kind] ?: 0) + 1
        describe(kind, command, response, nanos / NANOS_PER_MS)?.let { note(it) }
    }

    /**
     * Log where the run's time went and persist the run.
     */
    fun finish(success: Boolean?, storageProvider: StorageProvider) {
        val totalMs = elapsedMsSince(startedAtNanos)
        val hostMs = commandNanos.values.sum() / NANOS_PER_MS
        val parts = commandNanos.entries.sortedByDescending { it.value }
            .joinToString(", ") { "${it.key} ${commandCounts[it.key]}x ${it.value / NANOS_PER_MS}ms" }
        note("$operation took ${totalMs}ms: engine ${engineNanos / NANOS_PER_MS}ms, host ${hostMs}ms ($parts), json ${jsonNanos / NANOS_PER_MS}ms")

        val entry = JSONObject()
            .put("operation", operation)
            .put("startedAt", startedAtMillis)
            .put("durationMs", totalMs)
            .put("success", success ?: JSONObject.NULL)
            .put("lines", JSONArray(lines))
        persist(entry, storageProvider)
    }

    /**
     * One line for a command relevant for performance analysis, or null for unrelated calls.
     */
    private fun describe(kind: String, command: JSONObject, response: JSONObject, ms: Long): String? {
        val took = "$kind took ${ms}ms"
        if (response.has("error")) {
            return "$took: failed (${response.optString("error")})"
        }
        val slow = ms >= SLOW_COMMAND_MS
        val db = command.optString("db")
        return when (kind) {
            "http" -> {
                val request = "${command.optString("method", "GET")} ${command.optString("path")}"
                val status = response.optInt("status")
                if (status == 0) {
                    "$took: $request failed (${response.optString("transportError", "no response")})"
                } else {
                    "$took: $request $status, sent ${formatSize(command.opt("body"))}, received ${formatSize(response.opt("body"))}"
                }
            }
            "vaultStore" -> "$took: ${formatSize(command.opt("encryptedBlob"))}"
            "vaultLoad" -> "$took: ${formatSize(response.opt("encryptedBlob"))}"
            "dbOpen" -> "$took: ${if (command.isNull("bytes")) "fresh schema" else formatSize(command.opt("bytes"))}"
            "dbExport" -> "$took: $db ${formatSize(response.opt("bytes"))}"
            "dbExec" -> if (slow) "$took: ${command.optJSONArray("statements")?.length() ?: 0} statement(s) on $db" else null
            "dbQuery" -> if (slow) "$took: ${response.optJSONArray("rows")?.length() ?: 0} row(s) from $db" else null
            else -> if (slow) took else null
        }
    }

    /**
     * Prepend the run to the persisted log, keeping the last [KEPT_SYNCS] syncs.
     */
    @Suppress("TooGenericExceptionCaught")
    private fun persist(entry: JSONObject, storageProvider: StorageProvider) {
        try {
            synchronized(persistLock) {
                val existing = storageProvider.getSyncLogs()?.let { JSONArray(it) } ?: JSONArray()
                val kept = JSONArray().put(entry)
                var syncs = if (operation in AUXILIARY_OPERATIONS) 0 else 1
                for (index in 0 until existing.length()) {
                    if (syncs >= KEPT_SYNCS || kept.length() >= MAX_ENTRIES) {
                        break
                    }
                    val previous = existing.getJSONObject(index)
                    kept.put(previous)
                    if (previous.optString("operation") !in AUXILIARY_OPERATIONS) {
                        syncs++
                    }
                }
                storageProvider.setSyncLogs(kept.toString())
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to persist the sync log", e)
        }
    }
}
