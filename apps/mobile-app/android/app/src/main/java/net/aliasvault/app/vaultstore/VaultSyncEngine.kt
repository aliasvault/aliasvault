package net.aliasvault.app.vaultstore

import android.database.Cursor
import android.util.Base64
import android.util.Log
import io.requery.android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.aliasvault.app.rustcore.JnaInitializer
import net.aliasvault.app.utils.AppInfo
import net.aliasvault.app.vaultstore.models.VaultSql
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import net.aliasvault.app.webapi.WebApiService
import org.json.JSONArray
import org.json.JSONObject
import uniffi.aliasvault_core.VaultSyncSession
import java.io.File
import java.net.SocketTimeoutException

/**
 * Drives one operation of the Rust vault sync engine against this vault store.
 *
 * The engine owns the sync algorithm and emits commands (HTTP, state, SQLite, vault storage); this class carries
 * each one out and feeds the response back until the engine reports `done`. See the `vault_sync` module in
 * `core/rust` for the command and response contract.
 */
class VaultSyncEngine(
    private val vaultStore: VaultStore,
    private val storageProvider: StorageProvider,
    private val webApiService: WebApiService,
) {
    companion object {
        private const val TAG = "VaultSyncEngine"

        /** Engine state keys mirrored into the native account-key chain, so the native password unlock can unwrap it. */
        private const val ENCRYPTED_ACCOUNT_KEY_STATE_KEY = "encryptedAccountKey"
        private const val ENCRYPTED_VEK_STATE_KEY = "encryptedVek"

        /** Engine state key that lives in the native store instead (the login writes it there), routed on read and write. */
        private const val DERIVATION_PARAMS_STATE_KEY = "encryptionKeyDerivationParams"
    }

    private var staging: SQLiteDatabase? = null
    private var stagingFile: File? = null
    private var runLog = VaultSyncRunLog("")

    /**
     * Run one engine operation (`fullSync`, `statusCheck`, `migrationStatus`, `migrateManifest`, `resolveVaultKey`) and
     * return its result. [encryptionKey] overrides the store's key for the one operation that runs before it is known.
     */
    suspend fun run(operation: String, forcePull: Boolean = false, encryptionKey: String? = null): JSONObject {
        JnaInitializer.ensureInitialized()
        val log = VaultSyncRunLog(operation)
        runLog = log
        var success: Boolean? = null
        val session = VaultSyncSession(buildRequest(operation, forcePull, encryptionKey))
        try {
            while (true) {
                val commandJson = log.engine { session.nextCommand() }
                val command = log.json { JSONObject(commandJson) }
                val kind = command.optString("kind")
                if (kind == "done") {
                    val result = command.optJSONObject("result") ?: JSONObject()
                    success = if (result.has("success")) result.optBoolean("success") else null
                    return result
                }
                val startNanos = System.nanoTime()
                val response = handle(kind, command)
                log.recordCommand(kind, command, response, System.nanoTime() - startNanos)
                val responseJson = log.json { response.toString() }
                log.engine { session.resume(responseJson) }
            }
        } finally {
            closeStaging()
            session.destroy()
            log.finish(success, storageProvider)
        }
    }

    // region Request

    private fun buildRequest(operation: String, forcePull: Boolean, encryptionKey: String?): String {
        val metadata = vaultStore.metadata.getVaultMetadataObject()
        val syncState = vaultStore.getSyncState()
        val request = JSONObject().apply {
            put("operation", operation)
            put("username", vaultStore.getUsername() ?: "")
            put("isDirty", syncState.isDirty)
            put("mutationSequence", syncState.mutationSequence)
            put("dirtyScopes", JSONArray(if (syncState.isDirty) listOf("Main") else emptyList<String>()))
            put("privateEmailDomains", JSONArray(metadata?.privateEmailDomains ?: emptyList<String>()))
            put("forcePull", forcePull)
            put("minServerVersion", AppInfo.MIN_SERVER_VERSION)
            put("isOfflineMode", vaultStore.getOfflineMode())
            put("unnamedSharedVaultName", "Shared vault")
        }
        (encryptionKey ?: vaultStore.getEncryptionKeyBase64())?.let { request.put("encryptionKey", it) }
        (state("accountPublicKey") as? String)?.let { request.put("accountPublicKey", it) }
        vaultStore.accountPrivateKey?.let { request.put("accountPrivateKey", it) }
        return request.toString()
    }

    // endregion

    // region Commands

    @Suppress("TooGenericExceptionCaught")
    private suspend fun handle(kind: String, command: JSONObject): JSONObject {
        return try {
            when (kind) {
                "http" -> http(command)
                "stateGet" -> JSONObject().put("value", state(command.optString("key")) ?: JSONObject.NULL)
                "stateSet" -> {
                    setState(command.optString("key"), command.opt("value"))
                    JSONObject()
                }
                "stateRemove" -> {
                    setState(command.optString("key"), null)
                    JSONObject()
                }
                "dbOpen" -> {
                    openStaging(command.optString("bytes", null).takeIf { command.has("bytes") && !command.isNull("bytes") })
                    JSONObject()
                }
                "dbQuery" -> {
                    val rows = query(database(command.optString("db")), command.optString("sql"), command.optJSONArray("params") ?: JSONArray())
                    JSONObject().put("rows", rows)
                }
                "dbExec" -> {
                    exec(database(command.optString("db")), command.optJSONArray("statements") ?: JSONArray())
                    JSONObject()
                }
                "dbExport" -> JSONObject().put("bytes", Base64.encodeToString(export(database(command.optString("db"))), Base64.NO_WRAP))
                "vaultStore" -> storeVault(command)
                "vaultLoad" -> JSONObject().put("encryptedBlob", if (vaultStore.hasEncryptedDatabase()) vaultStore.getEncryptedDatabase() else JSONObject.NULL)
                "markClean" -> {
                    val cleared = vaultStore.markVaultClean(command.optInt("mutationSeqAtStart"), vaultStore.metadata.getVaultRevisionNumber())
                    JSONObject().put("cleared", cleared)
                }
                "log" -> {
                    runLog.engineLine(command.optString("level", "log"), command.optString("message"))
                    JSONObject()
                }
                else -> JSONObject().put("error", "Unknown engine command $kind")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Engine command $kind failed", e)
            JSONObject().put("error", e.message ?: e.toString())
        }
    }

    @Suppress("TooGenericExceptionCaught")
    private suspend fun http(command: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val body = if (command.has("body") && !command.isNull("body")) command.getString("body") else null
        val headers = mutableMapOf("Accept" to "application/json")
        if (body != null) {
            headers["Content-Type"] = "application/json"
        }
        try {
            val response = webApiService.executeRequest(
                method = command.optString("method", "GET"),
                endpoint = command.optString("path"),
                body = body,
                headers = headers,
                requiresAuth = command.optBoolean("auth", true),
            )
            JSONObject().put("status", response.statusCode).put("body", response.body)
        } catch (e: SocketTimeoutException) {
            JSONObject().put("status", 0).put("transportError", e.toString()).put("timedOut", true)
        } catch (e: Exception) {
            JSONObject().put("status", 0).put("transportError", e.toString()).put("timedOut", false)
        }
    }

    // endregion

    // region State

    /** Engine state is stored as the JSON text of `{"v": value}`, so any JSON value round-trips. */
    private fun state(key: String): Any? {
        if (key == DERIVATION_PARAMS_STATE_KEY) {
            return storageProvider.getKeyDerivationParams().takeIf { it.isNotBlank() }?.let { JSONObject(it) }
        }
        val json = storageProvider.getSyncEngineState(key) ?: return null
        return JSONObject(json).opt("v")?.takeIf { it != JSONObject.NULL }
    }

    private fun setState(key: String, value: Any?) {
        if (key == DERIVATION_PARAMS_STATE_KEY) {
            (value as? JSONObject)?.let { storageProvider.setKeyDerivationParams(it.toString()) }
            return
        }
        if (value == null || value == JSONObject.NULL) {
            storageProvider.setSyncEngineState(key, null)
        } else {
            storageProvider.setSyncEngineState(key, JSONObject().put("v", value).toString())
        }
        if (key == ENCRYPTED_ACCOUNT_KEY_STATE_KEY || key == ENCRYPTED_VEK_STATE_KEY) {
            mirrorAccountKeyChain()
        }
    }

    /**
     * Keep the native account-key chain in step with the engine's cached key blobs.
     */
    private fun mirrorAccountKeyChain() {
        val encryptedAccountKey = state(ENCRYPTED_ACCOUNT_KEY_STATE_KEY) as? String
        val encryptedVek = state(ENCRYPTED_VEK_STATE_KEY) as? String
        if (encryptedAccountKey == null || encryptedVek == null) {
            vaultStore.storeAccountKeyChain(null)
            return
        }
        val chain = JSONObject().put("encryptedAccountKey", encryptedAccountKey).put("encryptedVek", encryptedVek)
        vaultStore.storeAccountKeyChain(chain.toString())
    }

    // endregion

    // region Vault storage

    private fun storeVault(command: JSONObject): JSONObject {
        val encryptedBlob = command.getString("encryptedBlob")
        if (command.has("encryptionKey") && !command.isNull("encryptionKey")) {
            // The blob is encrypted under a key this session did not start with (KEK to VEK migration): adopt it first.
            vaultStore.adoptEncryptionKey(command.getString("encryptionKey"))
        }
        val result = vaultStore.storeEncryptedVaultWithSyncState(
            encryptedVault = encryptedBlob,
            markDirty = command.optBoolean("markDirty", false),
            serverRevision = optionalInt(command, "revision"),
            expectedMutationSeq = optionalInt(command, "expectedMutationSeq"),
        )
        if (result.success && vaultStore.isVaultUnlocked()) {
            // The contract: after a store, the live database is the vault just stored.
            val reloadStartNanos = System.nanoTime()
            vaultStore.unlockVault()
            runLog.note("Live vault reloaded (decrypt and open) in ${VaultSyncRunLog.elapsedMsSince(reloadStartNanos)}ms")
        }
        return JSONObject().put("success", result.success).put("mutationSequence", result.mutationSequence)
    }

    private fun optionalInt(command: JSONObject, key: String): Int? {
        return if (command.has(key) && !command.isNull(key)) command.getInt(key) else null
    }

    // endregion

    // region SQLite

    private fun database(name: String): SQLiteDatabase = when (name) {
        "local" -> vaultStore.database.dbConnection ?: error("The vault is not unlocked")
        "staging" -> staging ?: error("The staging database is not open")
        else -> error("Unknown database $name")
    }

    /**
     * Open the staging database: from SQLite bytes (as a temporary file), or fresh in memory with the current schema.
     */
    private fun openStaging(bytesBase64: String?) {
        closeStaging()
        if (bytesBase64 != null) {
            val file = File(storageProvider.getRandomTempFilePath())
            file.writeBytes(Base64.decode(bytesBase64, Base64.NO_WRAP))
            stagingFile = file
            staging = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READWRITE).also {
                it.rawQuery("PRAGMA foreign_keys = OFF", null)?.close()
            }
        } else {
            staging = SQLiteDatabase.create(null).also {
                executeScript(it, VaultSql.completeSchema)
                // The schema script ends by turning foreign keys on; the engine inserts rows in codec order, not FK order.
                it.rawQuery("PRAGMA foreign_keys = OFF", null)?.close()
            }
        }
    }

    private fun closeStaging() {
        staging?.close()
        staging = null
        stagingFile?.delete()
        stagingFile = null
    }

    /**
     * Run a multi-statement SQL script. Statements split on semicolons, except inside a trigger body.
     */
    private fun executeScript(db: SQLiteDatabase, script: String) {
        for (statement in SqlScript.splitStatements(script)) {
            val upper = statement.uppercase()
            when {
                upper.startsWith("PRAGMA") -> db.rawQuery(statement, null)?.close()
                upper.startsWith("BEGIN") || upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK") -> db.execSQL(statement)
                else -> db.compileStatement(statement).use { it.execute() }
            }
        }
    }

    private fun export(db: SQLiteDatabase): ByteArray {
        val file = File(storageProvider.getRandomTempFilePath())
        file.delete()
        try {
            val quoted = file.absolutePath.replace("'", "''")
            db.compileStatement("VACUUM INTO '$quoted'").use { it.execute() }
            return file.readBytes()
        } finally {
            file.delete()
        }
    }

    private fun bindValue(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is Boolean -> if (value) 1L else 0L
        is Int -> value.toLong()
        is Long -> value
        is Double -> value
        is Float -> value.toDouble()
        is String -> value
        is JSONObject -> if (value.has("__b64")) Base64.decode(value.getString("__b64"), Base64.NO_WRAP) else value.toString()
        else -> value.toString()
    }

    private fun query(db: SQLiteDatabase, sql: String, params: JSONArray): JSONArray {
        val args = Array<Any?>(params.length()) { bindValue(params.opt(it)) }
        val rows = JSONArray()
        db.rawQuery(sql, args).use { cursor ->
            while (cursor.moveToNext()) {
                val row = JSONObject()
                for (index in 0 until cursor.columnCount) {
                    val name = cursor.getColumnName(index)
                    when (cursor.getType(index)) {
                        Cursor.FIELD_TYPE_INTEGER -> row.put(name, cursor.getLong(index))
                        Cursor.FIELD_TYPE_FLOAT -> row.put(name, cursor.getDouble(index))
                        Cursor.FIELD_TYPE_STRING -> row.put(name, cursor.getString(index))
                        Cursor.FIELD_TYPE_BLOB -> row.put(name, JSONObject().put("__b64", Base64.encodeToString(cursor.getBlob(index), Base64.NO_WRAP)))
                        else -> row.put(name, JSONObject.NULL)
                    }
                }
                rows.put(row)
            }
        }
        return rows
    }

    private fun exec(db: SQLiteDatabase, statements: JSONArray) {
        db.beginTransaction()
        try {
            for (index in 0 until statements.length()) {
                val entry = statements.getJSONObject(index)
                db.compileStatement(entry.getString("sql")).use { statement ->
                    bindParams(statement, entry.optJSONArray("params") ?: JSONArray())
                    statement.execute()
                }
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private fun bindParams(statement: io.requery.android.database.sqlite.SQLiteStatement, params: JSONArray) {
        for (position in 0 until params.length()) {
            when (val value = bindValue(params.opt(position))) {
                null -> statement.bindNull(position + 1)
                is Long -> statement.bindLong(position + 1, value)
                is Double -> statement.bindDouble(position + 1, value)
                is ByteArray -> statement.bindBlob(position + 1, value)
                else -> statement.bindString(position + 1, value.toString())
            }
        }
    }

    // endregion
}
