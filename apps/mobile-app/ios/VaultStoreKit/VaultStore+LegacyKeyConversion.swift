import Foundation

/// Legacy conversion of a stored unlock key to the Account Key.
///
/// Before 0.31.0 the keychain and the PIN protected the unlock key (the Argon2id output of the master password). Since
/// then they protect the Account Key. A key stored before the account had a key chain (a 0.30.x install, or an account
/// upgraded on another device) still opens the chain; these helpers then store the Account Key in its place, once.
///
/// TODO: remove once accounts without a key chain (pre-0.31.0) are no longer supported.
extension VaultStore {
    /// Re-encrypt the PIN with the Account Key when it still protected an unlock key.
    internal func convertLegacyPinKey(pin: String, pinKey: Data, accountKey: Data) {
        guard accountKey != pinKey else { return }
        do {
            try encryptKeyWithPin(accountKey, pin: pin)
        } catch {
            print("Could not re-encrypt the PIN key, will retry on the next PIN unlock: \(error)")
        }
    }

    /// Store the Account Key in the keychain when it still held an unlock key.
    internal func convertLegacyKeychainKey(keychainKey: Data, accountKey: Data) {
        guard accountKey != keychainKey, enabledAuthMethods.contains(.faceID), isKeystoreAvailable() else { return }
        try? storeKeyInKeychain(accountKey)
    }
}
