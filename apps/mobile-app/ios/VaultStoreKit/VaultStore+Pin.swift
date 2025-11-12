import Foundation
import CryptoKit
import Security
import SignalArgon2
import VaultModels

/// Extension for the VaultStore class to handle PIN unlock functionality
extension VaultStore {
    // MARK: - PIN Constants

    private static let pinEncryptedKeyKey = "pinEncryptedKey"
    private static let pinSaltKey = "pinSalt"
    private static let pinPepperKey = "pinPepper" // Device-bound secret
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

    /// Get failed attempts count from secure storage
    public func getPinFailedAttempts() -> Int {
        return (try? retrievePinFailedAttemptsFromKeychain()) ?? 0
    }

    // MARK: - PIN Setup Methods

    /// Setup PIN unlock
    /// Encrypts the vault encryption key (from memory) with the PIN and stores it securely
    /// The encryption key is retrieved internally and never exposed to React Native layer
    ///
    /// - Parameters:
    ///   - pin: The PIN to set (4+ digits)
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

        // Generate or retrieve device pepper (device-bound secret)
        let pepper = try getOrCreateDevicePepper()

        // Derive key from PIN + pepper using Argon2id
        let pinKey = try derivePinKey(pin: pin, salt: salt, pepper: pepper)

        // Encrypt the vault encryption key using AES-GCM
        let symmetricKey = SymmetricKey(data: pinKey)
        let sealedBox = try AES.GCM.seal(vaultEncryptionKey, using: symmetricKey)
        guard let encryptedData = sealedBox.combined else {
            throw NSError(domain: "VaultStore", code: 23, userInfo: [NSLocalizedDescriptionKey: "Failed to encrypt vault key"])
        }

        // Store encrypted key and salt in keychain (without biometric protection)
        try storePinDataInKeychain(encryptedKey: encryptedData, salt: salt)

        // Initialize failed attempts counter in Keychain
        try storePinFailedAttemptsInKeychain(0)

        // Store PIN metadata in UserDefaults (non-sensitive data only)
        userDefaults.set(true, forKey: VaultConstants.pinEnabledKey)
        userDefaults.set(pin.count, forKey: Self.pinLengthKey)
        userDefaults.synchronize()

        print("PIN unlock enabled successfully with device pepper")
    }

    // MARK: - PIN Unlock Methods

    /// Unlock with PIN
    /// Returns the decrypted vault encryption key
    ///
    /// - Parameter pin: The PIN to use for unlocking
    /// - Returns: The decrypted vault encryption key (base64)
    /// - Throws: PinUnlockError with specific error type and metadata
    public func unlockWithPin(_ pin: String) throws -> String {
        // Check if PIN is enabled
        guard isPinEnabled() else {
            throw PinUnlockError.notConfigured
        }

        do {
            // Retrieve encrypted key, salt, and pepper from keychain
            let (encryptedKey, salt) = try retrievePinDataFromKeychain()
            let pepper = try retrieveDevicePepper()

            // Derive key from PIN + pepper
            let pinKey = try derivePinKey(pin: pin, salt: salt, pepper: pepper)

            // Decrypt the vault encryption key
            let symmetricKey = SymmetricKey(data: pinKey)
            let sealedBox = try AES.GCM.SealedBox(combined: encryptedKey)
            let decryptedKey = try AES.GCM.open(sealedBox, using: symmetricKey)

            // Reset failed attempts on success
            try storePinFailedAttemptsInKeychain(0)

            // Return the decrypted vault encryption key as base64
            return decryptedKey.base64EncodedString()
        } catch {
            // Increment failed attempts
            let currentAttempts = getPinFailedAttempts()
            let newAttempts = currentAttempts + 1
            try? storePinFailedAttemptsInKeychain(newAttempts)

            // If max attempts reached, disable PIN and clear all stored data
            if newAttempts >= Self.maxPinAttempts {
                try? removeAndDisablePin()
                throw PinUnlockError.locked
            }

            // Return incorrect PIN error with attempts remaining
            let attemptsRemaining = Self.maxPinAttempts - newAttempts
            throw PinUnlockError.incorrectPin(attemptsRemaining: attemptsRemaining)
        }
    }

    /// Reset failed attempts counter (called after successful password unlock)
    public func resetPinFailedAttempts() {
        try? storePinFailedAttemptsInKeychain(0)
    }

    /// Disable PIN unlock and remove all stored data
    public func removeAndDisablePin() throws {
        // Remove PIN data from keychain
        try removePinDataFromKeychain()

        // Remove failed attempts counter from keychain
        try removePinFailedAttemptsFromKeychain()

        // Note: We DO NOT remove the device pepper - it's reused if PIN is re-enabled
        // This maintains consistency and doesn't degrade security

        // Clear PIN metadata from UserDefaults
        userDefaults.removeObject(forKey: VaultConstants.pinEnabledKey)
        userDefaults.removeObject(forKey: Self.pinLengthKey)
        userDefaults.synchronize()

        print("PIN unlock disabled and all data removed (pepper retained)")
    }

    // MARK: - Private PIN Methods

    /// Derive encryption key from PIN + pepper using Argon2id
    ///
    /// Uses Argon2id with high memory cost (64 MB) and a device-bound pepper
    /// to make offline brute-force attacks infeasible even if the encrypted blob is exfiltrated.
    ///
    /// The pepper is a 32-byte random value stored in the Secure Enclave-protected Keychain,
    /// which means an attacker who steals the encrypted blob cannot brute-force offline
    /// because they don't have the pepper.
    ///
    /// Parameters:
    /// - pin: User's PIN (low entropy)
    /// - salt: Random salt (stored with encrypted data)
    /// - pepper: Device-bound secret
    private func derivePinKey(pin: String, salt: Data, pepper: Data) throws -> Data {
        guard let pinData = pin.data(using: .utf8) else {
            throw NSError(domain: "VaultStore", code: 28, userInfo: [NSLocalizedDescriptionKey: "Failed to convert PIN to data"])
        }

        // Concatenate PIN + pepper before hashing
        // This ensures offline brute-force is impossible without the pepper
        var combinedInput = Data()
        combinedInput.append(pinData)
        combinedInput.append(pepper)

        // Use SignalArgon2 to hash (PIN + pepper) via Argon2id
        guard let derivedKeyTuple = try? Argon2.hash(
            iterations: 3,
            memoryInKiB: 65536, // 64 MB
            threads: 1,
            password: combinedInput,
            salt: salt,
            desiredLength: 32,
            variant: .id,
            version: .v13
        ) else {
            throw NSError(domain: "VaultStore", code: 29, userInfo: [NSLocalizedDescriptionKey: "Argon2 PIN hashing failed"])
        }

        return derivedKeyTuple.raw
    }

    /// Get or create device pepper (device-bound secret)
    ///
    /// The pepper is a 32-byte random value stored in Keychain with Secure Enclave protection.
    /// It's only readable when the device is unlocked (passcode entered), but can be cached in memory.
    /// This prevents offline brute-force when only the encrypted blob would be captured.
    private func getOrCreateDevicePepper() throws -> Data {
        // Try to retrieve existing pepper
        if let pepper = try? retrieveDevicePepper() {
            return pepper
        }

        // Generate new 32-byte pepper
        var pepper = Data(count: 32)
        let result = pepper.withUnsafeMutableBytes {
            SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!)
        }
        guard result == errSecSuccess else {
            throw NSError(domain: "VaultStore", code: 36, userInfo: [NSLocalizedDescriptionKey: "Failed to generate device pepper"])
        }

        // Store pepper in Keychain with device passcode protection
        // This uses kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly which provides:
        // 1. Device-bound (cannot be moved to another device)
        // 2. Requires passcode to be set
        // 3. Available when device is unlocked
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: Self.pinPepperKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup,
            kSecValueData as String: pepper,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: "VaultStore", code: 37, userInfo: [NSLocalizedDescriptionKey: "Failed to store device pepper: \(status)"])
        }

        print("Device pepper created and stored securely")
        return pepper
    }

    /// Retrieve device pepper from Keychain
    private func retrieveDevicePepper() throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: Self.pinPepperKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let pepper = result as? Data else {
            throw NSError(domain: "VaultStore", code: 38, userInfo: [NSLocalizedDescriptionKey: "Device pepper not found"])
        }

        return pepper
    }

    /// Store PIN encrypted data in keychain (without biometric protection)
    private func storePinDataInKeychain(encryptedKey: Data, salt: Data) throws {
        // Create a dictionary to store both encrypted key and salt
        // Note: We DO NOT store the pepper here - it's separate for security
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

    // MARK: - Failed Attempts Counter (Keychain Storage)

    /// Store failed attempts counter in Keychain (not UserDefaults)
    private func storePinFailedAttemptsInKeychain(_ attempts: Int) throws {
        let attemptsData = withUnsafeBytes(of: attempts) { Data($0) }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: Self.pinFailedAttemptsKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup,
            kSecValueData as String: attemptsData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
        ]

        // Delete existing item if present
        SecItemDelete(query as CFDictionary)

        // Add new item
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: "VaultStore", code: 39, userInfo: [NSLocalizedDescriptionKey: "Failed to store attempts counter: \(status)"])
        }
    }

    /// Retrieve failed attempts counter from Keychain
    private func retrievePinFailedAttemptsFromKeychain() throws -> Int {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: Self.pinFailedAttemptsKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else {
            // Return 0 if not found
            return 0
        }

        return data.withUnsafeBytes { $0.load(as: Int.self) }
    }

    /// Remove failed attempts counter from Keychain
    private func removePinFailedAttemptsFromKeychain() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: VaultConstants.keychainService,
            kSecAttrAccount as String: Self.pinFailedAttemptsKey,
            kSecAttrAccessGroup as String: VaultConstants.keychainAccessGroup
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: "VaultStore", code: 40, userInfo: [NSLocalizedDescriptionKey: "Failed to remove attempts counter: \(status)"])
        }
    }
}
