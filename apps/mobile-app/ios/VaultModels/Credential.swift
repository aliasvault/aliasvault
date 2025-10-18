import Foundation

public struct Credential: Codable, Hashable, Equatable {
    public let id: UUID
    public let alias: Alias?
    public let service: Service
    public let username: String?
    public let notes: String?
    public let password: Password?
    public let passkeys: [Passkey]?  // Array of passkeys linked to this credential
    public let createdAt: Date
    public let updatedAt: Date
    public let isDeleted: Bool

    public init(
        id: UUID,
        alias: Alias?,
        service: Service,
        username: String?,
        notes: String?,
        password: Password?,
        passkeys: [Passkey]? = nil,
        createdAt: Date,
        updatedAt: Date,
        isDeleted: Bool
    ) {
        self.id = id
        self.alias = alias
        self.service = service
        self.username = username
        self.notes = notes
        self.password = password
        self.passkeys = passkeys
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.isDeleted = isDeleted
    }

    public static func == (lhs: Credential, rhs: Credential) -> Bool {
        return lhs.id == rhs.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

public struct Service: Codable, Hashable {
    public let id: UUID
    public let name: String?
    public let url: String?
    public let logo: Data?
    public let createdAt: Date
    public let updatedAt: Date
    public let isDeleted: Bool

    public init(
        id: UUID,
        name: String?,
        url: String?,
        logo: Data?,
        createdAt: Date,
        updatedAt: Date,
        isDeleted: Bool
    ) {
        self.id = id
        self.name = name
        self.url = url
        self.logo = logo
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.isDeleted = isDeleted
    }
}

public struct Password: Codable {
    public let id: UUID
    public let credentialId: UUID
    public let value: String
    public let createdAt: Date
    public let updatedAt: Date
    public let isDeleted: Bool

    public init(
        id: UUID,
        credentialId: UUID,
        value: String,
        createdAt: Date,
        updatedAt: Date,
        isDeleted: Bool
    ) {
        self.id = id
        self.credentialId = credentialId
        self.value = value
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.isDeleted = isDeleted
    }
}

public struct Alias: Codable, Hashable {
    public let id: UUID
    public let gender: String?
    public let firstName: String?
    public let lastName: String?
    public let nickName: String?
    public let birthDate: Date
    public let email: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let isDeleted: Bool

    public init(
        id: UUID,
        gender: String?,
        firstName: String?,
        lastName: String?,
        nickName: String?,
        birthDate: Date,
        email: String?,
        createdAt: Date,
        updatedAt: Date,
        isDeleted: Bool
    ) {
        self.id = id
        self.gender = gender
        self.firstName = firstName
        self.lastName = lastName
        self.nickName = nickName
        self.birthDate = birthDate
        self.email = email
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.isDeleted = isDeleted
    }
}
