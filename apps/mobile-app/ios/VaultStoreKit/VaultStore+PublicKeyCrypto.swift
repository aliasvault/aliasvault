import Foundation
import RustCoreFramework

/// Extension for the VaultStore class to handle RSA public key encryption
extension VaultStore {
    /// Encrypts the Account Key with a mobile login request's RSA public key (JWK JSON) for the receiving client, as base64.
    /// Only works while the vault is unlocked (Account Key in memory).
    public func encryptAccountKeyForMobileLogin(publicKeyJWK: String) throws -> String {
        let accountKey = try getAccountKey()
        return try RustCoreFramework.mobileLoginEncryptAccountKey(accountKey: accountKey, publicKeyJwk: publicKeyJWK)
    }
}
