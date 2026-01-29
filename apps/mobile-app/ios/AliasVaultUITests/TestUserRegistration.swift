import Foundation
import CryptoKit
import SQLite3

// Import the Rust core SRP functions
import RustCoreFramework

// Import VaultModels for VaultVersions and VaultSql
import VaultModels

/// Test user credentials and token.
struct TestUser {
    let username: String
    let password: String
    let token: String
    let refreshToken: String
}

/// API response models
struct TokenResponse: Codable {
    let token: String
    let refreshToken: String
}

struct ApiError: Codable {
    let title: String?
    let message: String?
}

/// Default encryption settings for Argon2Id.
/// These match the server defaults in AliasVault.Cryptography.Client/Defaults.cs
enum EncryptionDefaults {
    static let type = "Argon2Id"
    static let iterations: UInt32 = 2
    static let memorySize: UInt32 = 19456
    static let parallelism: UInt32 = 1

    static var settingsJson: String {
        """
        {"DegreeOfParallelism":\(parallelism),"MemorySize":\(memorySize),"Iterations":\(iterations)}
        """
    }
}

/// Test user registration helper using SRP protocol.
/// Mirrors the browser extension's test-api.ts implementation.
enum TestUserRegistration {

    /// API URL for testing (defaults to local development server)
    static var apiUrl: String {
        return ProcessInfo.processInfo.environment["API_URL"] ?? "http://localhost:5092"
    }

    // MARK: - Username/Password Generation

    /// Generate a random test username.
    static func generateTestUsername() -> String {
        let randomPart = String((0..<10).map { _ in "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()! })
        return "test_\(randomPart)@example.tld"
    }

    /// Generate a test password.
    /// Uses a static password for easier debugging and test reproducibility.
    static func generateTestPassword() -> String {
        return "password"
    }

    /// Normalize username by converting to lowercase and trimming whitespace.
    static func normalizeUsername(_ username: String) -> String {
        return username.lowercased().trimmingCharacters(in: .whitespaces)
    }

    // MARK: - Argon2 Key Derivation

    /// Derive encryption key from password using Argon2Id via Rust core.
    ///
    /// Uses the AliasVault default parameters:
    /// - Iterations: 2
    /// - Memory: 19456 KiB
    /// - Parallelism: 1
    /// - Output length: 32 bytes
    static func deriveKeyArgon2(_ password: String, salt: String) throws -> Data {
        // Use the Rust core's Argon2 implementation
        let hashHex = try argon2HashPassword(password: password, salt: salt)

        // Convert hex string to Data
        return try hexToBytes(hashHex)
    }

    // MARK: - Hex Conversion

    /// Convert Data to uppercase hex string.
    static func bytesToHex(_ data: Data) -> String {
        return data.map { String(format: "%02X", $0) }.joined()
    }

    /// Convert hex string to Data.
    static func hexToBytes(_ hex: String) throws -> Data {
        var hex = hex.trimmingCharacters(in: .whitespaces)
        if hex.hasPrefix("0x") || hex.hasPrefix("0X") {
            hex = String(hex.dropFirst(2))
        }

        guard hex.count % 2 == 0 else {
            throw NSError(domain: "TestUserRegistration", code: 3,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid hex string length"])
        }

        var data = Data()
        var index = hex.startIndex
        while index < hex.endIndex {
            let nextIndex = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<nextIndex], radix: 16) else {
                throw NSError(domain: "TestUserRegistration", code: 4,
                             userInfo: [NSLocalizedDescriptionKey: "Invalid hex character"])
            }
            data.append(byte)
            index = nextIndex
        }
        return data
    }

    // MARK: - Registration

    /// Register a new test user via the API using SRP protocol.
    static func registerTestUser(
        apiBaseUrl: String,
        username: String,
        password: String
    ) async throws -> TokenResponse {
        let baseUrl = apiBaseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/"
        let normalizedUsername = normalizeUsername(username)

        // Generate salt using Rust core
        let salt = srpGenerateSalt()

        // Derive key from password
        let encryptionKey = try deriveKeyArgon2(password, salt: salt)
        let passwordHashHex = bytesToHex(encryptionKey)

        // Derive SRP private key and verifier using Rust core
        let privateKey = try srpDerivePrivateKey(salt: salt, identity: normalizedUsername, passwordHash: passwordHashHex)
        let verifier = try srpDeriveVerifier(privateKey: privateKey)

        // Build registration request
        let registerRequest: [String: Any] = [
            "username": normalizedUsername,
            "salt": salt,
            "verifier": verifier,
            "encryptionType": EncryptionDefaults.type,
            "encryptionSettings": EncryptionDefaults.settingsJson
        ]

        let requestData = try JSONSerialization.data(withJSONObject: registerRequest)

        // Send registration request
        var request = URLRequest(url: URL(string: "\(baseUrl)Auth/register")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = requestData

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "TestUserRegistration", code: 5,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard httpResponse.statusCode == 200 else {
            let errorMessage: String
            if let apiError = try? JSONDecoder().decode(ApiError.self, from: data) {
                errorMessage = apiError.title ?? apiError.message ?? "Unknown error"
            } else if let text = String(data: data, encoding: .utf8) {
                errorMessage = text
            } else {
                errorMessage = "HTTP \(httpResponse.statusCode)"
            }
            throw NSError(domain: "TestUserRegistration", code: httpResponse.statusCode,
                         userInfo: [NSLocalizedDescriptionKey: "Registration failed: \(errorMessage)"])
        }

        let tokenResponse = try JSONDecoder().decode(TokenResponse.self, from: data)

        // Upload initial empty vault
        try await uploadInitialVault(
            apiBaseUrl: apiBaseUrl,
            token: tokenResponse.token,
            username: normalizedUsername,
            encryptionKey: encryptionKey
        )

        return tokenResponse
    }

    // MARK: - Vault Upload

    /// Upload an initial empty vault to the server.
    static func uploadInitialVault(
        apiBaseUrl: String,
        token: String,
        username: String,
        encryptionKey: Data
    ) async throws {
        let baseUrl = apiBaseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/"

        // Create empty vault database (minimal SQLite)
        let vaultBase64 = createEmptyVaultDatabase()

        // Encrypt the vault using AES-GCM
        let encryptedVault = try symmetricEncrypt(plaintext: vaultBase64, key: encryptionKey)

        // Generate RSA key pair for the vault
        let rsaKeyPair = try generateRsaKeyPair()

        // Get current timestamp
        let now = ISO8601DateFormatter().string(from: Date())

        // Build vault upload request
        let vaultRequest: [String: Any] = [
            "username": normalizeUsername(username),
            "blob": encryptedVault,
            "version": VaultVersions.latestVersion, // From auto-generated VaultVersions.swift
            "currentRevisionNumber": VaultVersions.latestRevision,
            "encryptionPublicKey": rsaKeyPair.publicKey,
            "credentialsCount": 0,
            "emailAddressList": [String](),
            "privateEmailDomainList": [String](),
            "hiddenPrivateEmailDomainList": [String](),
            "publicEmailDomainList": [String](),
            "createdAt": now,
            "updatedAt": now
        ]

        let requestData = try JSONSerialization.data(withJSONObject: vaultRequest)

        var request = URLRequest(url: URL(string: "\(baseUrl)Vault")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = requestData

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "TestUserRegistration", code: 6,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to upload vault: \(errorText)"])
        }
    }

    // MARK: - Encryption Helpers

    /// Encrypt data using AES-GCM (matches browser extension's EncryptionUtility).
    static func symmetricEncrypt(plaintext: String, key: Data) throws -> String {
        guard let plaintextData = plaintext.data(using: .utf8) else {
            throw NSError(domain: "TestUserRegistration", code: 7,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid plaintext encoding"])
        }

        let symmetricKey = SymmetricKey(data: key)
        let sealedBox = try AES.GCM.seal(plaintextData, using: symmetricKey)

        // Combined format: nonce + ciphertext + tag
        guard let combined = sealedBox.combined else {
            throw NSError(domain: "TestUserRegistration", code: 8,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to get combined sealed box"])
        }

        return combined.base64EncodedString()
    }

    /// Generate RSA key pair for vault encryption.
    static func generateRsaKeyPair() throws -> (publicKey: String, privateKey: String) {
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits as String: 2048
        ]

        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw error!.takeRetainedValue() as Error
        }

        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw NSError(domain: "TestUserRegistration", code: 9,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to get public key"])
        }

        // Export keys as JWK format
        let publicKeyJwk = try exportKeyAsJwk(publicKey, isPrivate: false)
        let privateKeyJwk = try exportKeyAsJwk(privateKey, isPrivate: true)

        return (publicKeyJwk, privateKeyJwk)
    }

    /// Export a SecKey as JWK JSON string.
    static func exportKeyAsJwk(_ key: SecKey, isPrivate: Bool) throws -> String {
        var error: Unmanaged<CFError>?
        guard let keyData = SecKeyCopyExternalRepresentation(key, &error) as Data? else {
            throw error!.takeRetainedValue() as Error
        }

        // For RSA keys, create a simplified JWK
        // This is a basic implementation - production would need full JWK encoding
        let base64Key = keyData.base64EncodedString()

        let jwk: [String: Any] = [
            "kty": "RSA",
            "key_ops": isPrivate ? ["decrypt"] : ["encrypt"],
            "ext": true,
            "key": base64Key
        ]

        let jsonData = try JSONSerialization.data(withJSONObject: jwk)
        return String(data: jsonData, encoding: .utf8)!
    }

    // MARK: - Empty Vault Creation

    /// Create an empty vault database as base64 string.
    /// This creates a real SQLite database with the vault schema using VaultSql.completeSchema.
    static func createEmptyVaultDatabase() -> String {
        // Create a temporary SQLite database file
        let tempDir = FileManager.default.temporaryDirectory
        let dbPath = tempDir.appendingPathComponent(UUID().uuidString + ".db").path

        var database: OpaquePointer?

        // Open/create the database
        guard sqlite3_open(dbPath, &database) == SQLITE_OK else {
            print("Failed to create SQLite database")
            return ""
        }

        defer {
            sqlite3_close(database)
            try? FileManager.default.removeItem(atPath: dbPath)
        }

        // Execute the complete schema SQL from VaultSql (auto-generated from TypeScript)
        let schemaSql = VaultSql.completeSchema
        var errorMessage: UnsafeMutablePointer<CChar>?

        let result = sqlite3_exec(database, schemaSql, nil, nil, &errorMessage)
        if result != SQLITE_OK {
            let error = errorMessage.map { String(cString: $0) } ?? "Unknown error"
            print("Failed to execute schema SQL: \(error)")
            sqlite3_free(errorMessage)
            return ""
        }

        // Read the database file and encode as base64
        guard let dbData = FileManager.default.contents(atPath: dbPath) else {
            print("Failed to read database file")
            return ""
        }

        return dbData.base64EncodedString()
    }

    // MARK: - Public API

    /// Create a test user with random credentials.
    static func createTestUser(apiBaseUrl: String? = nil) async throws -> TestUser {
        let url = apiBaseUrl ?? apiUrl
        let username = generateTestUsername()
        let password = generateTestPassword()

        let tokenResponse = try await registerTestUser(
            apiBaseUrl: url,
            username: username,
            password: password
        )

        return TestUser(
            username: username,
            password: password,
            token: tokenResponse.token,
            refreshToken: tokenResponse.refreshToken
        )
    }

    /// Check if the API is available.
    static func isApiAvailable(apiBaseUrl: String? = nil) async -> Bool {
        let url = (apiBaseUrl ?? apiUrl).trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/"

        var request = URLRequest(url: URL(string: "\(url)Auth/status")!)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 5

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse {
                // Status endpoint returns 401 when not authenticated, but that means API is running
                return httpResponse.statusCode == 401 || httpResponse.statusCode == 200
            }
            return false
        } catch {
            return false
        }
    }

    // MARK: - Test Helpers (DEV API Endpoints)

    /// Delete the newest vault revisions for the authenticated user.
    /// This endpoint only works in development mode.
    /// Used for testing RPO (Recovery Point Objective) recovery scenarios.
    ///
    /// - Parameters:
    ///   - count: Number of newest revisions to delete
    ///   - token: Authentication token
    ///   - apiBaseUrl: Optional API base URL (defaults to apiUrl)
    /// - Returns: Number of deleted revisions
    static func deleteVaultRevisions(
        count: Int,
        token: String,
        apiBaseUrl: String? = nil
    ) async throws -> Int {
        let url = (apiBaseUrl ?? apiUrl).trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/"

        var request = URLRequest(url: URL(string: "\(url)Test/vault-revisions/\(count)")!)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "TestUserRegistration", code: 10,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "TestUserRegistration", code: httpResponse.statusCode,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to delete vault revisions: \(errorText)"])
        }

        // Parse response to get deleted count
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let deleted = json["deleted"] as? Int {
            return deleted
        }

        return 0
    }

    /// Get vault revision information for the authenticated user.
    /// This endpoint only works in development mode.
    ///
    /// - Parameters:
    ///   - token: Authentication token
    ///   - apiBaseUrl: Optional API base URL (defaults to apiUrl)
    /// - Returns: Tuple of (count, currentRevision)
    static func getVaultRevisions(
        token: String,
        apiBaseUrl: String? = nil
    ) async throws -> (count: Int, currentRevision: Int) {
        let url = (apiBaseUrl ?? apiUrl).trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/"

        var request = URLRequest(url: URL(string: "\(url)Test/vault-revisions")!)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "TestUserRegistration", code: 10,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "TestUserRegistration", code: httpResponse.statusCode,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to get vault revisions: \(errorText)"])
        }

        // Parse response
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let count = json["count"] as? Int,
           let currentRevision = json["currentRevision"] as? Int {
            return (count, currentRevision)
        }

        return (0, 0)
    }

    /// Block the authenticated user's account.
    /// This endpoint only works in development mode.
    /// Used for testing forced logout scenarios - blocked users get 401 from /status endpoint.
    ///
    /// - Parameters:
    ///   - token: Authentication token
    ///   - apiBaseUrl: Optional API base URL (defaults to apiUrl)
    static func blockUser(
        token: String,
        apiBaseUrl: String? = nil
    ) async throws {
        let url = (apiBaseUrl ?? apiUrl).trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/"

        var request = URLRequest(url: URL(string: "\(url)Test/block-user")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "TestUserRegistration", code: 11,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "TestUserRegistration", code: httpResponse.statusCode,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to block user: \(errorText)"])
        }
    }

    /// Unblock the authenticated user's account.
    /// This endpoint only works in development mode.
    /// Used after forced logout tests to re-enable the account.
    ///
    /// - Parameters:
    ///   - token: Authentication token
    ///   - apiBaseUrl: Optional API base URL (defaults to apiUrl)
    static func unblockUser(
        token: String,
        apiBaseUrl: String? = nil
    ) async throws {
        let url = (apiBaseUrl ?? apiUrl).trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/"

        var request = URLRequest(url: URL(string: "\(url)Test/unblock-user")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "TestUserRegistration", code: 12,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "TestUserRegistration", code: httpResponse.statusCode,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to unblock user: \(errorText)"])
        }
    }

    // MARK: - Username-based API calls (for UI tests that can't access app tokens)

    /// Get vault revision information for a user by username.
    /// This is an anonymous endpoint that doesn't require authentication.
    /// Used by UI tests that cannot access the app's auth token.
    ///
    /// - Parameters:
    ///   - username: The username to look up
    ///   - apiBaseUrl: Optional API base URL (defaults to apiUrl)
    /// - Returns: Tuple of (count, currentRevision)
    static func getVaultRevisionsByUsername(
        username: String,
        apiBaseUrl: String? = nil
    ) async throws -> (count: Int, currentRevision: Int) {
        let url = (apiBaseUrl ?? apiUrl).trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/"
        // Use alphanumerics for safe URL path encoding (encodes @, ., etc.)
        let encodedUsername = username.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? username

        guard let requestUrl = URL(string: "\(url)Test/vault-revisions/by-username/\(encodedUsername)") else {
            throw NSError(domain: "TestUserRegistration", code: 13,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid URL for username: \(username)"])
        }
        var request = URLRequest(url: requestUrl)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "TestUserRegistration", code: 13,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "TestUserRegistration", code: httpResponse.statusCode,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to get vault revisions: \(errorText)"])
        }

        // Parse response
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let count = json["count"] as? Int,
           let currentRevision = json["currentRevision"] as? Int {
            return (count, currentRevision)
        }

        return (0, 0)
    }

    /// Delete the newest vault revisions for a user by username.
    /// This is an anonymous endpoint that doesn't require authentication.
    /// Used by UI tests that cannot access the app's auth token.
    ///
    /// - Parameters:
    ///   - username: The username to look up
    ///   - count: Number of newest revisions to delete
    ///   - apiBaseUrl: Optional API base URL (defaults to apiUrl)
    /// - Returns: Number of deleted revisions
    static func deleteVaultRevisionsByUsername(
        username: String,
        count: Int,
        apiBaseUrl: String? = nil
    ) async throws -> Int {
        let url = (apiBaseUrl ?? apiUrl).trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/"
        // Use alphanumerics for safe URL path encoding (encodes @, ., etc.)
        let encodedUsername = username.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? username

        guard let requestUrl = URL(string: "\(url)Test/vault-revisions/by-username/\(encodedUsername)/\(count)") else {
            throw NSError(domain: "TestUserRegistration", code: 14,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid URL for username: \(username)"])
        }
        var request = URLRequest(url: requestUrl)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "TestUserRegistration", code: 14,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "TestUserRegistration", code: httpResponse.statusCode,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to delete vault revisions: \(errorText)"])
        }

        // Parse response
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let deleted = json["deleted"] as? Int {
            return deleted
        }

        return 0
    }

    /// Block a user's account by username.
    /// This is an anonymous endpoint that doesn't require authentication.
    /// Used by UI tests that cannot access the app's auth token.
    ///
    /// - Parameters:
    ///   - username: The username to block
    ///   - apiBaseUrl: Optional API base URL (defaults to apiUrl)
    static func blockUserByUsername(
        username: String,
        apiBaseUrl: String? = nil
    ) async throws {
        let url = (apiBaseUrl ?? apiUrl).trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/"
        // Use alphanumerics for safe URL path encoding (encodes @, ., etc.)
        let encodedUsername = username.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? username

        guard let requestUrl = URL(string: "\(url)Test/block-user/by-username/\(encodedUsername)") else {
            throw NSError(domain: "TestUserRegistration", code: 15,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid URL for username: \(username)"])
        }
        var request = URLRequest(url: requestUrl)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "TestUserRegistration", code: 15,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "TestUserRegistration", code: httpResponse.statusCode,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to block user: \(errorText)"])
        }
    }

    /// Unblock a user's account by username.
    /// This is an anonymous endpoint that doesn't require authentication.
    /// Used by UI tests that cannot access the app's auth token.
    ///
    /// - Parameters:
    ///   - username: The username to unblock
    ///   - apiBaseUrl: Optional API base URL (defaults to apiUrl)
    static func unblockUserByUsername(
        username: String,
        apiBaseUrl: String? = nil
    ) async throws {
        let url = (apiBaseUrl ?? apiUrl).trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/"
        // Use alphanumerics for safe URL path encoding (encodes @, ., etc.)
        let encodedUsername = username.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? username

        guard let requestUrl = URL(string: "\(url)Test/unblock-user/by-username/\(encodedUsername)") else {
            throw NSError(domain: "TestUserRegistration", code: 16,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid URL for username: \(username)"])
        }
        var request = URLRequest(url: requestUrl)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NSError(domain: "TestUserRegistration", code: 16,
                         userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard httpResponse.statusCode == 200 else {
            let errorText = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw NSError(domain: "TestUserRegistration", code: httpResponse.statusCode,
                         userInfo: [NSLocalizedDescriptionKey: "Failed to unblock user: \(errorText)"])
        }
    }
}
