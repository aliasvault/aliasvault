import Foundation
import VaultModels

/// Constants used for userDefaults keys and other things.
public struct VaultConstants {
    static let keychainService = "net.aliasvault.autofill"
    static let keychainAccessGroup = "group.net.aliasvault.autofill"
    static let userDefaultsSuite = "group.net.aliasvault.autofill"

    static let vaultMetadataKey = "aliasvault_vault_metadata"
    static let encryptionKeyKey = "aliasvault_encryption_key"
    static let encryptedDbFileName = "encrypted_db.sqlite"
    static let authMethodsKey = "aliasvault_auth_methods"
    static let autoLockTimeoutKey = "aliasvault_auto_lock_timeout"
    static let encryptionKeyDerivationParamsKey = "aliasvault_encryption_key_derivation_params"
    static let usernameKey = "aliasvault_username"
    static let offlineModeKey = "aliasvault_offline_mode"
    static let pinEnabledKey = "aliasvault_pin_enabled"

    static let defaultAutoLockTimeout: Int = 3600 // 1 hour in seconds
}
