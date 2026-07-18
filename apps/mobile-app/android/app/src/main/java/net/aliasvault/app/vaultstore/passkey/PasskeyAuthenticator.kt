package net.aliasvault.app.vaultstore.passkey

import net.aliasvault.app.utils.Helpers
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.interfaces.RSAPrivateCrtKey
import java.security.interfaces.RSAPublicKey
import java.security.spec.ECGenParameterSpec
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * PasskeyAuthenticator
 * -------------------------
 * A WebAuthn "virtual authenticator" for Android credential provider.
 * Implements passkey creation (registration) and authentication (assertion) following
 * the WebAuthn Level 2 specification.
 *
 * This is a Kotlin port of the reference TypeScript implementation:
 * - Reference: apps/browser-extension/src/utils/passkey/PasskeyAuthenticator.ts
 * - iOS: apps/mobile-app/ios/VaultStoreKit/Passkeys/PasskeyAuthenticator.swift
 *
 * IMPORTANT: Keep all implementations synchronized. Changes to the public interface must be
 * reflected in all ports. Method names, parameters, and behavior should remain consistent.
 *
 * Key features:
 * - ES256 (ECDSA P-256) and RS256 (RSASSA-PKCS1-v1.5) key pair generation
 * - CBOR/COSE encoding for attestation objects
 * - Proper authenticator data with WebAuthn flags
 * - Self-attestation (packed format) or none attestation
 * - Consistent base64url handling
 * - Sign count always 0 for syncable passkeys
 * - BE/BS flags for backup-eligible and backed-up status
 */
object PasskeyAuthenticator {

    /** AliasVault AAGUID: a11a5faa-9f32-4b8c-8c5d-2f7d13e8c942. */
    private val AAGUID = byteArrayOf(
        0xa1.toByte(), 0x1a, 0x5f, 0xaa.toByte(), 0x9f.toByte(), 0x32, 0x4b, 0x8c.toByte(),
        0x8c.toByte(), 0x5d, 0x2f, 0x7d, 0x13, 0xe8.toByte(), 0xc9.toByte(), 0x42,
    )

    /** COSE algorithm identifier for ES256 (ECDSA P-256 with SHA-256). */
    const val ALG_ES256 = -7

    /** COSE algorithm identifier for RS256 (RSASSA-PKCS1-v1.5 with SHA-256). */
    const val ALG_RS256 = -257

    /** RSA modulus size used when generating RS256 credentials. */
    private const val RSA_KEY_SIZE = 2048

    /**
     * Algorithms supported by this authenticator, in our order of preference.
     * When an RP lists multiple, we honor the RP's order and pick the first match.
     */
    private val SUPPORTED_ALGORITHMS = listOf(ALG_ES256, ALG_RS256)

    // MARK: - Public API

    /**
     * Pick a supported credential algorithm from the RP's pubKeyCredParams.
     * Honors the RP's preference order and returns the first algorithm we support.
     * Defaults to ES256 when the RP provides no params.
     *
     * @param params COSE algorithm identifiers from pubKeyCredParams, in RP order.
     * @return The chosen COSE algorithm identifier (-7 for ES256, -257 for RS256).
     */
    @JvmStatic
    fun pickSupportedAlgorithm(params: List<Int>): Int {
        if (params.isEmpty()) {
            return ALG_ES256
        }
        for (alg in params) {
            if (SUPPORTED_ALGORITHMS.contains(alg)) {
                return alg
            }
        }
        throw PasskeyError.UnsupportedAlgorithm(
            "No supported algorithm (ES256, RS256) in pubKeyCredParams",
        )
    }

    /**
     * Create a new passkey (registration).
     * Returns credential data ready for Android to return to the RP, plus storage data.
     */
    @JvmStatic
    @Suppress("LongParameterList")
    fun createPasskey(
        credentialId: ByteArray,
        rpId: String,
        userId: ByteArray?,
        userName: String?,
        userDisplayName: String?,
        uvPerformed: Boolean = false,
        enablePrf: Boolean = false,
        prfInputs: PrfInputs? = null,
        algorithm: Int = ALG_ES256,
    ): PasskeyCreationResult {
        // 1. Generate key pair for the chosen algorithm
        val keyPair = generateKeyPair(algorithm)

        // 2. RP ID hash
        val md = MessageDigest.getInstance("SHA-256")
        val rpIdHash = md.digest(rpId.toByteArray(Charsets.UTF_8))

        // 3. Build flags
        var flags: Byte = 0x41 // UP (bit 0) + AT (bit 6)
        if (uvPerformed) {
            flags = (flags.toInt() or 0x04).toByte() // UV (bit 2)
        }
        flags = (flags.toInt() or 0x08).toByte() // BE (bit 3) - backup eligible
        flags = (flags.toInt() or 0x10).toByte() // BS (bit 4) - backup state

        // 4. Sign count (always 0 for syncable credentials)
        val signCount = byteArrayOf(0x00, 0x00, 0x00, 0x00)

        // 5. Build COSE public key
        val coseKey = if (algorithm == ALG_RS256) {
            buildCoseRsaRs256(keyPair.public as RSAPublicKey)
        } else {
            buildCoseEc2Es256(keyPair.public as ECPublicKey)
        }

        // 6. Build attested credential data
        val credIdLength = byteArrayOf(
            ((credentialId.size shr 8) and 0xFF).toByte(),
            (credentialId.size and 0xFF).toByte(),
        )
        val attestedCredData = AAGUID + credIdLength + credentialId + coseKey

        // 7. Build authenticator data
        val authenticatorData = rpIdHash + byteArrayOf(flags) + signCount + attestedCredData

        // 8. Build attestation object (none format)
        val attestationObject = buildAttestationObjectNone(authenticatorData)

        // 9. Generate PRF secret if requested
        var prfSecret: ByteArray? = null
        if (enablePrf) {
            val prfBytes = ByteArray(32)
            SecureRandom().nextBytes(prfBytes)
            prfSecret = prfBytes
        }

        // 10. Evaluate PRF values if requested during registration
        var prfResults: PrfResults? = null
        if (prfInputs != null && prfInputs.first != null && prfSecret != null) {
            val firstResult = evaluatePrf(prfSecret, prfInputs.first)
            val secondResult = prfInputs.second?.let { evaluatePrf(prfSecret, it) }
            prfResults = PrfResults(firstResult, secondResult)
        }

        // 11. Export keys for storage
        val publicKeyJWK: ByteArray
        val privateKeyData: ByteArray
        if (algorithm == ALG_RS256) {
            publicKeyJWK = exportRsaPublicKeyAsJWK(keyPair.public as RSAPublicKey)
            privateKeyData = exportRsaPrivateKeyAsJWK(keyPair.private as RSAPrivateCrtKey)
        } else {
            publicKeyJWK = exportPublicKeyAsJWK(keyPair.public as ECPublicKey)
            privateKeyData = exportPrivateKeyAsJWK(keyPair.private as ECPrivateKey, keyPair.public as ECPublicKey)
        }
        val publicKeyDER = keyPair.public.encoded // DER/SPKI format (EC or RSA)

        return PasskeyCreationResult(
            credentialId = credentialId,
            attestationObject = attestationObject,
            authenticatorData = authenticatorData,
            publicKey = publicKeyJWK,
            publicKeyDER = publicKeyDER,
            privateKey = privateKeyData,
            rpId = rpId,
            userId = userId,
            userName = userName,
            userDisplayName = userDisplayName,
            prfSecret = prfSecret,
            prfResults = prfResults,
        )
    }

    /**
     * Create an assertion (authentication).
     * Returns assertion data ready for Android to return to the RP.
     */
    @JvmStatic
    @Suppress("LongParameterList")
    fun getAssertion(
        credentialId: ByteArray,
        clientDataHash: ByteArray,
        rpId: String,
        privateKeyJWK: ByteArray,
        userId: ByteArray?,
        uvPerformed: Boolean = false,
        prfInputs: PrfInputs? = null,
        prfSecret: ByteArray? = null,
    ): PasskeyAssertionResult {
        // 1. RP ID hash
        val md = MessageDigest.getInstance("SHA-256")
        val rpIdHash = md.digest(rpId.toByteArray(Charsets.UTF_8))

        // 2. Build flags
        var flags: Byte = 0x01 // UP (bit 0)
        if (uvPerformed) {
            flags = (flags.toInt() or 0x04).toByte() // UV (bit 2)
        }
        flags = (flags.toInt() or 0x08).toByte() // BE (bit 3)
        flags = (flags.toInt() or 0x10).toByte() // BS (bit 4)

        // 3. Sign count
        val signCount = byteArrayOf(0x00, 0x00, 0x00, 0x00)

        // 4. Build authenticator data
        val authenticatorData = rpIdHash + byteArrayOf(flags) + signCount

        // 5. Build data to sign: authenticatorData || clientDataHash
        val dataToSign = authenticatorData + clientDataHash

        // 6. Determine algorithm from the stored key, import it, and sign
        val jwk = JSONObject(String(privateKeyJWK, Charsets.UTF_8))
        val algorithm = if (jwk.optString("kty") == "RSA") ALG_RS256 else ALG_ES256
        val privateKey = importPrivateKeyFromJWK(privateKeyJWK)
        val signatureAlgorithm = if (algorithm == ALG_RS256) "SHA256withRSA" else "SHA256withECDSA"
        val signature = Signature.getInstance(signatureAlgorithm)
        signature.initSign(privateKey)
        signature.update(dataToSign)

        // 7. The signature is already in the form the RP expects:
        // ECDSA output is DER-encoded, RSA output is raw PKCS#1 v1.5. Both are what WebAuthn expects.
        val signatureBytes = signature.sign()

        // 8. Evaluate PRF if requested
        var prfResults: PrfResults? = null
        if (prfInputs != null && prfInputs.first != null && prfSecret != null) {
            val firstResult = evaluatePrf(prfSecret, prfInputs.first)
            val secondResult = prfInputs.second?.let { evaluatePrf(prfSecret, it) }
            prfResults = PrfResults(firstResult, secondResult)
        }

        return PasskeyAssertionResult(
            credentialId = credentialId,
            authenticatorData = authenticatorData,
            signature = signatureBytes,
            userHandle = userId,
            prfResults = prfResults,
        )
    }

    // MARK: - Key Management

    /**
     * Export public key as JWK format (JSON).
     */
    private fun exportPublicKeyAsJWK(publicKey: ECPublicKey): ByteArray {
        val w = publicKey.w
        val xBytes = w.affineX.toByteArray().dropLeadingZeros().padTo32Bytes()
        val yBytes = w.affineY.toByteArray().dropLeadingZeros().padTo32Bytes()

        val jwk = JSONObject().apply {
            put("kty", "EC")
            put("crv", "P-256")
            put("x", PasskeyHelper.bytesToBase64url(xBytes))
            put("y", PasskeyHelper.bytesToBase64url(yBytes))
        }

        return jwk.toString().toByteArray(Charsets.UTF_8)
    }

    /**
     * Export private key as JWK format (JSON).
     * Note: We need the KeyPair to properly export both public and private components.
     */
    private fun exportPrivateKeyAsJWK(privateKey: ECPrivateKey, publicKey: ECPublicKey): ByteArray {
        val w = publicKey.w
        val xBytes = w.affineX.toByteArray().dropLeadingZeros().padTo32Bytes()
        val yBytes = w.affineY.toByteArray().dropLeadingZeros().padTo32Bytes()
        val dBytes = privateKey.s.toByteArray().dropLeadingZeros().padTo32Bytes()

        val jwk = JSONObject().apply {
            put("kty", "EC")
            put("crv", "P-256")
            put("x", PasskeyHelper.bytesToBase64url(xBytes))
            put("y", PasskeyHelper.bytesToBase64url(yBytes))
            put("d", PasskeyHelper.bytesToBase64url(dBytes))
        }

        return jwk.toString().toByteArray(Charsets.UTF_8)
    }

    /**
     * Export an RSA public key as JWK format (JSON): {kty, n, e}.
     */
    private fun exportRsaPublicKeyAsJWK(publicKey: RSAPublicKey): ByteArray {
        val jwk = JSONObject().apply {
            put("kty", "RSA")
            put("n", PasskeyHelper.bytesToBase64url(publicKey.modulus.toUnsignedBytes()))
            put("e", PasskeyHelper.bytesToBase64url(publicKey.publicExponent.toUnsignedBytes()))
        }

        return jwk.toString().toByteArray(Charsets.UTF_8)
    }

    /**
     * Export an RSA private key as JWK format (JSON): {kty, n, e, d, p, q, dp, dq, qi}.
     */
    private fun exportRsaPrivateKeyAsJWK(privateKey: RSAPrivateCrtKey): ByteArray {
        val jwk = JSONObject().apply {
            put("kty", "RSA")
            put("n", PasskeyHelper.bytesToBase64url(privateKey.modulus.toUnsignedBytes()))
            put("e", PasskeyHelper.bytesToBase64url(privateKey.publicExponent.toUnsignedBytes()))
            put("d", PasskeyHelper.bytesToBase64url(privateKey.privateExponent.toUnsignedBytes()))
            put("p", PasskeyHelper.bytesToBase64url(privateKey.primeP.toUnsignedBytes()))
            put("q", PasskeyHelper.bytesToBase64url(privateKey.primeQ.toUnsignedBytes()))
            put("dp", PasskeyHelper.bytesToBase64url(privateKey.primeExponentP.toUnsignedBytes()))
            put("dq", PasskeyHelper.bytesToBase64url(privateKey.primeExponentQ.toUnsignedBytes()))
            put("qi", PasskeyHelper.bytesToBase64url(privateKey.crtCoefficient.toUnsignedBytes()))
        }

        return jwk.toString().toByteArray(Charsets.UTF_8)
    }

    /**
     * Import a private key from JWK format, dispatching on the key type ("kty").
     */
    private fun importPrivateKeyFromJWK(jwkData: ByteArray): java.security.PrivateKey {
        val jwkString = String(jwkData, Charsets.UTF_8)
        val jwk = JSONObject(jwkString)
        return if (jwk.optString("kty") == "RSA") {
            importRsaPrivateKeyFromJWK(jwk)
        } else {
            importEcPrivateKeyFromJWK(jwk)
        }
    }

    /**
     * Import an EC (P-256) private key from JWK format.
     * Uses ECPrivateKeySpec to avoid Android Keystore issues.
     */
    private fun importEcPrivateKeyFromJWK(jwk: JSONObject): java.security.PrivateKey {
        // Extract the d parameter (private key component)
        val dBase64url = jwk.optString("d")
        if (dBase64url.isEmpty()) {
            throw PasskeyError.InvalidJWK("Missing 'd' parameter in JWK")
        }

        // Decode base64url to bytes
        val dBytes = Helpers.base64urlDecode(dBase64url)

        // Convert to BigInteger (d parameter is the private key value)
        val d = java.math.BigInteger(1, dBytes)

        // Get P-256 curve parameters
        val ecSpec = java.security.spec.ECGenParameterSpec("secp256r1")
        val params = java.security.AlgorithmParameters.getInstance("EC")
        params.init(ecSpec)
        val ecParameterSpec = params.getParameterSpec(java.security.spec.ECParameterSpec::class.java)

        // Create ECPrivateKeySpec with the d value and curve parameters
        val privKeySpec = java.security.spec.ECPrivateKeySpec(d, ecParameterSpec)

        // Generate the private key
        val keyFactory = java.security.KeyFactory.getInstance("EC")
        return keyFactory.generatePrivate(privKeySpec) as ECPrivateKey
    }

    /**
     * Import an RSA private key from JWK format using the full CRT parameters.
     */
    private fun importRsaPrivateKeyFromJWK(jwk: JSONObject): java.security.PrivateKey {
        fun param(field: String): java.math.BigInteger {
            val b64 = jwk.optString(field)
            if (b64.isEmpty()) {
                throw PasskeyError.InvalidJWK("Missing '$field' parameter in RSA JWK")
            }
            return java.math.BigInteger(1, Helpers.base64urlDecode(b64))
        }

        val spec = java.security.spec.RSAPrivateCrtKeySpec(
            param("n"), // modulus
            param("e"), // public exponent
            param("d"), // private exponent
            param("p"), // prime p
            param("q"), // prime q
            param("dp"), // prime exponent p
            param("dq"), // prime exponent q
            param("qi"), // crt coefficient
        )

        val keyFactory = java.security.KeyFactory.getInstance("RSA")
        return keyFactory.generatePrivate(spec)
    }

    /**
     * Generate a key pair for the given COSE algorithm.
     */
    private fun generateKeyPair(algorithm: Int): java.security.KeyPair {
        return if (algorithm == ALG_RS256) {
            val generator = KeyPairGenerator.getInstance("RSA")
            generator.initialize(RSA_KEY_SIZE)
            generator.generateKeyPair()
        } else {
            val generator = KeyPairGenerator.getInstance("EC")
            generator.initialize(ECGenParameterSpec("secp256r1"))
            generator.generateKeyPair()
        }
    }

    // MARK: - CBOR Encoding

    /**
     * Build COSE EC2 public key for ES256.
     * CBOR map: {1: 2, 3: -7, -1: 1, -2: x, -3: y}.
     */
    private fun buildCoseEc2Es256(publicKey: ECPublicKey): ByteArray {
        val w = publicKey.w
        val xBytes = w.affineX.toByteArray().dropLeadingZeros().padTo32Bytes()
        val yBytes = w.affineY.toByteArray().dropLeadingZeros().padTo32Bytes()

        return byteArrayOf(
            0xA5.toByte(), // map(5)
            0x01, 0x02, // 1: 2 (kty: EC2)
            0x03, 0x26, // 3: -7 (alg: ES256)
            0x20, 0x01, // -1: 1 (crv: P-256)
            0x21, 0x58, 0x20, // -2: bytes(32) for x
        ) + xBytes + byteArrayOf(
            0x22, 0x58, 0x20, // -3: bytes(32) for y
        ) + yBytes
    }

    /**
     * Build COSE RSA public key for RS256 (RFC 8230).
     * CBOR map: {1: 3 (kty: RSA), 3: -257 (alg: RS256), -1: n (modulus), -2: e (exponent)}.
     */
    private fun buildCoseRsaRs256(publicKey: RSAPublicKey): ByteArray {
        val n = publicKey.modulus.toUnsignedBytes()
        val e = publicKey.publicExponent.toUnsignedBytes()

        return byteArrayOf(
            0xA4.toByte(), // map(4)
            0x01, 0x03, // 1: 3 (kty: RSA)
            0x03, 0x39, 0x01, 0x00, // 3: -257 (alg: RS256)
            0x20, // -1: modulus n
        ) + cborBytes(n) + byteArrayOf(
            0x21, // -2: exponent e
        ) + cborBytes(e)
    }

    /**
     * Build attestation object with "none" format.
     * CBOR map: {fmt: "none", attStmt: {}, authData: <bytes>}.
     */
    private fun buildAttestationObjectNone(authenticatorData: ByteArray): ByteArray {
        return byteArrayOf(
            0xA3.toByte(), // map(3)
        ) +
            cborText("fmt") +
            cborText("none") +
            cborText("attStmt") +
            byteArrayOf(0xA0.toByte()) + // map(0) - empty attStmt
            cborText("authData") +
            cborBytes(authenticatorData)
    }

    /**
     * Encode a string as CBOR text.
     */
    private fun cborText(text: String): ByteArray {
        val bytes = text.toByteArray(Charsets.UTF_8)
        return when {
            bytes.size <= 23 -> byteArrayOf((0x60 or bytes.size).toByte()) + bytes
            bytes.size <= 0xFF -> byteArrayOf(0x78, bytes.size.toByte()) + bytes
            else -> byteArrayOf(
                0x79,
                ((bytes.size shr 8) and 0xFF).toByte(),
                (bytes.size and 0xFF).toByte(),
            ) + bytes
        }
    }

    /**
     * Encode bytes as CBOR byte string.
     */
    private fun cborBytes(bytes: ByteArray): ByteArray {
        return when {
            bytes.size <= 23 -> byteArrayOf((0x40 or bytes.size).toByte()) + bytes
            bytes.size <= 0xFF -> byteArrayOf(0x58, bytes.size.toByte()) + bytes
            else -> byteArrayOf(
                0x59,
                ((bytes.size shr 8) and 0xFF).toByte(),
                (bytes.size and 0xFF).toByte(),
            ) + bytes
        }
    }

    // MARK: - PRF Extension

    /**
     * Evaluate PRF (hmac-secret extension).
     * Implements: HMAC-SHA256(prfSecret, SHA-256("WebAuthn PRF\x00" || salt)).
     */
    private fun evaluatePrf(secret: ByteArray, salt: ByteArray): ByteArray {
        // Step 1: Domain separation - hash salt with "WebAuthn PRF\x00" prefix
        val prefix = "WebAuthn PRF\u0000".toByteArray(Charsets.UTF_8)
        val domainSeparatedSalt = prefix + salt

        val md = MessageDigest.getInstance("SHA-256")
        val hashedSalt = md.digest(domainSeparatedSalt)

        // Step 2: Compute HMAC-SHA256(prfSecret, hashedSalt)
        val mac = Mac.getInstance("HmacSHA256")
        val secretKey = SecretKeySpec(secret, "HmacSHA256")
        mac.init(secretKey)
        return mac.doFinal(hashedSalt)
    }

    // MARK: - Helper Extensions

    private fun ByteArray.dropLeadingZeros(): ByteArray {
        var index = 0
        while (index < this.size - 1 && this[index] == 0.toByte()) {
            index++
        }
        return this.copyOfRange(index, this.size)
    }

    private fun ByteArray.padTo32Bytes(): ByteArray {
        if (this.size == 32) return this
        val padded = ByteArray(32)
        System.arraycopy(this, 0, padded, 32 - this.size, this.size)
        return padded
    }

    /**
     * Convert a (positive) BigInteger to its minimal unsigned big-endian byte representation.
     * BigInteger.toByteArray() is two's-complement and may carry a leading 0x00 sign byte.
     */
    private fun java.math.BigInteger.toUnsignedBytes(): ByteArray = this.toByteArray().dropLeadingZeros()

    // MARK: - Supporting Types

    /**
     * Result of passkey creation containing all data needed for registration and storage.
     */
    data class PasskeyCreationResult(
        /** The unique credential identifier. */
        val credentialId: ByteArray,
        /** The authenticator data bytes. */
        val authenticatorData: ByteArray,
        /** The attestation object in CBOR format. */
        val attestationObject: ByteArray,
        /** The public key in JWK format. */
        val publicKey: ByteArray,
        /** The public key in DER/SPKI format for Chrome. */
        val publicKeyDER: ByteArray,
        /** The private key in JWK format. */
        val privateKey: ByteArray,
        /** The relying party identifier. */
        val rpId: String,
        /** The user identifier. */
        val userId: ByteArray?,
        /** The username. */
        val userName: String?,
        /** The user display name. */
        val userDisplayName: String?,
        /** The PRF secret for hmac-secret extension. */
        val prfSecret: ByteArray?,
        /** The PRF evaluation results if requested. */
        val prfResults: PrfResults?,
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false

            other as PasskeyCreationResult

            if (!credentialId.contentEquals(other.credentialId)) return false
            if (!authenticatorData.contentEquals(other.authenticatorData)) return false
            if (!attestationObject.contentEquals(other.attestationObject)) return false
            if (!publicKey.contentEquals(other.publicKey)) return false
            if (!publicKeyDER.contentEquals(other.publicKeyDER)) return false
            if (!privateKey.contentEquals(other.privateKey)) return false
            if (rpId != other.rpId) return false
            if (userId != null) {
                if (other.userId == null) return false
                if (!userId.contentEquals(other.userId)) return false
            } else if (other.userId != null) return false
            if (userName != other.userName) return false
            if (userDisplayName != other.userDisplayName) return false
            if (prfSecret != null) {
                if (other.prfSecret == null) return false
                if (!prfSecret.contentEquals(other.prfSecret)) return false
            } else if (other.prfSecret != null) return false
            if (prfResults != other.prfResults) return false

            return true
        }

        override fun hashCode(): Int {
            var result = credentialId.contentHashCode()
            result = 31 * result + authenticatorData.contentHashCode()
            result = 31 * result + attestationObject.contentHashCode()
            result = 31 * result + publicKey.contentHashCode()
            result = 31 * result + publicKeyDER.contentHashCode()
            result = 31 * result + privateKey.contentHashCode()
            result = 31 * result + rpId.hashCode()
            result = 31 * result + (userId?.contentHashCode() ?: 0)
            result = 31 * result + (userName?.hashCode() ?: 0)
            result = 31 * result + (userDisplayName?.hashCode() ?: 0)
            result = 31 * result + (prfSecret?.contentHashCode() ?: 0)
            result = 31 * result + (prfResults?.hashCode() ?: 0)
            return result
        }
    }

    /**
     * Result of passkey assertion containing authentication data.
     */
    data class PasskeyAssertionResult(
        /** The credential identifier. */
        val credentialId: ByteArray,
        /** The authenticator data bytes. */
        val authenticatorData: ByteArray,
        /** The signature (DER-encoded for ES256, raw PKCS#1 v1.5 for RS256). */
        val signature: ByteArray,
        /** The user handle. */
        val userHandle: ByteArray?,
        /** The PRF evaluation results if requested. */
        val prfResults: PrfResults?,
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false

            other as PasskeyAssertionResult

            if (!credentialId.contentEquals(other.credentialId)) return false
            if (!authenticatorData.contentEquals(other.authenticatorData)) return false
            if (!signature.contentEquals(other.signature)) return false
            if (userHandle != null) {
                if (other.userHandle == null) return false
                if (!userHandle.contentEquals(other.userHandle)) return false
            } else if (other.userHandle != null) return false
            if (prfResults != other.prfResults) return false

            return true
        }

        override fun hashCode(): Int {
            var result = credentialId.contentHashCode()
            result = 31 * result + authenticatorData.contentHashCode()
            result = 31 * result + signature.contentHashCode()
            result = 31 * result + (userHandle?.contentHashCode() ?: 0)
            result = 31 * result + (prfResults?.hashCode() ?: 0)
            return result
        }
    }

    /**
     * PRF extension input values for evaluation.
     */
    data class PrfInputs(
        /** The first PRF input salt. */
        val first: ByteArray?,
        /** The optional second PRF input salt. */
        val second: ByteArray?,
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false

            other as PrfInputs

            if (first != null) {
                if (other.first == null) return false
                if (!first.contentEquals(other.first)) return false
            } else if (other.first != null) return false
            if (second != null) {
                if (other.second == null) return false
                if (!second.contentEquals(other.second)) return false
            } else if (other.second != null) return false

            return true
        }

        override fun hashCode(): Int {
            var result = first?.contentHashCode() ?: 0
            result = 31 * result + (second?.contentHashCode() ?: 0)
            return result
        }
    }

    /**
     * PRF extension evaluation results.
     */
    data class PrfResults(
        /** The first PRF output. */
        val first: ByteArray,
        /** The optional second PRF output. */
        val second: ByteArray?,
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false

            other as PrfResults

            if (!first.contentEquals(other.first)) return false
            if (second != null) {
                if (other.second == null) return false
                if (!second.contentEquals(other.second)) return false
            } else if (other.second != null) return false

            return true
        }

        override fun hashCode(): Int {
            var result = first.contentHashCode()
            result = 31 * result + (second?.contentHashCode() ?: 0)
            return result
        }
    }

    /**
     * Base class for passkey-related errors.
     */
    sealed class PasskeyError(message: String) : Exception(message) {
        /**
         * Error indicating an invalid public key.
         */
        class InvalidPublicKey(message: String) : PasskeyError(message)

        /**
         * Error indicating an invalid private key.
         */
        class InvalidPrivateKey(message: String) : PasskeyError(message)

        /**
         * Error indicating an invalid JWK format.
         */
        class InvalidJWK(message: String) : PasskeyError(message)

        /**
         * Error indicating an invalid signature.
         */
        class InvalidSignature(message: String) : PasskeyError(message)

        /**
         * Error indicating CBOR encoding failure.
         */
        class CborEncodingFailed(message: String) : PasskeyError(message)

        /**
         * Error indicating none of the RP-requested algorithms are supported.
         */
        class UnsupportedAlgorithm(message: String) : PasskeyError(message)
    }
}
