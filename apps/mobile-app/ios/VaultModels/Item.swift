import Foundation

/// Item type representing vault entries in the new field-based data model.
public struct Item: Codable, Hashable, Equatable {
    public let id: UUID
    public let name: String?
    public let itemType: String
    public let logo: Data?
    public let folderId: UUID?
    public let folderPath: String?
    public let fields: [ItemField]
    public let hasPasskey: Bool
    public let hasAttachment: Bool
    public let hasTotp: Bool
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: UUID,
        name: String?,
        itemType: String,
        logo: Data?,
        folderId: UUID?,
        folderPath: String?,
        fields: [ItemField],
        hasPasskey: Bool,
        hasAttachment: Bool,
        hasTotp: Bool,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.name = name
        self.itemType = itemType
        self.logo = logo
        self.folderId = folderId
        self.folderPath = folderPath
        self.fields = fields
        self.hasPasskey = hasPasskey
        self.hasAttachment = hasAttachment
        self.hasTotp = hasTotp
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public static func == (lhs: Item, rhs: Item) -> Bool {
        return lhs.id == rhs.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    // MARK: - Field Accessors

    /// Get the value of a field by its key.
    public func getFieldValue(_ fieldKey: String) -> String? {
        return fields.first { $0.fieldKey == fieldKey }?.value
    }

    /// Get the URL field value (login.url).
    public var url: String? {
        return getFieldValue(FieldKey.loginUrl)
    }

    /// Get the username field value (login.username).
    public var username: String? {
        return getFieldValue(FieldKey.loginUsername)
    }

    /// Get the password field value (login.password).
    public var password: String? {
        return getFieldValue(FieldKey.loginPassword)
    }

    /// Get the email field value (login.email).
    public var email: String? {
        return getFieldValue(FieldKey.loginEmail)
    }

    /// Get the first name field value (alias.first_name).
    public var firstName: String? {
        return getFieldValue(FieldKey.aliasFirstName)
    }

    /// Get the last name field value (alias.last_name).
    public var lastName: String? {
        return getFieldValue(FieldKey.aliasLastName)
    }
}

/// Field value within an item.
public struct ItemField: Codable, Hashable {
    public let fieldKey: String
    public let label: String
    public let fieldType: String
    public let value: String
    public let isHidden: Bool
    public let displayOrder: Int
    public let isCustomField: Bool
    public let enableHistory: Bool

    public init(
        fieldKey: String,
        label: String,
        fieldType: String,
        value: String,
        isHidden: Bool,
        displayOrder: Int,
        isCustomField: Bool,
        enableHistory: Bool
    ) {
        self.fieldKey = fieldKey
        self.label = label
        self.fieldType = fieldType
        self.value = value
        self.isHidden = isHidden
        self.displayOrder = displayOrder
        self.isCustomField = isCustomField
        self.enableHistory = enableHistory
    }
}
