import Foundation
import CryptoKit
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

    /// Open a session in memory with the unlock key (the password's Argon2id output) or stored key, without keychain persistence.
    /// Use this to test if a key is valid before persisting.
    public func storeUnlockKeyInMemory(base64Key: String) throws {
        guard let keyData = Data(base64Encoded: base64Key) else {
            throw NSError(domain: "VaultStore", code: 6, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 key"])
        }

        try openSession(unlockKey: keyData)
        print("Opened session in memory only (no keychain persistence)")
    }

    /// Clear the unlock key from memory.
    /// This forces getEncryptionKey() to fetch the unlock key from keychain on next access.
    public func clearEncryptionKeyFromMemory() {
        self.unlockKey = nil
        clearLastSuccessfulAuth()
        print("Cleared unlock key from memory")
    }

    /// Open a session in memory with the unlock key (the password's Argon2id output) or stored key AND persist the stored key to keychain
    /// if Face ID is enabled.
    public func storeUnlockKey(base64Key: String) throws {
        // First open the session in memory
        try storeUnlockKeyInMemory(base64Key: base64Key)

        // Then persist to keychain if Face ID is enabled AND keystore is available
        if self.enabledAuthMethods.contains(.faceID), let keyData = self.unlockKey {
            if isKeystoreAvailable() {
                try storeKeyInKeychain(keyData)
                print("Opened session and persisted unlock key to keychain")
            } else {
                print("Opened session in memory (keystore unavailable - device passcode not set, skipping keychain)")
            }
        } else {
            print("Opened session in memory (Face ID not enabled, skipping keychain)")
        }
    }

    /*
     * The stored key is the one secret a session holds; keychain and PIN only protect that same key. It is the
     * Account Key, so it does not depend on the password: a typed password yields an unlock key (its Argon2id
     * output), which opening the chain turns into the Account Key before anything stores it. A key stored before the
     * account had a chain is an unlock key; it still opens the chain and is replaced by the Account Key on the next
     * open. The Account Key opens the vault key and account private key, which are derived on demand and never
     * stored.
     */

    /// Open a session with a key that opens the cached account key chain; the session keeps the Account Key it yields.
    internal func openSession(unlockKey: Data) throws {
        guard unlockKey.count == 32 else {
            throw NSError(domain: "VaultStore", code: 7, userInfo: [NSLocalizedDescriptionKey: "Invalid key length. Expected 32 bytes"])
        }

        self.unlockKey = try openAccountKeyChain(with: unlockKey).accountKey
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
        /// The key to store for later unlocks, in place of the key the chain was opened with.
        let accountKey: Data
    }

    /// Open the cached account key chain with the stored key: the Account Key, or an unlock key that `accountKey` then
    /// replaces (Rust `openAccountKeyChain`). Without a chain (account not yet upgraded) the unlock key is the vault key.
    internal func openAccountKeyChain(with storedKey: Data) throws -> SessionKeys {
        guard let chainJson = getAccountKeyChain(),
              let chainData = chainJson.data(using: .utf8),
              let chain = try? JSONSerialization.jsonObject(with: chainData) as? [String: Any],
              let encryptedAccountKey = chain["encryptedAccountKey"] as? String, !encryptedAccountKey.isEmpty else {
            return SessionKeys(vaultEncryptionKey: storedKey, accountPrivateKey: nil, accountKey: storedKey)
        }

        guard let encryptedVek = chain["encryptedVek"] as? String, !encryptedVek.isEmpty else {
            throw NSError(domain: "VaultStore", code: 41, userInfo: [NSLocalizedDescriptionKey: "Account key chain is missing the encrypted VEK"])
        }

        // A private key that does not open must not fail the unlock; grants stay closed until the next login.
        let encryptedPrivateKey = (chain["encryptedAccountPrivateKey"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        do {
            let keys = try RustCoreFramework.openAccountKeyChain(
                storedKey: storedKey, encryptedAccountKey: encryptedAccountKey, encryptedVek: encryptedVek, encryptedAccountPrivateKey: encryptedPrivateKey
            )
            return SessionKeys(vaultEncryptionKey: keys.vaultEncryptionKey, accountPrivateKey: keys.accountPrivateKey, accountKey: keys.accountKey)
        } catch KeyChainError.UnlockKeyRejected {
            throw AppError.unlockKeyRejected
        } catch KeyChainError.KeyChainUnreadable(let message) {
            // The account key opened, so this is a damaged chain and never a wrong password.
            throw AppError.keyChainUnreadable(message: message)
        }
    }

    /// Decrypt base64 RSA-OAEP ciphertext with the session's account private key as UTF-8 text, or nil when the session holds
    /// no private key or it does not open the ciphertext.
    public func decryptWithAccountPrivateKey(_ base64Ciphertext: String) -> String? {
        guard let privateKey = accountPrivateKey, let plaintext = try? RustCoreFramework.rsaDecrypt(base64Ciphertext: base64Ciphertext, privateKeyJwk: privateKey) else {
            return nil
        }
        return String(data: plaintext, encoding: .utf8)
    }

    /// Verify the password and return its unlock key (base64) if correct. Callers derive the SRP input from it for the
    /// account's encryption type; `storeUnlockKey` turns it into the Account Key the session keeps.
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
            let vaultEncryptionKey = try openAccountKeyChain(with: derivedKey).vaultEncryptionKey

            // Try to decrypt the vault to verify the password is correct
            guard let encryptedDbBase64 = getEncryptedDatabase(),
                  let encryptedDbData = Data(base64Encoded: encryptedDbBase64, options: .ignoreUnknownCharacters) else {
                return nil
            }

            // Test decryption
            let key = SymmetricKey(data: vaultEncryptionKey)
            let sealedBox = try AES.GCM.SealedBox(combined: encryptedDbData)
            _ = try AES.GCM.open(sealedBox, using: key)

            // If decryption succeeded, return the unlock key as base64
            return derivedKey.base64EncodedString()
        } catch {
            // Password incorrect or decryption failed
            return nil
        }
    }

    /// Encrypt the data using the encryption key
    internal func encrypt(data: Data) throws -> Data {
        let encryptionKey = try getEncryptionKey()

        let key = SymmetricKey(data: encryptionKey)
        let sealedBox = try AES.GCM.seal(data, using: key)
        return sealedBox.combined!
    }

    /// Decrypt the data using the encryption key
    internal func decrypt(data: Data) throws -> Data {
        let encryptionKey = try getEncryptionKey()

        let key = SymmetricKey(data: encryptionKey)
        let sealedBox = try AES.GCM.SealedBox(combined: data)
        do {
            let decryptedData = try AES.GCM.open(sealedBox, using: key)

            /*
             * If the decryption succeeds, try to persist the unlock key of this session in the keychain.
             * This makes sure that on future password unlock attempts, only successful decryptions
             * will be remembered and used so failed re-authentication attempts won't overwrite
             * a previous successful decryption key stored in the keychain.
             *
             * We only attempt this if Face ID is enabled AND keystore is available.
             * If keystore is not available (no device passcode), we silently skip this step.
             */
            if self.enabledAuthMethods.contains(.faceID) && isKeystoreAvailable(), let unlockKey = self.unlockKey {
                do {
                    try storeKeyInKeychain(unlockKey)
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
        let storedKey = try getUnlockKey()
        let keys = try openAccountKeyChain(with: storedKey)
        if keys.accountKey != storedKey {
            // The session held an unlock key and the account has a key chain since (a sync accepted one created on
            // another device): keep the Account Key from now on.
            self.unlockKey = keys.accountKey
            convertLegacyKeychainKey(keychainKey: storedKey, accountKey: keys.accountKey)
        }
        return keys.vaultEncryptionKey
    }

    /// Get the session's stored key, which the keychain and PIN protect.
    internal func getUnlockKey() throws -> Data {
        if let key = self.unlockKey {
            return key
        }

        try openSessionFromKeychain()
        guard let key = self.unlockKey else {
            throw AppError.keystoreKeyNotFound
        }
        return key
    }

    /// Open a session with the unlock key the keychain holds, behind a biometric prompt.
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
                try openSession(unlockKey: keyData)
                if let accountKey = self.unlockKey {
                    convertLegacyKeychainKey(keychainKey: keyData, accountKey: accountKey)
                }
            } catch let vaultError as AppError {
                print("The unlock key from the keychain does not open the account key chain: \(vaultError.message)")
                throw vaultError
            } catch {
                print("The unlock key from the keychain does not open the account key chain: \(error)")
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

    /// Store the unlock key in the keychain
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
            kSecAttrAccount as String: VaultConstants.unlockKeyKey,
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
            kSecAttrAccount as String: VaultConstants.unlockKeyKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: "VaultStore", code: 11, userInfo: [NSLocalizedDescriptionKey: "Failed to remove key from keychain: \(status)"])
        }
    }

    // MARK: - Private Keychain Methods

    /// Retrieve the unlock key from the keychain
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
            kSecAttrAccount as String: VaultConstants.unlockKeyKey,
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
