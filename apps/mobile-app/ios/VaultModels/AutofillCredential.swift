import Foundation

/// AutofillCredential is a purpose-specific model for iOS Autofill functionality.
/// It provides a simplified view of Item data optimized for password/passkey autofill.
/// This replaces the legacy Credential model which was based on the old data structure.
public struct AutofillCredential: Codable, Hashable, Equatable {
    public let id: UUID
    public let serviceName: String?
    public let serviceUrl: String?
    public let logo: Data?
    public let username: String?
    public let email: String?
    public let password: String?
    public let notes: String?
    public let passkeys: [Passkey]?
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: UUID,
        serviceName: String?,
        serviceUrl: String?,
        logo: Data?,
        username: String?,
        email: String?,
        password: String?,
        notes: String?,
        passkeys: [Passkey]?,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.serviceName = serviceName
        self.serviceUrl = serviceUrl
        self.logo = logo
        self.username = username
        self.email = email
        self.password = password
        self.notes = notes
        self.passkeys = passkeys
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Initialize from an Item model.
    /// - Parameters:
    ///   - item: The Item to convert from
    ///   - passkeys: Optional passkeys associated with this item
    public init(from item: Item, passkeys: [Passkey]? = nil) {
        self.id = item.id
        self.serviceName = item.name
        self.serviceUrl = item.url
        self.logo = item.logo
        self.username = item.username
        self.email = item.email
        self.password = item.password
        self.notes = item.getFieldValue(FieldKey.notesContent)
        self.passkeys = passkeys
        self.createdAt = item.createdAt
        self.updatedAt = item.updatedAt
    }

    public static func == (lhs: AutofillCredential, rhs: AutofillCredential) -> Bool {
        return lhs.id == rhs.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    // MARK: - Autofill Helpers

    /// Returns username or email, prioritizing username.
    /// Used for autofill identifier display and form filling.
    public var identifier: String {
        if let username = username, !username.isEmpty {
            return username
        }
        if let email = email, !email.isEmpty {
            return email
        }
        return ""
    }

    /// Returns true if this credential has a password value.
    public var hasPassword: Bool {
        guard let password = password else { return false }
        return !password.isEmpty
    }

    /// Returns true if this credential has passkeys.
    public var hasPasskeys: Bool {
        guard let passkeys = passkeys else { return false }
        return !passkeys.isEmpty
    }
}
