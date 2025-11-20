import Foundation

public struct VaultMetadata: Codable {
    public var publicEmailDomains: [String]?
    public var privateEmailDomains: [String]?
    public var hiddenPrivateEmailDomains: [String]?
    public var vaultRevisionNumber: Int

    public init(publicEmailDomains: [String]? = nil, privateEmailDomains: [String]? = nil, hiddenPrivateEmailDomains: [String]? = nil, vaultRevisionNumber: Int) {
        self.publicEmailDomains = publicEmailDomains
        self.privateEmailDomains = privateEmailDomains
        self.hiddenPrivateEmailDomains = hiddenPrivateEmailDomains
        self.vaultRevisionNumber = vaultRevisionNumber
    }
}
