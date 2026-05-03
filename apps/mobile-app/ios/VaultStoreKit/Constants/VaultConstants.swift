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
    static let serverVersionKey = "aliasvault_server_version"

    // Sync state keys (for offline sync and race detection)
    static let isDirtyKey = "aliasvault_is_dirty"
    static let mutationSequenceKey = "aliasvault_mutation_sequence"
    static let isSyncingKey = "aliasvault_is_syncing"

    static let defaultAutoLockTimeout: Int = 3600 // 1 hour in seconds

    // Trash retention. Soft-deleted items stay in the recycle bin for this many
    // days before the Rust pruner permanently removes them on the next sync.
    // This value is declared in other places as well, make sure to update them
    // when updating this value.
    static let trashRetentionDays: Int = 30
}
