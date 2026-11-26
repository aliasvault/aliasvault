import Foundation

/**
 * Passkey model representing a WebAuthn credential
 * Linked to a parent Item for UI display (service name, logo, etc.)
 */
public struct Passkey: Codable, Hashable, Equatable {
    public let id: UUID  // Passkey record ID
    public let credentialId: Data?  // WebAuthn credential ID; nil only on a row created before 0.32.0 and that didn't sync the vault yet (which upgrades this)
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

    /// The WebAuthn credential id the relying party knows: `credentialId`.
    public var webAuthnCredentialId: Data {
        // LEGACY: a row created before 0.32.0 has no credentialId until a pull or schema rebuild rewrites the local vault,
        // and uses the 16 bytes of `id`. TODO: remove once pre-0.32.0 clients are no longer supported.
        return credentialId ?? withUnsafeBytes(of: id.uuid) { Data($0) }
    }

    public static func == (lhs: Passkey, rhs: Passkey) -> Bool {
        return lhs.id == rhs.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}
