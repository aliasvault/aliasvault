package net.aliasvault.app.vaultstore.passkey

/**
 * PasskeyHelper
 * -------------------------
 * Utility class for passkey-related operations, including GUID/base64url conversions.
 *
 * This is a Kotlin port of the reference TypeScript implementation:
 * - Reference: apps/browser-extension/src/utils/passkey/PasskeyHelper.ts
 * - iOS: apps/mobile-app/ios/VaultStoreKit/Passkeys/PasskeyHelper.swift
 *
 * IMPORTANT: Keep all implementations synchronized. Changes to the public interface must be
 * reflected in all ports. Method names, parameters, and behavior should remain consistent.
 */
object PasskeyHelper {

    /**
     * Convert GUID string to byte array
     * Example: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" → ByteArray(16 bytes)
     */
    @JvmStatic
    fun guidToBytes(guid: String): ByteArray {
        // Remove dashes
        val hex = guid.replace("-", "")

        require(hex.length == 32) { "Invalid GUID format" }

        val bytes = ByteArray(16)
        for (i in 0..15) {
            bytes[i] = hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
        return bytes
    }

    /**
     * Convert byte array to GUID string (uppercase)
     * Example: ByteArray(16 bytes) → "3F2504E0-4F89-11D3-9A0C-0305E82C3301"
     */
    @JvmStatic
    fun bytesToGuid(bytes: ByteArray): String {
        require(bytes.size == 16) { "Invalid byte length for GUID" }

        val hex = bytes.joinToString("") { "%02x".format(it) }

        // Insert dashes in canonical format: 8-4-4-4-12
        return buildString {
            append(hex.substring(0, 8))
            append("-")
            append(hex.substring(8, 12))
            append("-")
            append(hex.substring(12, 16))
            append("-")
            append(hex.substring(16, 20))
            append("-")
            append(hex.substring(20))
        }.uppercase()
    }

    /**
     * Convert byte array to Base64URL encoding
     * Base64URL uses - instead of + and _ instead of /, and omits padding
     */
    @JvmStatic
    fun bytesToBase64url(bytes: ByteArray): String {
        val base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        return base64
            .replace('+', '-')
            .replace('/', '_')
            .trimEnd('=')
    }
}
