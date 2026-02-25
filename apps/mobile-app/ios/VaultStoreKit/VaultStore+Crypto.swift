import Foundation
import CryptoKit
import LocalAuthentication
import Security
import SignalArgon2

/// Extension for the VaultStore class to handle encryption/decryption
extension VaultStore {
    /// Derives a key from a password using Argon2Id
    public func deriveKeyFromPassword(_ password: String,
                                     salt: String,
                                     encryptionType: String,
                                     encryptionSettings: String) throws -> Data {
        guard encryptionType == "Argon2Id" else {
            throw NSError(domain: "VaultStore", code: 13, userInfo: [NSLocalizedDescriptionKey: "Unsupported encryption type: \(encryptionType)"])
        }

        // Parse encryption settings JSON
        guard let settingsData = encryptionSettings.data(using: .utf8),
              let settings = try? JSONSerialization.jsonObject(with: settingsData, options: []) as? [String: Any],
              let iterations = settings["Iterations"] as? UInt32,
              let memorySize = settings["MemorySize"] as? UInt32,
              let parallelism = settings["DegreeOfParallelism"] as? UInt32 else {
            throw NSError(domain: "VaultStore", code: 14, userInfo: [NSLocalizedDescriptionKey: "Invalid encryption settings"])
        }

        // Convert password and salt to Data
        guard let passwordData = password.data(using: .utf8) else {
            throw NSError(domain: "VaultStore", code: 16, userInfo: [NSLocalizedDescriptionKey: "Invalid password"])
        }

        guard let saltData = salt.data(using: .utf8) else {
            throw NSError(domain: "VaultStore", code: 15, userInfo: [NSLocalizedDescriptionKey: "Invalid salt"])
        }

        // Use SignalArgon2 to hash the password via Argon2id
        guard let derivedKeyTuple = try? Argon2.hash(
            iterations: iterations,
            memoryInKiB: memorySize,
            threads: parallelism,
            password: passwordData,
            salt: saltData,
            desiredLength: 32,
            variant: .id,
            version: .v13
        ) else {
            throw NSError(domain: "VaultStore", code: 17, userInfo: [NSLocalizedDescriptionKey: "Argon2 hashing failed"])
        }

        // Return only the raw Data from the tuple
        return derivedKeyTuple.raw
    }

    /// Store the encryption key in memory only (no keychain persistence).
    /// Use this to test if a password-derived key is valid before persisting.
    public func storeEncryptionKeyInMemory(base64Key: String) throws {
        guard let keyData = Data(base64Encoded: base64Key) else {
            throw NSError(domain: "VaultStore", code: 6, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 key"])
        }

        guard keyData.count == 32 else {
            throw NSError(domain: "VaultStore", code: 7, userInfo: [NSLocalizedDescriptionKey: "Invalid key length. Expected 32 bytes"])
        }

        self.encryptionKey = keyData
        print("Stored key in memory only (no keychain persistence)")
    }

    /// Clear the encryption key from memory.
    /// This forces getEncryptionKey() to fetch from keychain on next access.
    public func clearEncryptionKeyFromMemory() {
        self.encryptionKey = nil
        print("Cleared encryption key from memory")
    }

    /// Store the encryption key in memory AND persist to keychain if Face ID is enabled.
    public func storeEncryptionKey(base64Key: String) throws {
        // First store in memory
        try storeEncryptionKeyInMemory(base64Key: base64Key)

        // Then persist to keychain if Face ID is enabled AND keystore is available
        if self.enabledAuthMethods.contains(.faceID), let keyData = self.encryptionKey {
            if isKeystoreAvailable() {
                try storeKeyInKeychain(keyData)
                print("Stored key in memory and persisted to keychain")
            } else {
                print("Stored key in memory (keystore unavailable - device passcode not set, skipping keychain)")
            }
        } else {
            print("Stored key in memory (Face ID not enabled, skipping keychain)")
        }
    }

    /// Store the key derivation parameters used for deriving the encryption key from the plain text password
    public func storeEncryptionKeyDerivationParams(_ keyDerivationParams: String) throws {
        // Store the key derivation params in memory
        self.keyDerivationParams = keyDerivationParams

        // Store the key derivation params in UserDefaults
        self.userDefaults.set(keyDerivationParams, forKey: VaultConstants.encryptionKeyDerivationParamsKey)

        print("Stored key derivation params in UserDefaults")
    }

    /// Get the key derivation parameters used for deriving the encryption key from the plain text password
    public func getEncryptionKeyDerivationParams() -> String? {
        return self.keyDerivationParams
    }

    /// Verify password and return encryption key if correct
    /// Returns nil if password is incorrect
    public func verifyPassword(_ password: String) -> String? {
        do {
            // Get encryption key derivation parameters
            guard let paramsString = getEncryptionKeyDerivationParams(),
                  let paramsData = paramsString.data(using: .utf8),
                  let params = try? JSONSerialization.jsonObject(with: paramsData) as? [String: Any],
                  let salt = params["salt"] as? String,
                  let encryptionType = params["encryptionType"] as? String,
                  let encryptionSettings = params["encryptionSettings"] as? String else {
                return nil
            }

            // Derive key from password
            let derivedKey = try deriveKeyFromPassword(password, salt: salt, encryptionType: encryptionType, encryptionSettings: encryptionSettings)

            // Try to decrypt the vault to verify the password is correct
            guard let encryptedDbBase64 = getEncryptedDatabase(),
                  let encryptedDbData = Data(base64Encoded: encryptedDbBase64) else {
                return nil
            }

            // Test decryption
            let key = SymmetricKey(data: derivedKey)
            let sealedBox = try AES.GCM.SealedBox(combined: encryptedDbData)
            _ = try AES.GCM.open(sealedBox, using: key)

            // If decryption succeeded, return the key as base64
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
             * If the decryption succeeds, try to persist the used encryption key in the keychain.
             * This makes sure that on future password unlock attempts, only successful decryptions
             * will be remembered and used so failed re-authentication attempts won't overwrite
             * a previous successful decryption key stored in the keychain.
             *
             * We only attempt this if Face ID is enabled AND keystore is available.
             * If keystore is not available (no device passcode), we silently skip this step.
             */
            if self.enabledAuthMethods.contains(.faceID) && isKeystoreAvailable() {
                do {
                    try storeKeyInKeychain(encryptionKey)
                } catch {
                    // Don't fail the decryption if we can't store to keychain
                    // This can happen if device passcode is removed after Face ID was enabled
                    print("Warning: Could not persist encryption key to keychain: \(error)")
                }
            }

            return decryptedData
        } catch {
            print("Decryption failed: \(error)")

            // Note: We intentionally do NOT clear the encryption key here.
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

    /// Get the encryption key - the key used to encrypt and decrypt the vault.
    /// This method is meant to only be used internally by the VaultStore class and not
    /// be exposed to the public API or React Native for security reasons.
    internal func getEncryptionKey() throws -> Data {
        // If key is already in memory, return it immediately
        // This is the common case during normal operation
        if let key = self.encryptionKey {
            return key
        }

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
            do {
                let keyData = try retrieveKeyFromKeychain(context: context)
                self.encryptionKey = keyData
                return keyData
            } catch let vaultError as AppError {
                throw vaultError
            } catch {
                throw AppError.keystoreKeyNotFound
            }
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

    /// Store the encryption key in the keychain
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
            kSecAttrAccount as String: VaultConstants.encryptionKeyKey,
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
            kSecAttrAccount as String: VaultConstants.encryptionKeyKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: "VaultStore", code: 11, userInfo: [NSLocalizedDescriptionKey: "Failed to remove key from keychain: \(status)"])
        }
    }

    // MARK: - Private Keychain Methods

    /// Retrieve the encryption key from the keychain
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
            kSecAttrAccount as String: VaultConstants.encryptionKeyKey,
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

        return keyData
    }
}
