package net.aliasvault.app.utils

import android.util.Log
import java.nio.ByteBuffer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.experimental.and

/**
 * RFC 6238 TOTP generator.
 */
object TotpGenerator {
    private const val TAG = "TotpGenerator"
    private const val DEFAULT_PERIOD = 30
    private const val DEFAULT_DIGITS = 6
    private const val DEFAULT_ALGORITHM = "SHA1"

    /**
     * Map a TOTP algorithm name to its JCA Mac name. An unrecognized name falls back to
     * HmacSHA1, which is what RFC 6238 assumes.
     */
    private fun macName(algorithm: String): String = when (algorithm.uppercase()) {
        "SHA256" -> "HmacSHA256"
        "SHA512" -> "HmacSHA512"
        else -> "HmacSHA1"
    }

    /**
     * Generate the current TOTP code for a Base32-encoded secret.
     * Returns null when the secret is invalid or HMAC fails.
     */
    fun generateCode(
        secret: String,
        timeSeconds: Long = System.currentTimeMillis() / 1000L,
        period: Int = DEFAULT_PERIOD,
        digits: Int = DEFAULT_DIGITS,
        algorithm: String = DEFAULT_ALGORITHM,
    ): String? {
        val secretBytes = base32Decode(secret) ?: return null
        if (secretBytes.isEmpty()) return null

        // A zero or negative period would divide by zero; treat it as the standard step.
        val step = if (period > 0) period else DEFAULT_PERIOD
        val counter = timeSeconds / step
        return generateHotp(secretBytes, counter, digits, algorithm)
    }

    private fun generateHotp(secret: ByteArray, counter: Long, digits: Int, algorithm: String): String? {
        return try {
            val counterBytes = ByteBuffer.allocate(Long.SIZE_BYTES).putLong(counter).array()

            val mac = Mac.getInstance(macName(algorithm))
            mac.init(SecretKeySpec(secret, macName(algorithm)))
            val hash = mac.doFinal(counterBytes)

            // Dynamic truncation per RFC 4226
            val offset = (hash[hash.size - 1] and 0x0F).toInt()
            val binary = ((hash[offset].toInt() and 0x7F) shl 24) or
                ((hash[offset + 1].toInt() and 0xFF) shl 16) or
                ((hash[offset + 2].toInt() and 0xFF) shl 8) or
                (hash[offset + 3].toInt() and 0xFF)

            val mod = pow10(digits)
            val code = binary % mod
            code.toString().padStart(digits, '0')
        } catch (e: Exception) {
            Log.w(TAG, "TOTP HMAC generation failed", e)
            null
        }
    }

    private fun pow10(n: Int): Int {
        var result = 1
        repeat(n) { result *= 10 }
        return result
    }

    /**
     * Decode a Base32 (RFC 4648) string to bytes. Tolerates lowercase, spaces,
     * and trailing padding ('='). Returns null on invalid characters.
     */
    private fun base32Decode(input: String): ByteArray? {
        val cleaned = input.uppercase().replace(" ", "").replace("=", "")
        if (cleaned.isEmpty()) return ByteArray(0)

        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        val output = ByteArray((cleaned.length * 5) / 8)
        var buffer = 0
        var bitsLeft = 0
        var index = 0

        for (ch in cleaned) {
            val value = alphabet.indexOf(ch)
            if (value < 0) return null
            buffer = (buffer shl 5) or value
            bitsLeft += 5
            if (bitsLeft >= 8) {
                output[index++] = ((buffer shr (bitsLeft - 8)) and 0xFF).toByte()
                bitsLeft -= 8
            }
        }

        return output.copyOfRange(0, index)
    }
}
