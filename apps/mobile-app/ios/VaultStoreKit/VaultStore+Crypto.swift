import Foundation
import LocalAuthentication
import Security
import RustCoreFramework
import VaultUtils

/// Key derivation, the account key chain, the keychain-backed session and the vault blob.
extension VaultStore {
    /// Derive the unlock key from a password with Argon2id.
    public func deriveKeyFromPassword(_ password: String, salt: String, encryptionType: String, encryptionSettings: String) throws -> Data {
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

    /// Clear the Account Key from memory, so the next access opens the session from the keychain.
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

    /// Store the unlock key derivation parameters (JSON) of the password.
    public func storeUnlockKeyDerivationParams(_ keyDerivationParams: String) throws {
        self.keyDerivationParams = keyDerivationParams
        self.userDefaults.set(keyDerivationParams, forKey: VaultConstants.unlockKeyDerivationParamsKey)
    }

    /// The stored unlock key derivation parameters (JSON) of the password.
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

    /// Verify the password offline and return its unlock key (base64), or nil when it does not open the key chain.
    public func verifyPassword(_ password: String) -> String? {
        do {
            guard let paramsString = getUnlockKeyDerivationParams(),
                  let paramsData = paramsString.data(using: .utf8),
                  let params = try? JSONSerialization.jsonObject(with: paramsData) as? [String: Any],
                  let salt = params["salt"] as? String,
                  let encryptionType = params["encryptionType"] as? String,
                  let encryptionSettings = params["encryptionSettings"] as? String else {
                return nil
            }

            let derivedKey = try deriveKeyFromPassword(password, salt: salt, encryptionType: encryptionType, encryptionSettings: encryptionSettings)
            _ = try openKeyChainWithUnlockKey(derivedKey)
            return derivedKey.base64EncodedString()
        } catch {
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

            // The Account Key is persisted only after a successful decryption, so a failed re-authentication never
            // overwrites a working key in the keychain. A failure to persist (passcode removed) does not fail the decryption.
            if self.enabledAuthMethods.contains(.faceID) && isKeystoreAvailable(), let accountKey = self.accountKey {
                do {
                    try storeKeyInKeychain(accountKey)
                } catch {
                    print("Warning: Could not persist encryption key to keychain: \(error)")
                }
            }

            return decryptedData
        } catch {
            print("Decryption failed: \(error)")

            // The key is kept: after a password change it opens the vault the next sync downloads.
            throw NSError(domain: "VaultStore", code: 12, userInfo: [NSLocalizedDescriptionKey: "Decryption failed"])
        }
    }

    /// Whether Face ID is enabled in the settings and the device supports biometrics (always on the simulator).
    public func isBiometricAuthEnabled() -> Bool {
        guard self.enabledAuthMethods.contains(.faceID) else {
            return false
        }

        #if targetEnvironment(simulator)
            return true
        #else
            let context = LAContext()
            var error: NSError?
            return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        #endif
    }

    /// The vault encryption key as base64, for the sync engine.
    public func getEncryptionKeyBase64() throws -> String {
        return try getEncryptionKey().base64EncodedString()
    }

    /// The encryption key, the key that encrypts and decrypts the vault.
    internal func getEncryptionKey() throws -> Data {
        let key = try getAccountKey()
        // LEGACY: a stored unlock key is converted into the Account Key. TODO: remove once all clients run 0.31.0+.
        let keys = try openStoredKey(key)
        if keys.accountKey != key {
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
        if self.enabledAuthMethods.contains(.faceID) && isKeystoreAvailable() {
            let context = LAContext()
            var error: NSError?

            #if targetEnvironment(simulator)
                print("Simulator detected, skipping biometric policy evaluation check and continuing with key retrieval from keychain")
            #else
                if !context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
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
                // LEGACY: a stored unlock key is converted into the Account Key. TODO: remove once all clients run 0.31.0+.
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

        // Face ID is not enabled, the keystore is unavailable (no device passcode) or no key was stored yet.
        throw AppError.keystoreKeyNotFound
    }

    /// Whether the keystore is available, which requires a device passcode.
    public func isKeystoreAvailable() -> Bool {
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [],
            nil
        ) else {
            return false
        }

        // A test item under that access control tells whether a passcode is set.
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

        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        SecItemDelete(query as CFDictionary)

        return status == errSecSuccess
    }

    /// Store the Account Key in the keychain behind biometrics.
    internal func storeKeyInKeychain(_ keyData: Data) throws {
        guard isKeystoreAvailable() else {
            print("Cannot store key in keychain: device passcode not set")
            throw AppError.biometricNotAvailable
        }

        // .biometryCurrentSet requires biometrics (no passcode fallback) and invalidates the key when they change.
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

    /// Remove the Account Key from the keychain.
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

    /// Retrieve the Account Key from the keychain behind a biometric prompt.
    private func retrieveKeyFromKeychain(context: LAContext) throws -> Data {
        context.interactionNotAllowed = false
        context.localizedReason = "Authenticate to unlock your vault"

        // Without this delay the biometric prompt sometimes does not show on the first tap.
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
            switch status {
            case errSecUserCanceled:
                throw AppError.biometricCancelled
            case errSecAuthFailed:
                throw AppError.biometricFailed
            case errSecItemNotFound:
                print("Keychain item not found (errSecItemNotFound: \(status))")
                throw AppError.keychainItemNotFound
            case errSecInteractionNotAllowed:
                // The app is in the background or the screen is locked.
                print("Keychain interaction not allowed (errSecInteractionNotAllowed: \(status))")
                throw AppError.keychainAccessDenied(status: status)
            case errSecMissingEntitlement:
                print("Missing keychain entitlement (errSecMissingEntitlement: \(status))")
                throw AppError.keychainAccessDenied(status: status)
            case errSecDecode:
                print("Keychain decode error (errSecDecode: \(status))")
                throw AppError.keychainAccessDenied(status: status)
            default:
                print("Keychain error - status: \(status)")
                throw AppError.keystoreKeyNotFound
            }
        }

        markSuccessfulAuth()
        return keyData
    }
}
