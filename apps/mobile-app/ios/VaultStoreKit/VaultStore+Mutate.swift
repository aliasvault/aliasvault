import Foundation
import VaultModels

/// Vault upload model that matches the API contract
public struct VaultUpload: Codable {
    public let blob: String
    public let createdAt: String
    public let credentialsCount: Int
    public let currentRevisionNumber: Int
    public let emailAddressList: [String]
    public let privateEmailDomainList: [String]
    public let publicEmailDomainList: [String]
    public let encryptionPublicKey: String
    public let updatedAt: String
    public let username: String
    public let version: String
    public let client: String
}

/// Vault POST response from API
public struct VaultPostResponse: Codable {
    public let status: Int
    public let newRevisionNumber: Int
}

/// Extension for the VaultStore class to handle vault mutation operations
extension VaultStore {
    // MARK: - Vault Preparation

    /// Prepare the vault for upload by assembling all metadata
    /// Returns a VaultUpload object ready to be sent to the server
    public func prepareVault() throws -> VaultUpload {
        // Get the current vault revision number
        let currentRevision = getCurrentVaultRevisionNumber()

        // Get the encrypted database
        guard let encryptedDb = getEncryptedDatabase() else {
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to get encrypted database"]
            )
        }

        // Get username
        guard let username = getUsername() else {
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Username not found"]
            )
        }

        // Ensure vault is unlocked to query database
        guard isVaultUnlocked else {
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Vault must be unlocked to prepare for upload"]
            )
        }

        // Get all credentials to count them and extract private email addresses
        let credentials = try getAllCredentials()

        // Get private email domains from metadata
        let metadata = getVaultMetadataObject()
        let privateEmailDomains = metadata?.privateEmailDomains ?? []

        // Extract private email addresses from credentials
        let privateEmailAddresses = credentials
            .compactMap { $0.alias?.email }
            .filter { email in
                // Check if email belongs to any private domain
                privateEmailDomains.contains { domain in
                    email.lowercased().hasSuffix("@\(domain.lowercased())")
                }
            }
            // Remove duplicates
            .reduce(into: [String]()) { result, email in
                if !result.contains(email) {
                    result.append(email)
                }
            }

        // Get database version
        let dbVersion = try getDatabaseVersion()

        // Get client version
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        let baseVersion = version.split(separator: "-").first.map(String.init) ?? "0.0.0"
        let client = "ios-\(baseVersion)"

        // Format dates in ISO 8601 format
        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let now = dateFormatter.string(from: Date())

        return VaultUpload(
            blob: encryptedDb,
            createdAt: now,
            credentialsCount: credentials.count,
            currentRevisionNumber: currentRevision,
            emailAddressList: privateEmailAddresses,
            privateEmailDomainList: [], // Empty on purpose, API will not use this for vault updates
            publicEmailDomainList: [], // Empty on purpose, API will not use this for vault updates
            encryptionPublicKey: "", // Empty on purpose, only required if new public/private key pair is generated
            updatedAt: now,
            username: username,
            version: dbVersion,
            client: client
        )
    }

    // MARK: - Vault Mutation

    /// Execute a vault mutation operation
    /// This method:
    /// 1. Executes the provided SQL operation (already wrapped in a transaction by caller)
    /// 2. Prepares the vault for upload
    /// 3. Uploads the vault to the server
    /// 4. Updates the local revision number
    ///
    /// Note: The caller must wrap their database operations in beginTransaction()/commitTransaction()
    /// which will trigger the encryption and local storage of the database.
    public func mutateVault(using webApiService: WebApiService) async throws {
        // Prepare vault for upload
        let vault = try prepareVault()

        // Convert to JSON (use default key encoding which is camelCase)
        let encoder = JSONEncoder()
        let jsonData = try encoder.encode(vault)
        guard let jsonString = String(data: jsonData, encoding: .utf8) else {
            print("VaultStore: Failed to encode vault to JSON")
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to encode vault to JSON"]
            )
        }

        // Upload to server
        let response = try await webApiService.executeRequest(
            method: "POST",
            endpoint: "Vault",
            body: jsonString,
            headers: ["Content-Type": "application/json"],
            requiresAuth: true
        )

        // Check response status
        guard response.statusCode == 200 else {
            print("VaultStore: Server rejected vault upload with status \(response.statusCode)")
            print("VaultStore: Response body: \(response.body)")

            // If we get here, the server rejected the vault update
            if response.statusCode >= 400 {
                throw NSError(
                    domain: "VaultStore",
                    code: response.statusCode,
                    userInfo: [NSLocalizedDescriptionKey: "Server returned error: \(response.statusCode)"]
                )
            }

            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Unexpected server response: \(response.statusCode)"]
            )
        }

        // Parse response
        guard let responseData = response.body.data(using: .utf8) else {
            print("VaultStore: Failed to convert response body to data")
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to convert response body to data"]
            )
        }

        let vaultResponse: VaultPostResponse
        do {
            vaultResponse = try JSONDecoder().decode(VaultPostResponse.self, from: responseData)
        } catch {
            print("VaultStore: Failed to parse vault upload response: \(error)")
            print("VaultStore: Response body: \(response.body)")
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to parse vault upload response: \(error.localizedDescription)"]
            )
        }

        // Check vault response status
        if vaultResponse.status == 0 {
            // Success - update local revision number
            setCurrentVaultRevisionNumber(vaultResponse.newRevisionNumber)

            // Clear offline mode on successful upload
            setOfflineMode(false)
        } else if vaultResponse.status == 1 {
            // Merge required (should not happen with API >= 0.20.0)
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Vault merge required"]
            )
        } else if vaultResponse.status == 2 {
            // Vault outdated
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Vault is outdated, please sync first"]
            )
        } else {
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to upload vault"]
            )
        }
    }

    // MARK: - Helper Methods

    /// Get the database version from the __EFMigrationsHistory table
    /// Extracts version from migration ID pattern like "20240917191243_1.4.1-RenameAttachmentsPlural"
    private func getDatabaseVersion() throws -> String {
        let query = "SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1"
        let results = try executeQuery(query, params: [])

        guard let firstRow = results.first,
              let migrationId = firstRow["MigrationId"] as? String else {
            print("VaultStore: No migrations found in database, returning default version")
            return "0.0.0"
        }

        // Extract version using regex - matches patterns like "_1.4.1-"
        let versionRegex = try NSRegularExpression(pattern: "_(\\d+\\.\\d+\\.\\d+)-")
        let nsString = migrationId as NSString
        let matches = versionRegex.matches(in: migrationId, range: NSRange(location: 0, length: nsString.length))

        if let match = matches.first, match.numberOfRanges > 1 {
            let versionRange = match.range(at: 1)
            let version = nsString.substring(with: versionRange)
            return version
        }

        print("VaultStore: Could not extract version from migration ID '\(migrationId)', returning default")
        return "0.0.0"
    }
}
