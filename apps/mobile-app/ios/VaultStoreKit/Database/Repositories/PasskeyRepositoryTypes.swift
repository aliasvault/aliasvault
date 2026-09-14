import Foundation

/// Data class to hold Item info for Items without passkeys (internal VaultStoreKit type).
/// Used for showing existing credentials that can have a passkey added.
/// Note: VaultUI has its own ItemWithCredentialInfo type for UI usage.
public struct ItemWithCredentialInfoData {
    /// The item id.
    public let itemId: UUID
    /// The item name.
    public let serviceName: String?
    /// All URLs associated with this item (supports multi-value URL fields)
    public let urls: [String]
    /// The login.username value, if any.
    public let username: String?
    /// The login.email value, if any.
    public let email: String?
    /// Whether the item has a non-empty password.
    public let hasPassword: Bool
    /// When the item was created.
    public let createdAt: Date
    /// When the item was last updated.
    public let updatedAt: Date
    /// The manifest the item lives in, when known.
    public let manifestId: String?

    /// Create an entry from the mapped row values.
    public init(itemId: UUID, serviceName: String?, urls: [String], username: String?, email: String? = nil, hasPassword: Bool, createdAt: Date, updatedAt: Date, manifestId: String? = nil) {
        self.itemId = itemId
        self.serviceName = serviceName
        self.urls = urls
        self.username = username
        self.email = email
        self.hasPassword = hasPassword
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.manifestId = manifestId
    }
}

/// Errors that can occur in PasskeyRepository operations.
public enum PasskeyRepositoryError: Error {
    /// The passkey's public or private key is not valid UTF-8 JWK text.
    case invalidKeyData
    /// No live passkey with the given id exists.
    case passkeyNotFound
    /// No item with the given id exists.
    case itemNotFound
}
