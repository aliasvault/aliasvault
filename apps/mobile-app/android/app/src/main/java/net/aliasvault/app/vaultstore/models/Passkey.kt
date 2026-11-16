package net.aliasvault.app.vaultstore.models

import java.nio.ByteBuffer
import java.util.Date
import java.util.UUID

/**
 * Passkey model representing a WebAuthn credential.
 * Linked to a parent Item for UI display (service name, logo, etc.).
 *
 * This is a Kotlin port of the iOS Swift implementation:
 * - Reference: apps/mobile-app/ios/VaultModels/Passkey.swift
 */
data class Passkey(
    /**
     * Passkey record ID; the fallback WebAuthn credential ID when credentialId is null.
     */
    val id: UUID,

    /**
     * Parent Item UUID (AliasVault internal ID).
     */
    val parentItemId: UUID,

    /**
     * The manifest the passkey and its item belong to. Null on a passkey not yet written: the INSERT stamps
     * it from the item.
     */
    val manifestId: String?,

    /**
     * Relying party identifier (domain).
     */
    val rpId: String,

    /**
     * User ID/handle from RP (optional).
     */
    val userHandle: ByteArray?,

    /**
     * User-visible identifier (typically email).
     */
    val userName: String?,

    /**
     * JWK format (JSON), encrypted in storage.
     */
    val publicKey: ByteArray,

    /**
     * JWK format (JSON), encrypted in storage.
     */
    val privateKey: ByteArray,

    /**
     * PRF secret (32 bytes) if extension enabled.
     */
    val prfKey: ByteArray?,

    /**
     * User-facing name for this passkey.
     */
    val displayName: String,

    /**
     * Opaque extra data, not written by any client today.
     */
    val additionalData: ByteArray? = null,

    /**
     * WebAuthn credential ID; null falls back to the 16 bytes of id.
     */
    val credentialId: ByteArray? = null,

    /**
     * The creation date of the passkey.
     */
    val createdAt: Date,

    /**
     * The update date of the passkey.
     */
    val updatedAt: Date,

    /**
     * Whether the passkey is deleted.
     */
    val isDeleted: Boolean,
) {
    /**
     * The WebAuthn credential id the relying party knows: credentialId, or the 16 bytes of id when it is null.
     */
    fun webAuthnCredentialId(): ByteArray {
        return credentialId ?: ByteBuffer.allocate(16).putLong(id.mostSignificantBits).putLong(id.leastSignificantBits).array()
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as Passkey

        if (id != other.id) return false
        if (parentItemId != other.parentItemId) return false
        if (manifestId != other.manifestId) return false
        if (rpId != other.rpId) return false
        if (userHandle != null) {
            if (other.userHandle == null) return false
            if (!userHandle.contentEquals(other.userHandle)) return false
        } else if (other.userHandle != null) return false
        if (userName != other.userName) return false
        if (!publicKey.contentEquals(other.publicKey)) return false
        if (!privateKey.contentEquals(other.privateKey)) return false
        if (prfKey != null) {
            if (other.prfKey == null) return false
            if (!prfKey.contentEquals(other.prfKey)) return false
        } else if (other.prfKey != null) return false
        if (displayName != other.displayName) return false
        if (additionalData != null) {
            if (other.additionalData == null) return false
            if (!additionalData.contentEquals(other.additionalData)) return false
        } else if (other.additionalData != null) return false
        if (credentialId != null) {
            if (other.credentialId == null) return false
            if (!credentialId.contentEquals(other.credentialId)) return false
        } else if (other.credentialId != null) return false
        if (createdAt != other.createdAt) return false
        if (updatedAt != other.updatedAt) return false
        if (isDeleted != other.isDeleted) return false

        return true
    }

    override fun hashCode(): Int {
        var result = id.hashCode()
        result = 31 * result + parentItemId.hashCode()
        result = 31 * result + (manifestId?.hashCode() ?: 0)
        result = 31 * result + rpId.hashCode()
        result = 31 * result + (userHandle?.contentHashCode() ?: 0)
        result = 31 * result + (userName?.hashCode() ?: 0)
        result = 31 * result + publicKey.contentHashCode()
        result = 31 * result + privateKey.contentHashCode()
        result = 31 * result + (prfKey?.contentHashCode() ?: 0)
        result = 31 * result + displayName.hashCode()
        result = 31 * result + (additionalData?.contentHashCode() ?: 0)
        result = 31 * result + (credentialId?.contentHashCode() ?: 0)
        result = 31 * result + createdAt.hashCode()
        result = 31 * result + updatedAt.hashCode()
        result = 31 * result + isDeleted.hashCode()
        return result
    }
}
