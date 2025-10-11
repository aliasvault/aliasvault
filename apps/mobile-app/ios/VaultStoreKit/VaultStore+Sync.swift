import Foundation
import VaultModels

/// Status response from Auth/status endpoint
public struct StatusResponse: Codable {
    public let clientVersionSupported: Bool
    public let serverVersion: String
    public let vaultRevision: Int
    public let srpSalt: String
}

/// Vault data from API
public struct VaultData: Codable {
    public let username: String
    public let blob: String
    public let version: String
    public let currentRevisionNumber: Int
    public let encryptionPublicKey: String
    public let credentialsCount: Int
    public let emailAddressList: [String]
    public let privateEmailDomainList: [String]
    public let publicEmailDomainList: [String]
    public let createdAt: String
    public let updatedAt: String
}

/// Vault response from Vault GET endpoint
public struct VaultResponse: Codable {
    public let status: Int
    public let vault: VaultData
}

/// Extension for the VaultStore class to handle vault sync operations
extension VaultStore {
    // MARK: - Vault Sync

    /// Sync the vault with the server
    /// Returns true if a new vault was downloaded, false if vault is already up to date
    public func syncVault(using webApiService: WebApiService) async throws -> Bool {
        let status = try await fetchAndValidateStatus(using: webApiService)
        setOfflineMode(false)

        let currentRevision = getCurrentVaultRevisionNumber()
        if status.vaultRevision > currentRevision {
            try await downloadAndStoreVault(using: webApiService, newRevision: status.vaultRevision)
            return true
        }

        return false
    }

    // MARK: - Private Helpers

    /// Fetch and validate server status
    private func fetchAndValidateStatus(using webApiService: WebApiService) async throws -> StatusResponse {
        let statusResponse = try await webApiService.executeRequest(
            method: "GET",
            endpoint: "Auth/status",
            body: nil,
            headers: [:],
            requiresAuth: true
        )

        // Check response status
        // Note: WebApiService already handles 401 with automatic token refresh and retry
        // If we still get a 401 here, it means the refresh failed and we should logout
        guard statusResponse.statusCode == 200 else {
            if statusResponse.statusCode == 401 {
                // Authentication failed even after token refresh attempt
                print("VaultStore: Authentication failed (401) - token refresh also failed")
                throw NSError(
                    domain: "VaultStore",
                    code: 401,
                    userInfo: [NSLocalizedDescriptionKey: "Authentication failed - please login again"]
                )
            }

            // Other error (5xx, network, etc.) - go offline
            setOfflineMode(true)
            throw NSError(
                domain: "VaultStore",
                code: statusResponse.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "Server returned status \(statusResponse.statusCode)"]
            )
        }

        guard let statusData = statusResponse.body.data(using: .utf8) else {
            print("VaultStore: Failed to convert status response to data")
            print("VaultStore: Response body: '\(statusResponse.body)'")
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to convert status response to data"]
            )
        }

        let decoder = JSONDecoder()
        let status: StatusResponse
        do {
            status = try decoder.decode(StatusResponse.self, from: statusData)
        } catch {
            print("VaultStore: Failed to decode status response: \(error)")
            print("VaultStore: Response body: '\(statusResponse.body)'")
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to parse status response: \(error.localizedDescription)"]
            )
        }

        guard status.clientVersionSupported else {
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Client version not supported"]
            )
        }

        try validateSrpSalt(status.srpSalt)
        return status
    }

    /// Validate SRP salt hasn't changed (password change detection)
    private func validateSrpSalt(_ srpSalt: String) throws {
        guard let keyDerivationParams = self.keyDerivationParams,
              let keyDerivationData = keyDerivationParams.data(using: .utf8),
              let params = try? JSONDecoder().decode(EncryptionKeyDerivationParams.self, from: keyDerivationData) else {
            return
        }

        if !srpSalt.isEmpty && srpSalt != params.salt {
            throw NSError(
                domain: "VaultStore",
                code: -2,
                userInfo: [NSLocalizedDescriptionKey: "Password has changed, please login again"]
            )
        }
    }

    /// Download vault from server and store it locally
    private func downloadAndStoreVault(using webApiService: WebApiService, newRevision: Int) async throws {
        let vaultResponse = try await webApiService.executeRequest(
            method: "GET",
            endpoint: "Vault",
            body: nil,
            headers: [:],
            requiresAuth: true
        )

        guard vaultResponse.statusCode == 200 else {
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to download vault"]
            )
        }

        let vault = try parseVaultResponse(vaultResponse.body)
        try validateVaultStatus(vault.status)
        try storeEncryptedDatabase(vault.vault.blob)
        setCurrentVaultRevisionNumber(newRevision)

        if isVaultUnlocked {
            try unlockVault()
        }
    }

    /// Parse vault response from JSON
    private func parseVaultResponse(_ body: String) throws -> VaultResponse {
        guard let vaultData = body.data(using: .utf8) else {
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to convert vault response to data"]
            )
        }

        do {
            return try JSONDecoder().decode(VaultResponse.self, from: vaultData)
        } catch {
            print("VaultStore: Failed to decode vault response: \(error)")
            print("VaultStore: Response body: \(body)")
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to parse vault response: \(error.localizedDescription)"]
            )
        }
    }

    /// Validate vault response status
    private func validateVaultStatus(_ status: Int) throws {
        switch status {
        case 0:
            return
        case 1:
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Vault merge required"]
            )
        case 2:
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Vault outdated"]
            )
        default:
            throw NSError(
                domain: "VaultStore",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Unknown vault status: \(status)"]
            )
        }
    }
}
