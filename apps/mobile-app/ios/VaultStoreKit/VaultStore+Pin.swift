import Foundation
import Security
import RustCoreFramework
import VaultModels
import VaultUtils

/// Extension for the VaultStore class to handle PIN unlock functionality.
/// The key wrap and the attempt policy live in the Rust core (crypto/pin.rs); this file only stores them.
/// Other platform implementations: VaultPin.kt (Android), PinUnlockService.ts (browser extension).
extension VaultStore {
    // MARK: - PIN Constants

    private static let pinEncryptedKeyKey = "pinEncryptedKey"
    private static let pinSaltKey = "pinSalt"
    private static let pinLengthKey = "pinLength"
    private static let pinFailedAttemptsKey = "pinFailedAttempts"

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

    /// Get the failed attempts count from secure storage, or nil when it is unreadable (which counts as locked).
    private func getPinFailedAttempts() -> UInt32? {
        return try? retrievePinFailedAttemptsFromKeychain()
    }

    // MARK: - PIN Setup Methods

    /// Setup PIN unlock
    /// Encrypts the vault encryption key (from memory) with the PIN and stores it securely
    /// The encryption key is retrieved internally and never exposed to React Native layer
    ///
    /// - Parameters:
    ///   - pin: The PIN to set (4+ digits)
    /// - Throws: Error if PIN is invalid, vault not unlocked, encryption fails, or keystore unavailable
    public func setupPin(_ pin: String) throws {
        // Check if keystore is available (device passcode must be set)
        guard isKeystoreAvailable() else {
            print("Cannot setup PIN: device passcode not set")
            throw AppError.biometricNotAvailable
        }

        // The PIN protects the Account Key (vault must be unlocked), never the vault key
        try encryptKeyWithPin(try getAccountKey(), pin: pin)
        print("PIN unlock enabled successfully")
    }

    /// Encrypt the Account Key with a key derived from the PIN and keep it in the keychain.
    internal func encryptKeyWithPin(_ accountKey: Data, pin: String) throws {
        let salt = RustCoreFramework.pinGenerateSalt()
        let encryptedData = try RustCoreFramework.pinEncrypt(pin: pin, salt: salt, secret: accountKey)

        // Store encrypted key and salt in keychain (without biometric protection)
        try storePinDataInKeychain(encryptedKey: encryptedData, salt: salt)

        // Initialize failed attempts counter in Keychain
        try storePinFailedAttemptsInKeychain(0)

        // Store PIN metadata in UserDefaults (non-sensitive data only)
        userDefaults.set(true, forKey: VaultConstants.pinEnabledKey)
        userDefaults.set(pin.count, forKey: Self.pinLengthKey)
        userDefaults.synchronize()
    }

    // MARK: - PIN Unlock Methods

    /// Unlock with PIN
    /// Returns the Account Key
    ///
    /// - Parameter pin: The PIN to use for unlocking
    /// - Returns: The decrypted key (base64), to open the session with
    /// - Throws: PinUnlockError with specific error type and metadata
    public func unlockWithPin(_ pin: String) throws -> String {
        let pinProtectedKey = try decryptPinProtectedKey(pin)
        let accountKey = try openAccountKeyChain(with: pinProtectedKey).accountKey
        convertLegacyPinKey(pin: pin, pinKey: pinProtectedKey, accountKey: accountKey)
        return accountKey.base64EncodedString()
    }

    /// Decrypt the key the PIN protects, counting a failure against the PIN attempts.
    private func decryptPinProtectedKey(_ pin: String) throws -> Data {
        guard let failedAttempts = getPinFailedAttempts(), !RustCoreFramework.pinIsLocked(failedAttempts: failedAttempts) else {
            try? removeAndDisablePin()
            throw PinUnlockError.locked
        }

        do {
            let (encryptedKey, salt) = try retrievePinDataFromKeychain()
            let decryptedKey = try RustCoreFramework.pinDecrypt(pin: pin, salt: salt, encrypted: encryptedKey)

            // Reset failed attempts on success
            try storePinFailedAttemptsInKeychain(0)
            markSuccessfulAuth()

            return decryptedKey
        } catch {
            let failure = RustCoreFramework.pinRegisterFailure(failedAttempts: failedAttempts)
            try? storePinFailedAttemptsInKeychain(Int(failure.failedAttempts))

            // If max attempts reached, disable PIN and clear all stored data
            if failure.locked {
                try? removeAndDisablePin()
                throw PinUnlockError.locked
            }

            throw PinUnlockError.incorrectPin(attemptsRemaining: Int(failure.attemptsRemaining))
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

        // Clear PIN metadata from UserDefaults
        userDefaults.removeObject(forKey: VaultConstants.pinEnabledKey)
        userDefaults.removeObject(forKey: Self.pinLengthKey)
        userDefaults.synchronize()

        print("PIN unlock disabled and all data removed")
    }

    // MARK: - Private PIN Methods

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
    private func retrievePinFailedAttemptsFromKeychain() throws -> UInt32 {
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

        if status == errSecItemNotFound {
            return 0
        }

        guard status == errSecSuccess, let data = result as? Data, data.count == MemoryLayout<Int>.size else {
            throw NSError(domain: "VaultStore", code: 42, userInfo: [NSLocalizedDescriptionKey: "Failed to read PIN failed attempts: \(status)"])
        }

        let attempts = data.withUnsafeBytes { $0.loadUnaligned(as: Int.self) }
        guard attempts >= 0, let count = UInt32(exactly: attempts) else {
            throw NSError(domain: "VaultStore", code: 43, userInfo: [NSLocalizedDescriptionKey: "Invalid PIN failed attempts value"])
        }
        return count
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
