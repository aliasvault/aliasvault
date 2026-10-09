package net.aliasvault.app.vaultstore.passkey

import uniffi.aliasvault_core.PasskeyPrfInputs
import uniffi.aliasvault_core.passkeyCreate
import uniffi.aliasvault_core.passkeyGetAssertion
import uniffi.aliasvault_core.passkeyGuidToBytes
import uniffi.aliasvault_core.passkeyPickAlgorithm

/**
 * The WebAuthn authenticator of the Android credential provider. Key generation, authenticator data, the
 * attestation object, signatures and PRF all run in the Rust core (core/rust/src/passkey).
 * Other platform implementations: PasskeyAuthenticator.swift (iOS), PasskeyAuthenticator.ts (browser extension).
 */
object PasskeyAuthenticator {
    /** COSE algorithm identifier for ES256 (ECDSA P-256 with SHA-256). */
    const val ALG_ES256 = -7

    /**
     * The 16-byte credential id of a passkey GUID.
     */
    @JvmStatic
    fun guidToBytes(guid: String): ByteArray = passkeyGuidToBytes(guid)

    /**
     * The first algorithm in the RP's pubKeyCredParams order that the authenticator supports; ES256 when the RP lists none.
     */
    @JvmStatic
    fun pickSupportedAlgorithm(params: List<Int>): Int {
        return passkeyPickAlgorithm(params.map { it.toLong() }).toInt()
    }

    /**
     * Create a new passkey (registration): the attestation object for the RP and the keys the vault stores.
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
        val created = passkeyCreate(credentialId, rpId, algorithm.toLong(), uvPerformed, enablePrf, prfInputs?.toRust())
        return PasskeyCreationResult(
            credentialId = credentialId,
            authenticatorData = created.authenticatorData,
            attestationObject = created.attestationObject,
            publicKey = created.publicKeyJwk.toByteArray(Charsets.UTF_8),
            publicKeyDER = created.publicKeySpki,
            privateKey = created.privateKeyJwk.toByteArray(Charsets.UTF_8),
            rpId = rpId,
            userId = userId,
            userName = userName,
            userDisplayName = userDisplayName,
            prfSecret = created.prfSecret,
            prfResults = created.prfResults?.let { PrfResults(it.first, it.second) },
        )
    }

    /**
     * Create an assertion (authentication) signed with the stored private key JWK.
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
        val assertion = passkeyGetAssertion(rpId, clientDataHash, String(privateKeyJWK, Charsets.UTF_8), uvPerformed, prfInputs?.toRust(), prfSecret)
        return PasskeyAssertionResult(
            credentialId = credentialId,
            authenticatorData = assertion.authenticatorData,
            signature = assertion.signature,
            userHandle = userId,
            prfResults = assertion.prfResults?.let { PrfResults(it.first, it.second) },
        )
    }

    private fun PrfInputs.toRust(): PasskeyPrfInputs = PasskeyPrfInputs(first, second)

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
}
