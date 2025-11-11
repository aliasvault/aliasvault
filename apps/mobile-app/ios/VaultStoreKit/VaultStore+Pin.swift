import Foundation
import CryptoKit
import Security
import SignalArgon2

/// Extension for the VaultStore class to handle PIN unlock functionality
extension VaultStore {
    // MARK: - PIN Constants

    private static let pinEncryptedKeyKey = "pinEncryptedKey"
    private static let pinSaltKey = "pinSalt"
    private static let pinLengthKey = "pinLength"
    private static let pinFailedAttemptsKey = "pinFailedAttempts"
    private static let maxPinAttempts = 4

    // MARK: - PIN Status Methods

    /// Check if PIN unlock is enabled
    public func isPinEnabled() -> Bool {
        return userDefaults.bool(forKey: VaultConstants.pinEnabledKey)
    }

    /// Get the configured PIN length
    public func getPinLength() -> Int? {
        guard isPinEnabled() else { return nil }
        let length = userDefaults.integer(forKey: Self.pinLengthKey)
        return length > 0 ? length : nil
    }

    /// Get failed attempts count
    public func getPinFailedAttempts() -> Int {
        return userDefaults.integer(forKey: Self.pinFailedAttemptsKey)
    }

    // MARK: - PIN Setup Methods

    /// Setup PIN unlock
    /// Encrypts the vault encryption key (from memory) with the PIN and stores it securely
    /// The encryption key is retrieved internally and never exposed to React Native layer
    ///
    /// - Parameters:
    ///   - pin: The PIN to set (4-8 digits)
    /// - Throws: Error if PIN is invalid, vault not unlocked, or encryption fails
    public func setupPin(_ pin: String) throws {
        // Get vault encryption key from memory (vault must be unlocked)
        let vaultEncryptionKey = try getEncryptionKey()

        // Generate random salt
        var salt = Data(count: 16)
        let result = salt.withUnsafeMutableBytes {
            SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!)
        }
        guard result == errSecSuccess else {
            throw NSError(domain: "VaultStore", code: 22, userInfo: [NSLocalizedDescriptionKey: "Failed to generate random salt"])
        }

        // Derive key from PIN using Argon2id
        let pinKey = try derivePinKey(pin: pin, salt: salt)

        // Encrypt the vault encryption key using AES-GCM
        let symmetricKey = SymmetricKey(data: pinKey)
        let sealedBox = try AES.GCM.seal(vaultEncryptionKey, using: symmetricKey)
        guard let encryptedData = sealedBox.combined else {
            throw NSError(domain: "VaultStore", code: 23, userInfo: [NSLocalizedDescriptionKey: "Failed to encrypt vault key"])
        }

        // Store encrypted key and salt in keychain (without biometric protection)
        try storePinDataInKeychain(encryptedKey: encryptedData, salt: salt)

        // Store PIN metadata in UserDefaults
        userDefaults.set(true, forKey: VaultConstants.pinEnabledKey)
        userDefaults.set(pin.count, forKey: Self.pinLengthKey)
        userDefaults.set(0, forKey: Self.pinFailedAttemptsKey)
        userDefaults.synchronize()

        print("PIN unlock enabled successfully")
    }

    // MARK: - PIN Unlock Methods

    /// Unlock with PIN
    /// Returns the decrypted vault encryption key
    ///
    /// - Parameter pin: The PIN to use for unlocking
    /// - Returns: The decrypted vault encryption key (base64)
    /// - Throws: Error if PIN is incorrect, locked, or not configured
    public func unlockWithPin(_ pin: String) throws -> String {
        // Check if PIN is enabled
        // Note: If PIN was previously locked (max attempts), it's automatically disabled and cleared,
        // so isPinEnabled() returning false means either PIN was never set up or it was locked and cleared
        guard isPinEnabled() else {
            throw NSError(domain: "VaultStore", code: 25, userInfo: [NSLocalizedDescriptionKey: "PIN unlock is not configured"])
        }

        do {
            // Retrieve encrypted key and salt from keychain
            let (encryptedKey, salt) = try retrievePinDataFromKeychain()

            // Derive key from PIN
            let pinKey = try derivePinKey(pin: pin, salt: salt)

            // Decrypt the vault encryption key
            let symmetricKey = SymmetricKey(data: pinKey)
            let sealedBox = try AES.GCM.SealedBox(combined: encryptedKey)
            let decryptedKey = try AES.GCM.open(sealedBox, using: symmetricKey)

            // Reset failed attempts on success
            userDefaults.set(0, forKey: Self.pinFailedAttemptsKey)
            userDefaults.synchronize()

            // Return the decrypted vault encryption key as base64
            return decryptedKey.base64EncodedString()
        } catch {
            // Increment failed attempts
            let currentAttempts = getPinFailedAttempts()
            let newAttempts = currentAttempts + 1
            userDefaults.set(newAttempts, forKey: Self.pinFailedAttemptsKey)
            userDefaults.synchronize()

            // If max attempts reached, disable PIN and clear all stored data
            if newAttempts >= Self.maxPinAttempts {
                try? removeAndDisablePin()
                throw NSError(domain: "VaultStore", code: 26, userInfo: [NSLocalizedDescriptionKey: "PIN locked after too many failed attempts"])
            }

            // Return incorrect PIN error with attempts remaining
            let attemptsRemaining = Self.maxPinAttempts - newAttempts
            throw NSError(domain: "VaultStore", code: 27, userInfo: [
                NSLocalizedDescriptionKey: "Incorrect PIN. \(attemptsRemaining) attempts remaining",
                "attemptsRemaining": attemptsRemaining
            ])
        }
    }

    /// Reset failed attempts counter
    /// Called after successful password unlock
    public func resetPinFailedAttempts() {
        userDefaults.set(0, forKey: Self.pinFailedAttemptsKey)
        userDefaults.synchronize()
    }

    /// Disable PIN unlock and remove all stored data
    public func removeAndDisablePin() throws {
        // Remove PIN data from keychain
        try removePinDataFromKeychain()

        // Clear PIN metadata from UserDefaults
        userDefaults.removeObject(forKey: VaultConstants.pinEnabledKey)
        userDefaults.removeObject(forKey: Self.pinLengthKey)
        userDefaults.removeObject(forKey: Self.pinFailedAttemptsKey)
        userDefaults.synchronize()

        print("PIN unlock disabled and all data removed")
    }

    // MARK: - Private PIN Methods

    /// Derive encryption key from PIN using Argon2id
    ///
    /// Uses Argon2id with high memory cost (64 MB) to make brute-force attacks
    /// significantly more expensive. This is especially important for PINs which
    /// have lower entropy than passwords.
    ///
    /// Parameters chosen for security:
    /// - Memory: 65536 KiB (64 MB) - makes GPU attacks much harder
    /// - Iterations: 3 - standard for Argon2id
    /// - Parallelism: 1 - suitable for mobile environment
    /// - Output: 32 bytes for AES-256-GCM
    private func derivePinKey(pin: String, salt: Data) throws -> Data {
        guard let pinData = pin.data(using: .utf8) else {
            throw NSError(domain: "VaultStore", code: 28, userInfo: [NSLocalizedDescriptionKey: "Failed to convert PIN to data"])
        }

        // Use SignalArgon2 to hash the PIN via Argon2id
        guard let derivedKeyTuple = try? Argon2.hash(
            iterations: 3,
            memoryInKiB: 65536, // 64 MB
            threads: 1,
            password: pinData,
            salt: salt,
            desiredLength: 32,
            variant: .id,
            version: .v13
        ) else {
            throw NSError(domain: "VaultStore", code: 29, userInfo: [NSLocalizedDescriptionKey: "Argon2 PIN hashing failed"])
        }

        return derivedKeyTuple.raw
    }

    /// Store PIN encrypted data in keychain (without biometric protection)
    private func storePinDataInKeychain(encryptedKey: Data, salt: Data) throws {
        // Create a dictionary to store both encrypted key and salt
        let pinData: [String: Data] = [
            "encryptedKey": encryptedKey,
            "salt": salt
        ]

        guard let dataToStore = try? JSONEncoder().encode(pinData) else {
            throw NSError(domain: "VaultStore", code: 30, userInfo: [NSLocalizedDescriptionKey: "Failed to encode PIN data"])
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: Self.pinEncryptedKeyKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup,
            kSecValueData as String: dataToStore,
            // Use device passcode protection but not biometric protection
            kSecAttrAccessible as String: kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
        ]

        // Delete existing item if present
        SecItemDelete(query as CFDictionary)

        // Add new item
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: "VaultStore", code: 31, userInfo: [NSLocalizedDescriptionKey: "Failed to store PIN data in keychain: \(status)"])
        }
    }

    /// Retrieve PIN encrypted data from keychain
    private func retrievePinDataFromKeychain() throws -> (encryptedKey: Data, salt: Data) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: Self.pinEncryptedKeyKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else {
            throw NSError(domain: "VaultStore", code: 32, userInfo: [NSLocalizedDescriptionKey: "No PIN data found in keychain"])
        }

        guard let pinData = try? JSONDecoder().decode([String: Data].self, from: data),
              let encryptedKey = pinData["encryptedKey"],
              let salt = pinData["salt"] else {
            throw NSError(domain: "VaultStore", code: 33, userInfo: [NSLocalizedDescriptionKey: "Failed to decode PIN data"])
        }

        return (encryptedKey, salt)
    }

    /// Remove PIN data from keychain
    private func removePinDataFromKeychain() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: Self.pinEncryptedKeyKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: "VaultStore", code: 34, userInfo: [NSLocalizedDescriptionKey: "Failed to remove PIN data from keychain: \(status)"])
        }
    }
}
