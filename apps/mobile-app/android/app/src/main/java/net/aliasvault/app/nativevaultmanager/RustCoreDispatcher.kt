package net.aliasvault.app.nativevaultmanager

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import uniffi.aliasvault_core.argon2DeriveKey
import uniffi.aliasvault_core.decodeEmailSource
import uniffi.aliasvault_core.extractDomain
import uniffi.aliasvault_core.extractEmailAttachment
import uniffi.aliasvault_core.extractRootDomain
import uniffi.aliasvault_core.filterCredentialsJson
import uniffi.aliasvault_core.generateIdentity
import uniffi.aliasvault_core.generateIdentityEmailPrefix
import uniffi.aliasvault_core.generateIdentityUsername
import uniffi.aliasvault_core.generatePassword
import uniffi.aliasvault_core.generateRandomEmailPrefix
import uniffi.aliasvault_core.getDicewareLanguages
import uniffi.aliasvault_core.getIdentityAgeRanges
import uniffi.aliasvault_core.getIdentityLanguages
import uniffi.aliasvault_core.getSyncableTableNames
import uniffi.aliasvault_core.parseEmailSource
import uniffi.aliasvault_core.pruneVaultJson
import uniffi.aliasvault_core.selectFaviconTarget
import uniffi.aliasvault_core.srpDerivePrivateKey
import uniffi.aliasvault_core.srpDeriveSession
import uniffi.aliasvault_core.srpDeriveVerifier
import uniffi.aliasvault_core.srpGenerateEphemeral
import uniffi.aliasvault_core.srpGenerateSalt
import uniffi.aliasvault_core.vaultCodecCanonicalizeFromSqlite
import uniffi.aliasvault_core.vaultCodecGenerateManifestSalt
import uniffi.aliasvault_core.vaultCodecLogoContentHash
import uniffi.aliasvault_core.vaultCodecLogoIdFor
import uniffi.aliasvault_core.vaultCodecPackPayload
import uniffi.aliasvault_core.vaultCodecUnpackPayload

/**
 * Routes `rustCall` invocations from React Native onto the uniffi bindings: one case per exported core
 * function and no logic. Arguments arrive as a JSON array (bytes as base64); results leave as JSON text.
 * Functions that already return JSON text pass it through unchanged, everything else is JSON-encoded here.
 */
@Suppress("TooManyFunctions", "LongMethod", "CyclomaticComplexMethod")
object RustCoreDispatcher {
    /**
     * Dispatch one call.
     * @param name The uniffi function name in camelCase.
     * @param argsJson The positional arguments as a JSON array.
     * @return The result as JSON text.
     */
    fun call(name: String, argsJson: String): String {
        val args = Args(JSONArray(argsJson))

        return when (name) {
            "extractDomain" -> json(extractDomain(args.string(0)))
            "extractRootDomain" -> json(extractRootDomain(args.string(0)))
            "selectFaviconTarget" -> {
                val target = selectFaviconTarget(args.strings(0)) ?: return "null"
                JSONObject().put("url", target.url).put("source", target.source).toString()
            }
            "filterCredentialsJson" -> filterCredentialsJson(args.string(0))

            "generatePassword" -> json(generatePassword(args.string(0)))
            "getDicewareLanguages" -> json(getDicewareLanguages())
            "generateIdentity" -> json(generateIdentity(args.string(0)))
            "generateIdentityUsername" -> json(generateIdentityUsername(args.string(0)))
            "generateIdentityEmailPrefix" -> json(generateIdentityEmailPrefix(args.string(0)))
            "generateRandomEmailPrefix" -> json(generateRandomEmailPrefix(args.uint(0)))
            "getIdentityLanguages" -> json(getIdentityLanguages())
            "getIdentityAgeRanges" -> json(getIdentityAgeRanges())

            "parseEmailSource" -> parseEmailSource(args.bytes(0))
            "decodeEmailSource" -> json(decodeEmailSource(args.bytes(0)))
            "extractEmailAttachment" -> json(extractEmailAttachment(args.bytes(0), args.uint(1), args.optionalBytes(2)))

            "argon2DeriveKey" -> json(argon2DeriveKey(args.string(0), args.string(1), args.string(2)))

            "srpGenerateSalt" -> json(srpGenerateSalt())
            "srpDerivePrivateKey" -> json(srpDerivePrivateKey(args.string(0), args.string(1), args.string(2)))
            "srpDeriveVerifier" -> json(srpDeriveVerifier(args.string(0)))
            "srpGenerateEphemeral" -> {
                val ephemeral = srpGenerateEphemeral()
                JSONObject().put("public", ephemeral.public).put("secret", ephemeral.secret).toString()
            }
            "srpDeriveSession" -> {
                val session = srpDeriveSession(args.string(0), args.string(1), args.string(2), args.string(3), args.string(4))
                JSONObject().put("proof", session.proof).put("key", session.key).toString()
            }

            "getSyncableTableNames" -> json(getSyncableTableNames())
            "pruneVaultJson" -> pruneVaultJson(args.string(0))

            "vaultCodecCanonicalizeFromSqlite" -> vaultCodecCanonicalizeFromSqlite(args.string(0))
            "vaultCodecGenerateManifestSalt" -> json(vaultCodecGenerateManifestSalt())
            "vaultCodecLogoIdFor" -> json(vaultCodecLogoIdFor(args.string(0), args.string(1), args.string(2)))
            "vaultCodecLogoContentHash" -> json(vaultCodecLogoContentHash(args.bytes(0)))
            "vaultCodecPackPayload" -> json(vaultCodecPackPayload(args.string(0)))
            "vaultCodecUnpackPayload" -> json(vaultCodecUnpackPayload(args.bytes(0)))

            else -> throw IllegalArgumentException("Unknown Rust core function '$name'")
        }
    }

    /**
     * The positional arguments of one call.
     */
    private class Args(private val values: JSONArray) {
        fun string(index: Int): String = values.getString(index)

        fun optionalString(index: Int): String? = if (index < values.length() && !values.isNull(index)) values.getString(index) else null

        fun uint(index: Int): UInt = values.getInt(index).toUInt()

        fun strings(index: Int): List<String> {
            val array = values.getJSONArray(index)
            return (0 until array.length()).map { array.getString(it) }
        }

        fun bytes(index: Int): ByteArray = Base64.decode(string(index), Base64.NO_WRAP)

        fun optionalBytes(index: Int): ByteArray? = optionalString(index)?.let { Base64.decode(it, Base64.NO_WRAP) }
    }

    /** JSON-encode a plain string. */
    private fun json(value: String): String = JSONObject.quote(value)

    /** JSON-encode a list of strings. */
    private fun json(values: List<String>): String = JSONArray(values).toString()

    /** JSON-encode raw bytes as a base64 string. */
    private fun json(bytes: ByteArray): String = json(Base64.encodeToString(bytes, Base64.NO_WRAP))
}
