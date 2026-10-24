import Foundation
import LocalAuthentication
import Security
import RustCoreFramework
import VaultUtils

/// Extension for the VaultStore class to handle encryption/decryption
extension VaultStore {
    /// Derives a key from a password using Argon2Id
    public func deriveKeyFromPassword(_ password: String,
                                     salt: String,
                                     encryptionType: String,
                                     encryptionSettings: String) throws -> Data {
        // Both types derive the unlock key with Argon2id; they differ only in how the SRP input is made from it.
        guard encryptionType == "Argon2Id" || encryptionType == "Argon2IdHkdf" else {
            throw NSError(domain: "VaultStore", code: 13, userInfo: [NSLocalizedDescriptionKey: "Unsupported encryption type: \(encryptionType)"])
        }

        guard let derivedKey = try? RustCoreFramework.argon2DeriveKey(password: password, salt: salt, encryptionSettings: encryptionSettings) else {
            throw NSError(domain: "VaultStore", code: 17, userInfo: [NSLocalizedDescriptionKey: "Argon2 hashing failed"])
        }

        return derivedKey
    }

    /// Open a session in memory with the Account Key a device unlock method restored, without keychain persistence.
    public func storeAccountKeyInMemory(base64Key: String) throws {
        self.accountKey = try openKeyChainWithAccountKey(try keyData(base64Key)).accountKey
        print("Opened session in memory only (no keychain persistence)")
    }

    /// Open a session with the unlock key of a password login; the session keeps the Account Key the chain yields and,
    /// when asked, persists it to the keychain if Face ID is enabled.
    public func openSessionWithUnlockKey(base64Key: String, persistToKeychain: Bool) throws {
        self.accountKey = try openKeyChainWithUnlockKey(try keyData(base64Key)).accountKey
        if persistToKeychain {
            try persistAccountKeyIfBiometricsEnabled()
        }
    }

    /// The 32 bytes of a base64 key.
    private func keyData(_ base64Key: String) throws -> Data {
        guard let keyData = Data(base64Encoded: base64Key) else {
            throw NSError(domain: "VaultStore", code: 6, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 key"])
        }
        guard keyData.count == 32 else {
            throw NSError(domain: "VaultStore", code: 7, userInfo: [NSLocalizedDescriptionKey: "Invalid key length. Expected 32 bytes"])
        }
        return keyData
    }

    /// Clear the Account Key from memory.
    /// This forces getEncryptionKey() to fetch the Account Key from keychain on next access.
    public func clearEncryptionKeyFromMemory() {
        self.accountKey = nil
        clearLastSuccessfulAuth()
        print("Cleared Account Key from memory")
    }

    /// Open a session with the Account Key a device unlock method restored AND persist it to the keychain if Face ID is enabled.
    public func storeAccountKey(base64Key: String) throws {
        try storeAccountKeyInMemory(base64Key: base64Key)
        try persistAccountKeyIfBiometricsEnabled()
    }

    /// Persist the session's Account Key to the keychain when Face ID is enabled and the keystore is available.
    private func persistAccountKeyIfBiometricsEnabled() throws {
        if self.enabledAuthMethods.contains(.faceID), let keyData = self.accountKey {
            if isKeystoreAvailable() {
                try storeKeyInKeychain(keyData)
                print("Opened session and persisted Account Key to keychain")
            } else {
                print("Opened session in memory (keystore unavailable - device passcode not set, skipping keychain)")
            }
        } else {
            print("Opened session in memory (Face ID not enabled, skipping keychain)")
        }
    }

    /// Store the key derivation parameters used for deriving the encryption key from the plain text password
    public func storeUnlockKeyDerivationParams(_ keyDerivationParams: String) throws {
        // Store the key derivation params in memory
        self.keyDerivationParams = keyDerivationParams

        // Store the key derivation params in UserDefaults
        self.userDefaults.set(keyDerivationParams, forKey: VaultConstants.unlockKeyDerivationParamsKey)

        print("Stored key derivation params in UserDefaults")
    }

    /// Get the key derivation parameters used for deriving the encryption key from the plain text password
    public func getUnlockKeyDerivationParams() -> String? {
        return self.keyDerivationParams
    }

    /// Store the account-key chain the native password unlock unwraps.
    public func storeAccountKeyChain(_ chainJson: String?) {
        if let chainJson = chainJson, !chainJson.isEmpty {
            self.userDefaults.set(chainJson, forKey: VaultConstants.accountKeyChainKey)
        } else {
            self.userDefaults.removeObject(forKey: VaultConstants.accountKeyChainKey)
        }
        self.userDefaults.synchronize()
    }

    /// The stored account-key chain JSON, or nil for a legacy account.
    public func getAccountKeyChain() -> String? {
        return self.userDefaults.string(forKey: VaultConstants.accountKeyChainKey)
    }

    /// The keys an opened account key chain gives.
    internal struct SessionKeys {
        /// The key that encrypts and decrypts the vault.
        let vaultEncryptionKey: Data
        /// The account private key (JWK), nil when the account has no keypair or it does not open.
        let accountPrivateKey: String?
        /// The Account Key to keep, in place of the key the chain was opened with.
        let accountKey: Data
    }

    /// The cached account key chain as the server sent it.
    private struct CachedKeyChain {
        let encryptedAccountKey: String
        let encryptedVek: String
        /// Nil when the account has no keypair; a private key that does not open must not fail the unlock, grants then stay closed.
        let encryptedAccountPrivateKey: String?
    }

    /// The cached account key chain, nil for an account without one (its key is the vault key).
    private func cachedKeyChain() throws -> CachedKeyChain? {
        guard let chainJson = getAccountKeyChain(),
              let chainData = chainJson.data(using: .utf8),
              let chain = try? JSONSerialization.jsonObject(with: chainData) as? [String: Any],
              let encryptedAccountKey = chain["encryptedAccountKey"] as? String, !encryptedAccountKey.isEmpty else {
            return nil
        }
        guard let encryptedVek = chain["encryptedVek"] as? String, !encryptedVek.isEmpty else {
            throw NSError(domain: "VaultStore", code: 41, userInfo: [NSLocalizedDescriptionKey: "Account key chain is missing the encrypted VEK"])
        }
        let encryptedPrivateKey = (chain["encryptedAccountPrivateKey"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return CachedKeyChain(encryptedAccountKey: encryptedAccountKey, encryptedVek: encryptedVek, encryptedAccountPrivateKey: encryptedPrivateKey)
    }

    /// Open the cached account key chain with the unlock key of a password login (Rust `openKeyChainWithUnlockKey`).
    /// Other platform implementations: VaultCrypto.openKeyChainWithUnlockKey (Android), VaultKeyService.openKeyChain (core/client).
    internal func openKeyChainWithUnlockKey(_ unlockKey: Data) throws -> SessionKeys {
        return try openKeyChain(unlockKey) { chain in
            try RustCoreFramework.openKeyChainWithUnlockKey(unlockKey: unlockKey, encryptedAccountKey: chain.encryptedAccountKey, encryptedVek: chain.encryptedVek, encryptedAccountPrivateKey: chain.encryptedAccountPrivateKey)
        }
    }

    /// Open the cached account key chain with the Account Key (Rust `openKeyChainWithAccountKey`).
    /// Other platform implementations: VaultCrypto.openKeyChainWithAccountKey (Android), VaultKeyService.openKeyChain (core/client).
    internal func openKeyChainWithAccountKey(_ accountKey: Data) throws -> SessionKeys {
        return try openKeyChain(accountKey) { chain in
            try RustCoreFramework.openKeyChainWithAccountKey(accountKey: accountKey, encryptedVek: chain.encryptedVek, encryptedAccountPrivateKey: chain.encryptedAccountPrivateKey)
        }
    }

    /// Open the cached chain through `open`; without a chain `key` is the vault key. Either rejection is E-206, an
    /// unreadable chain E-207 (the Account Key opened, so never a wrong password).
    private func openKeyChain(_ key: Data, _ open: (CachedKeyChain) throws -> KeyChainKeys) throws -> SessionKeys {
        guard let chain = try cachedKeyChain() else {
            return SessionKeys(vaultEncryptionKey: key, accountPrivateKey: nil, accountKey: key)
        }
        do {
            let keys = try open(chain)
            return SessionKeys(vaultEncryptionKey: keys.vaultEncryptionKey, accountPrivateKey: keys.accountPrivateKey, accountKey: keys.accountKey)
        } catch KeyChainError.UnlockKeyRejected, KeyChainError.AccountKeyRejected {
            throw AppError.unlockKeyRejected
        } catch KeyChainError.KeyChainUnreadable(let message) {
            throw AppError.keyChainUnreadable(message: message)
        }
    }

    /// Decrypt an invitation's vault name with the session's account private key, or nil when the session holds no private key
    /// or it does not open the name.
    public func decryptManifestInvitationName(_ encryptedName: String, manifestId: String) -> String? {
        guard let privateKey = accountPrivateKey else {
            return nil
        }
        return try? RustCoreFramework.decryptManifestInvitationName(encryptedName: encryptedName, manifestId: manifestId, privateKeyJwk: privateKey)
    }

    /// The account fingerprint of the account's own signing key, derived from the private key the sync engine cached, or nil
    /// while the vault is locked or the account has no signing key yet.
    /// Other platform implementations: SharingService.ownAccountFingerprint (core/client), VaultStore.signingKeyFingerprint (Android).
    public func signingKeyFingerprint() -> String? {
        guard let accountKeyBase64 = accountKeyBase64, let accountKey = Data(base64Encoded: accountKeyBase64),
              let encryptedSigningPrivateKey = VaultSyncEngine.persistedState(forKey: VaultSyncEngine.encryptedSigningPrivateKeyStateKey, in: userDefaults) as? String else {
            return nil
        }
        return try? RustCoreFramework.accountSigningKeyFingerprint(encryptedSigningPrivateKey: encryptedSigningPrivateKey, accountKey: accountKey)
    }

    /// Verify the password and return its unlock key (base64) if correct. Callers derive the SRP input from it for the
    /// account's encryption type; `storeAccountKey` turns it into the Account Key.
    public func verifyPassword(_ password: String) -> String? {
        do {
            // Get encryption key derivation parameters
            guard let paramsString = getUnlockKeyDerivationParams(),
                  let paramsData = paramsString.data(using: .utf8),
                  let params = try? JSONSerialization.jsonObject(with: paramsData) as? [String: Any],
                  let salt = params["salt"] as? String,
                  let encryptionType = params["encryptionType"] as? String,
                  let encryptionSettings = params["encryptionSettings"] as? String else {
                return nil
            }

            // Derive the unlock key from the password and unwrap the chain; a wrong password fails the unwrap.
            let derivedKey = try deriveKeyFromPassword(password, salt: salt, encryptionType: encryptionType, encryptionSettings: encryptionSettings)
            _ = try openKeyChainWithUnlockKey(derivedKey)
            return derivedKey.base64EncodedString()
        } catch {
            // Password incorrect or the key chain did not open
            return nil
        }
    }

    /// Encrypt the SQLite database bytes into the stored vault blob (base64) with the encryption key.
    internal func encryptVaultBlob(_ sqliteBytes: Data) throws -> String {
        return try RustCoreFramework.vaultBlobEncrypt(sqliteBytes: sqliteBytes, key: try getEncryptionKey())
    }

    /// Decrypt the stored vault blob (base64) into the SQLite database bytes with the encryption key.
    internal func decryptVaultBlob(_ encryptedBlob: String) throws -> Data {
        let encryptionKey = try getEncryptionKey()
        do {
            let decryptedData = try RustCoreFramework.vaultBlobDecrypt(encryptedBlob: encryptedBlob, key: encryptionKey)

            /*
             * If the decryption succeeds, try to persist the Account Key in the keychain.
             * This makes sure that on future password unlock attempts, only successful decryptions
             * will be remembered and used so failed re-authentication attempts won't overwrite
             * a previous successful decryption key stored in the keychain.
             *
             * We only attempt this if Face ID is enabled AND keystore is available.
             * If keystore is not available (no device passcode), we silently skip this step.
             */
            if self.enabledAuthMethods.contains(.faceID) && isKeystoreAvailable(), let accountKey = self.accountKey {
                do {
                    try storeKeyInKeychain(accountKey)
                } catch {
                    // Don't fail the decryption if we can't store to keychain
                    // This can happen if device passcode is removed after Face ID was enabled
                    print("Warning: Could not persist encryption key to keychain: \(error)")
                }
            }

            return decryptedData
        } catch {
            print("Decryption failed: \(error)")

            // Note: We intentionally do not clear the encryption key here.
            // The key may be valid for a different vault (e.g., after password change
            // during login, the new key is stored but the old vault can't be decrypted).
            // Clearing it would break the subsequent sync that downloads the new vault.

            throw NSError(domain: "VaultStore", code: 12, userInfo: [NSLocalizedDescriptionKey: "Decryption failed"])
        }
    }

    /// Check if biometric authentication is enabled and available
    /// Returns true if Face ID is enabled in settings AND the device supports biometric authentication
    public func isBiometricAuthEnabled() -> Bool {
        // Check if Face ID is enabled in app settings
        guard self.enabledAuthMethods.contains(.faceID) else {
            return false
        }

        #if targetEnvironment(simulator)
            // In simulator, always return true if Face ID is enabled in settings
            return true
        #else
            // Check if device supports biometric authentication
            let context = LAContext()
            var error: NSError?
            return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        #endif
    }

    /// The vault encryption key as base64, for the sync engine.
    public func getEncryptionKeyBase64() throws -> String {
        return try getEncryptionKey().base64EncodedString()
    }

    /// Get the encryption key - the key used to encrypt and decrypt the vault.
    internal func getEncryptionKey() throws -> Data {
        let key = try getAccountKey()
        // This legacy key conversion call can be removed once all clients have updated to 0.31.0+.
        let keys = try openStoredKey(key)
        if keys.accountKey != key {
            // A legacy key, see `VaultStore+LegacyKeyConversion`.
            self.accountKey = keys.accountKey
            convertLegacyKeychainKey(keychainKey: key, accountKey: keys.accountKey)
        }
        return keys.vaultEncryptionKey
    }

    /// Get the Account Key, opening the session from the keychain when none is in memory.
    internal func getAccountKey() throws -> Data {
        if let key = self.accountKey {
            return key
        }

        try openSessionFromKeychain()
        guard let key = self.accountKey else {
            throw AppError.keystoreKeyNotFound
        }
        return key
    }

    /// Open a session with the Account Key the keychain holds, behind a biometric prompt.
    private func openSessionFromKeychain() throws {
        // Key not in memory - check if we should try keychain retrieval
        // Only attempt keychain retrieval if Face ID is enabled AND keystore is available
        if self.enabledAuthMethods.contains(.faceID) && isKeystoreAvailable() {
            let context = LAContext()
            var error: NSError?

            #if targetEnvironment(simulator)
                print("Simulator detected, skipping biometric policy evaluation check and continuing with key retrieval from keychain")
            #else
                if !context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
                    // Map LAError codes to specific error types for better debugging
                    if let laError = error as? LAError {
                        switch laError.code {
                        case .biometryNotAvailable:
                            throw AppError.biometricNotAvailable
                        case .biometryNotEnrolled:
                            throw AppError.biometricNotEnrolled
                        case .biometryLockout:
                            throw AppError.biometricLockout
                        default:
                            print("LAError code: \(laError.code.rawValue), description: \(laError.localizedDescription)")
                            throw AppError.biometricFailed
                        }
                    }
                    throw AppError.biometricFailed
                }
            #endif

            print("Attempting to get encryption key from keychain as Face ID is enabled and keystore is available")
            let keyData: Data
            do {
                keyData = try retrieveKeyFromKeychain(context: context)
            } catch let vaultError as AppError {
                throw vaultError
            } catch {
                throw AppError.keystoreKeyNotFound
            }

            do {
                // This legacy key conversion call can be removed once all clients have updated to 0.31.0+.
                let accountKey = try openStoredKey(keyData).accountKey
                self.accountKey = accountKey
                convertLegacyKeychainKey(keychainKey: keyData, accountKey: accountKey)
            } catch let vaultError as AppError {
                print("The Account Key from the keychain does not open the account key chain: \(vaultError.message)")
                throw vaultError
            } catch {
                print("The Account Key from the keychain does not open the account key chain: \(error)")
                throw AppError.unlockKeyRejected
            }
            return
        }

        // Key not in memory and cannot retrieve from keychain
        // This happens when:
        // 1. Password-only auth (Face ID not enabled)
        // 2. Face ID enabled but keystore unavailable (no device passcode)
        // 3. Face ID enabled but key was never stored (e.g., during initial login)
        throw AppError.keystoreKeyNotFound
    }

    /// Check if keystore is available (requires device passcode to be set)
    public func isKeystoreAvailable() -> Bool {
        // Try to create access control with passcode requirement
        // If this fails, it means no passcode is set
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [],
            nil
        ) else {
            return false
        }

        // Try a test keychain operation
        let testKey = "test_keystore_availability"
        let testData = Data([0x00])
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: testKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup,
            kSecValueData as String: testData,
            kSecAttrAccessControl as String: accessControl
        ]

        // Clean up any existing test item
        SecItemDelete(query as CFDictionary)

        // Try to add - if it succeeds, keystore is available
        let status = SecItemAdd(query as CFDictionary, nil)

        // Clean up test item
        SecItemDelete(query as CFDictionary)

        return status == errSecSuccess
    }

    /// Store the Account Key in the keychain
    internal func storeKeyInKeychain(_ keyData: Data) throws {
        // Check if keystore is available (device passcode must be set)
        guard isKeystoreAvailable() else {
            print("Cannot store key in keychain: device passcode not set")
            throw AppError.biometricNotAvailable
        }

        // Use .biometryCurrentSet to require biometric authentication only (no passcode fallback)
        // This also invalidates the key when biometrics are added/removed.
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.biometryCurrentSet],
            nil
        ) else {
            throw NSError(domain: "VaultStore", code: 11, userInfo: [NSLocalizedDescriptionKey: "Failed to create access control"])
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: VaultConstants.accountKeyKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup,
            kSecValueData as String: keyData,
            kSecAttrAccessControl as String: accessControl
        ]

        SecItemDelete(query as CFDictionary)

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: "VaultStore", code: 10, userInfo: [NSLocalizedDescriptionKey: "Failed to store key in keychain: \(status)"])
        }
    }

    /// Remove the encryption key from the keychain
    internal func removeKeyFromKeychain() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: VaultConstants.accountKeyKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: "VaultStore", code: 11, userInfo: [NSLocalizedDescriptionKey: "Failed to remove key from keychain: \(status)"])
        }
    }

    // MARK: - Private Keychain Methods

    /// Retrieve the Account Key from the keychain
    private func retrieveKeyFromKeychain(context: LAContext) throws -> Data {
        // Ensure interaction is allowed so system can prompt for biometric authentication
        context.interactionNotAllowed = false
        context.localizedReason = "Authenticate to unlock your vault"

        // Add a small delay to ensure the context is fully ready
        // This helps prevent race conditions where the biometric prompt doesn't show on first tap
        Thread.sleep(forTimeInterval: 0.05)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: VaultConstants.accountKeyKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup,
            kSecReturnData as String: true,
            kSecUseAuthenticationContext as String: context,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let keyData = result as? Data else {
            // Map keychain status codes to specific errors for better debugging
            switch status {
            case errSecUserCanceled:
                throw AppError.biometricCancelled
            case errSecAuthFailed:
                throw AppError.biometricFailed
            case errSecItemNotFound:
                // Key not found in keychain - user may need to re-login
                print("Keychain item not found (errSecItemNotFound: \(status))")
                throw AppError.keychainItemNotFound
            case errSecInteractionNotAllowed:
                // Access denied - may happen if app is in background or screen is locked
                print("Keychain interaction not allowed (errSecInteractionNotAllowed: \(status))")
                throw AppError.keychainAccessDenied(status: status)
            case errSecMissingEntitlement:
                // Missing keychain-access-groups entitlement or access group mismatch
                print("Missing keychain entitlement (errSecMissingEntitlement: \(status))")
                throw AppError.keychainAccessDenied(status: status)
            case errSecDecode:
                // Data corruption or format issue
                print("Keychain decode error (errSecDecode: \(status))")
                throw AppError.keychainAccessDenied(status: status)
            default:
                // Log the specific status code for debugging
                print("Keychain error - status: \(status)")
                throw AppError.keystoreKeyNotFound
            }
        }

        markSuccessfulAuth()
        return keyData
    }
}
