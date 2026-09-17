import Foundation

/// Constants used for userDefaults keys, keychain identifiers, and other shared
/// identifiers across the app, autofill extension, and shared frameworks.
public struct VaultConstants {
    public static let keychainService = "net.aliasvault.autofill"
    public static let keychainAccessGroup = "group.net.aliasvault.autofill"
    public static let userDefaultsSuite = "group.net.aliasvault.autofill"

    public static let vaultMetadataKey = "aliasvault_vault_metadata"
    public static let unlockKeyKey = "aliasvault_encryption_key"
    public static let encryptedDbFileName = "encrypted_db.sqlite"
    public static let authMethodsKey = "aliasvault_auth_methods"
    public static let autoLockTimeoutKey = "aliasvault_auto_lock_timeout"
    public static let unlockKeyDerivationParamsKey = "aliasvault_encryption_key_derivation_params"
    public static let accountKeyChainKey = "aliasvault_account_key_chain"
    public static let usernameKey = "aliasvault_username"
    public static let offlineModeKey = "aliasvault_offline_mode"
    public static let pinEnabledKey = "aliasvault_pin_enabled"
    public static let serverVersionKey = "aliasvault_server_version"
    public static let capabilitiesKey = "aliasvault_capabilities"
    public static let autofillCopyTotpOnFillKey = "aliasvault_autofill_copy_totp_on_fill"
    public static let isDirtyKey = "aliasvault_is_dirty"
    public static let mutationSequenceKey = "aliasvault_mutation_sequence"
    public static let isSyncingKey = "aliasvault_is_syncing"
    public static let syncLogsKey = "aliasvault_sync_logs"

    public static let defaultAutoLockTimeout: Int = 3600 // 1 hour in seconds

    // Trash retention. Soft-deleted items stay in the recycle bin for this many
    // days before the Rust pruner permanently removes them on the next sync.
    // This value is declared in other places as well, make sure to update them
    // when updating this value.
    public static let trashRetentionDays: Int = 30
}
