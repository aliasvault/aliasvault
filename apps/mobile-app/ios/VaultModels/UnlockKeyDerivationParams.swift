import Foundation

public struct UnlockKeyDerivationParams: Codable {
    public var encryptionType: String?
    public var encryptionSettings: String?
    public var salt: String?

    public init(encryptionType: String? = nil, encryptionSettings: String? = nil, salt: String? = nil) {
        self.encryptionType = encryptionType
        self.encryptionSettings = encryptionSettings
        self.salt = salt
    }
}
