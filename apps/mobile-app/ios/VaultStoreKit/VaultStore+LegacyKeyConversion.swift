import Foundation

/// Legacy conversion of a stored unlock key to the Account Key.
///
/// The keychain and the PIN protect the Account Key, the one secret an unlocked session holds. Before 0.31.0 they
/// protected the unlock key (the Argon2id output of the master password). A key stored then (a 0.30.x install, or an
/// account upgraded on another device) still opens the account key chain, which yields the Account Key; these helpers
/// then store the Account Key in its place, once. For an account without a key chain the stored key is the vault key.
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
