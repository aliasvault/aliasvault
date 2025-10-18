import Foundation
import LocalAuthentication
import Security
import VaultModels

/// Extension for the VaultStore class to handle authentication methods
extension VaultStore {
    /// Set the enabled authentication methods for the vault
    public func setAuthMethods(_ methods: AuthMethods) throws {
        self.enabledAuthMethods = methods
        self.userDefaults.set(methods.rawValue, forKey: VaultConstants.authMethodsKey)
        self.userDefaults.synchronize()

        if !self.enabledAuthMethods.contains(.faceID) {
            print("Face ID is now disabled, removing key from keychain immediately")
            do {
                try removeKeyFromKeychain()
                print("Successfully removed encryption key from keychain")
            } catch {
                print("Failed to remove encryption key from keychain: \(error)")
                throw error
            }
        } else {
            print("Face ID is now enabled, persisting encryption key in memory to keychain")
            do {
                guard let keyData = self.encryptionKey else {
                    print("Encryption key is empty, skipping keychain persistence")
                    return
                }

                try storeKeyInKeychain(keyData)
                print("Successfully stored encryption key in keychain")
            } catch {
                print("Failed to store encryption key in keychain: \(error)")
                throw error
            }
        }
    }

    /// Get the enabled authentication methods for the vault
    public func getAuthMethods() -> AuthMethods {
        return self.enabledAuthMethods
    }
}
