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

    /// Authenticate the user using biometric authentication only
    /// Note: This method only handles biometric authentication.
    /// Returns true if authentication succeeded, false otherwise
    /// - Parameter title: The title for authentication. Optional, defaults to "Unlock Vault" context.
    public func issueBiometricAuthentication(title: String?) -> Bool {
        // Use title if provided, otherwise default
        let authReason = (title?.isEmpty == false) ? title! : "Unlock Vault"

        // Check if biometric authentication is enabled
        guard self.enabledAuthMethods.contains(.faceID) else {
            print("No authentication method enabled")
            return false
        }

        let context = LAContext()
        var error: NSError?

        // Check if biometric authentication is available
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            print("Biometric authentication not available: \(error?.localizedDescription ?? "unknown error")")
            return false
        }

        // Perform biometric authentication synchronously
        var authenticated = false
        let semaphore = DispatchSemaphore(value: 0)

        context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: authReason
        ) { success, authError in
            authenticated = success
            if let authError = authError {
                print("Biometric authentication failed: \(authError.localizedDescription)")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return authenticated
    }
}
