package net.aliasvault.app.vaultstore.models

/**
 * A TOTP code stored against an item, including the RFC 6238 parameters it was created with.
 *
 * @property secretKey The Base32-encoded shared secret.
 * @property algorithm The HMAC algorithm used to derive the code: SHA1, SHA256 or SHA512.
 * @property digits The number of digits in the generated code, typically 6 or 8.
 * @property period The time step in seconds a code stays valid for, typically 30 or 60.
 */
data class TotpCode(
    val secretKey: String,
    val algorithm: String = DEFAULT_ALGORITHM,
    val digits: Int = DEFAULT_DIGITS,
    val period: Int = DEFAULT_PERIOD,
) {
    companion object {
        /** The HMAC algorithm RFC 6238 assumes when an otpauth:// URI omits the `algorithm` parameter. */
        const val DEFAULT_ALGORITHM = "SHA1"

        /** The code length RFC 6238 assumes when an otpauth:// URI omits the `digits` parameter. */
        const val DEFAULT_DIGITS = 6

        /** The time step RFC 6238 assumes when an otpauth:// URI omits the `period` parameter. */
        const val DEFAULT_PERIOD = 30
    }
}
