import Foundation

/**
 * Passkey model representing a WebAuthn credential
 * Linked to a parent Item for UI display (service name, logo, etc.)
 */
public struct Passkey: Codable, Hashable, Equatable {
    public let id: UUID  // Passkey record ID; the fallback WebAuthn credential ID when credentialId is nil
    public let credentialId: Data?  // WebAuthn credential ID; nil falls back to the 16 bytes of id
    public let parentItemId: UUID  // Parent Item UUID (AliasVault internal ID)
    public let rpId: String  // Relying party identifier (domain)
    public let userHandle: Data?  // User ID/handle from RP (optional)
    public let userName: String?  // User-visible identifier (typically email)
    public let publicKey: Data  // JWK format (JSON)
    public let privateKey: Data  // JWK format (JSON), encrypted in storage
    public let prfKey: Data?  // PRF secret (32 bytes) if extension enabled
    public let displayName: String  // User-facing name for this passkey
    public let createdAt: Date
    public let updatedAt: Date
    public let isDeleted: Bool
    public let manifestId: String?
    public let additionalData: Data?

    public init(
        id: UUID,
        parentItemId: UUID,
        rpId: String,
        userHandle: Data?,
        userName: String?,
        publicKey: Data,
        privateKey: Data,
        prfKey: Data?,
        displayName: String,
        createdAt: Date,
        updatedAt: Date,
        isDeleted: Bool,
        manifestId: String? = nil,
        additionalData: Data? = nil,
        credentialId: Data? = nil
    ) {
        self.id = id
        self.credentialId = credentialId
        self.parentItemId = parentItemId
        self.rpId = rpId
        self.userHandle = userHandle
        self.userName = userName
        self.publicKey = publicKey
        self.privateKey = privateKey
        self.prfKey = prfKey
        self.displayName = displayName
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.isDeleted = isDeleted
        self.manifestId = manifestId
        self.additionalData = additionalData
    }

    /// The WebAuthn credential id the relying party knows: `credentialId`, or the 16 bytes of `id` when it is nil.
    public var webAuthnCredentialId: Data {
        return credentialId ?? withUnsafeBytes(of: id.uuid) { Data($0) }
    }

    public static func == (lhs: Passkey, rhs: Passkey) -> Bool {
        return lhs.id == rhs.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}
