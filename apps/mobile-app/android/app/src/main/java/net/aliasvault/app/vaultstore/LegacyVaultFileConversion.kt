package net.aliasvault.app.vaultstore

import android.util.Log
import java.io.File
import java.util.Base64

/**
 * Legacy conversion of the stored vault file from base64 text to raw bytes.
 *
 * 0.31.1 and older stored the encrypted vault as base64 text in [LEGACY_BASE64_DATABASE_FILE]; newer builds store the raw
 * bytes. The first read after an update converts the old file once.
 *
 * Other platform implementations: VaultStore+LegacyVaultFileConversion.swift (iOS).
 *
 * TODO: remove once all clients have upgraded past 0.31.1.
 * An install that still holds only the old file then has no vault and logs in again.
 */
internal object LegacyVaultFileConversion {
    private const val TAG = "LegacyVaultFileConversion"

    /** The vault file as base64 text, as 0.31.1 and older stored it. */
    const val LEGACY_BASE64_DATABASE_FILE = "encrypted_database.db"

    /**
     * Convert the base64 vault file into [file] when only the base64 file exists, writing through [store].
     */
    fun convertLegacyBase64Database(filesDir: File, file: File, store: (ByteArray) -> Unit) {
        val legacy = File(filesDir, LEGACY_BASE64_DATABASE_FILE)
        if (file.exists() || !legacy.exists()) {
            return
        }
        try {
            store(Base64.getMimeDecoder().decode(legacy.readBytes()))
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "The legacy base64 vault file does not decode; dropping it", e)
        }
        // A failed write throws before this line, so the next read tries again.
        legacy.delete()
    }
}
