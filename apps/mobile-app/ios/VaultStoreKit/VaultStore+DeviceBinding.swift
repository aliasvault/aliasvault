import Foundation
import LocalAuthentication
import Security
import VaultModels
import VaultUtils

/// Keeps the shared container bound to this device, to prevent issues and detect when the shared container is copied from another device (transfer to new iPhone).
extension VaultStore {
    /// Keychain account of the device marker.
    private static let deviceMarkerKey = "aliasvault_device_marker"

    /// Clear the vault and session when the shared container was copied from another device, and turn off unlock
    /// methods whose keychain item is gone.
    internal func clearDataCopiedFromOtherDevice() {
        switch keychainItemStatus(account: Self.deviceMarkerKey) {
        case errSecSuccess:
            break
        case errSecItemNotFound:
            if userDefaults.bool(forKey: VaultConstants.deviceMarkerSetKey) {
                print("Shared container was copied from another device, clearing the vault and session")
                try? clearSession()
            }
            // A container from before the marker existed is trusted once.
            if storeDeviceMarker() {
                userDefaults.set(true, forKey: VaultConstants.deviceMarkerSetKey)
            }
        default:
            // The keychain is not readable yet (before the first unlock after a reboot), decide on the next launch.
            return
        }

        disableUnlockMethodsWithoutKeychainItem()
    }

    /// Turn off Face ID and PIN when the keychain item they unlock with is gone, so unlocking falls back to the password.
    private func disableUnlockMethodsWithoutKeychainItem() {
        let enabledAuthMethods = AuthMethods(rawValue: userDefaults.integer(forKey: VaultConstants.authMethodsKey))
        if enabledAuthMethods.contains(.faceID) && keychainItemStatus(account: VaultConstants.accountKeyKey) == errSecItemNotFound {
            print("Face ID key not found in keychain, turning off Face ID unlock")
            var methods = enabledAuthMethods
            methods.remove(.faceID)
            try? setAuthMethods(methods)
        }
        if isPinEnabled() && keychainItemStatus(account: Self.pinEncryptedKeyKey) == errSecItemNotFound {
            print("PIN data not found in keychain, turning off PIN unlock")
            try? removeAndDisablePin()
        }
    }

    /// Whether a keychain item exists, checked without a biometric prompt (`errSecInteractionNotAllowed` means it exists).
    private func keychainItemStatus(account: String) -> OSStatus {
        let context = LAContext()
        context.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup,
            kSecReturnAttributes as String: true,
            kSecUseAuthenticationContext as String: context,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecInteractionNotAllowed ? errSecSuccess : status
    }

    /// Store the device marker, which never leaves this device.
    private func storeDeviceMarker() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: Self.deviceMarkerKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup,
            kSecValueData as String: Data([1]),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecDuplicateItem
    }
}
