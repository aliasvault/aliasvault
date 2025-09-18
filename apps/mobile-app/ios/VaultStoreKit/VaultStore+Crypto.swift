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

    /// Store the encryption key - the key used to encrypt and decrypt the vault
    public func storeEncryptionKey(base64Key: String) throws {
        guard let keyData = Data(base64Encoded: base64Key) else {
            throw NSError(domain: "VaultStore", code: 6, userInfo: [NSLocalizedDescriptionKey: "Invalid base64 key"])
        }

        guard keyData.count == 32 else {
            throw NSError(domain: "VaultStore", code: 7, userInfo: [NSLocalizedDescriptionKey: "Invalid key length. Expected 32 bytes"])
        }

        self.encryptionKey = keyData
        print("Stored key in memory, will be persisted in keychain upon succesful decrypt operation")
    }

    /// Check if a encryption key is stored in memory
    public func hasEncryptionKeyInMemory() -> Bool {
        return self.encryptionKey != nil
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

            // If the decryption succeeds, we persist the used encryption key in the keychain
            // This makes sure that on future password unlock attempts, only succesful decryptions
            // will be remembered and used so failed re-authentication attempts won't overwrite
            // a previous successful decryption key stored in the keychain.
            try storeKeyInKeychain(encryptionKey)

            return decryptedData
        } catch {
            print("Decryption failed: \(error)")

            // If the decryption fails, we remove the encryption key from memory
            // so that the next password unlock attempt will require a fresh
            // re-authentication attempt (either via Face ID or passcode) or
            // manual password unlock.
            self.encryptionKey = nil

            throw NSError(domain: "VaultStore", code: 12, userInfo: [NSLocalizedDescriptionKey: "Decryption failed"])
        }
    }

    /// Get the encryption key - the key used to encrypt and decrypt the vault.
    /// This method is meant to only be used internally by the VaultStore class and not
    /// be exposed to the public API or React Native for security reasons.
    internal func getEncryptionKey() throws -> Data {
        if let key = self.encryptionKey {
            return key
        }

        if self.enabledAuthMethods.contains(.faceID) {
            let context = LAContext()
            var error: NSError?

            #if targetEnvironment(simulator)
                print("Simulator detected, skipping biometric policy evaluation check and continuing with key retrieval from keychain")
            #else
                guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
                    throw NSError(domain: "VaultStore", code: 2, userInfo: [NSLocalizedDescriptionKey: "Face ID not available: \(error?.localizedDescription ?? "Unknown error")"])
                }
            #endif

            print("Attempting to get encryption key from keychain as Face ID is enabled as an option")
            do {
                let keyData = try retrieveKeyFromKeychain(context: context)
                self.encryptionKey = keyData
                return keyData
            } catch {
                throw NSError(domain: "VaultStore", code: 9, userInfo: [NSLocalizedDescriptionKey: "Failed to retrieve key from keychain: \(error.localizedDescription)"])
            }
        }

        throw NSError(domain: "VaultStore", code: 3, userInfo: [NSLocalizedDescriptionKey: "No encryption key found in memory"])
    }

    /// Store the encryption key in the keychain
    internal func storeKeyInKeychain(_ keyData: Data) throws {
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.userPresence],
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
        // Ensure interaction is allowed so system can prompt for Face ID or passcode fallback
        context.interactionNotAllowed = false
        context.localizedReason = "Authenticate to unlock your vault"

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
            if status == errSecUserCanceled {
                throw NSError(domain: "VaultStore", code: 8, userInfo: [NSLocalizedDescriptionKey: "Authentication canceled by user"])
            } else if status == errSecAuthFailed {
                throw NSError(domain: "VaultStore", code: 8, userInfo: [NSLocalizedDescriptionKey: "Authentication failed"])
            } else {
                throw NSError(domain: "VaultStore", code: 2, userInfo: [NSLocalizedDescriptionKey: "No encryption key found"])
            }
        }

        return keyData
    }
}
