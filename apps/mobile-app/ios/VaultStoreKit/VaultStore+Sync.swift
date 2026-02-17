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
    public let hiddenPrivateEmailDomainList: [String]
    public let publicEmailDomainList: [String]
    public let createdAt: String
    public let updatedAt: String
}

/// Vault response from Vault GET endpoint
public struct VaultResponse: Codable {
    public let status: Int
    public let vault: VaultData
}

/// Sync state result
public struct SyncStateResult {
    public let isDirty: Bool
    public let mutationSequence: Int
    public let serverRevision: Int
    public let isSyncing: Bool

    public init(isDirty: Bool, mutationSequence: Int, serverRevision: Int, isSyncing: Bool) {
        self.isDirty = isDirty
        self.mutationSequence = mutationSequence
        self.serverRevision = serverRevision
        self.isSyncing = isSyncing
    }
}

/// Result of checking for new vault version
public struct VaultVersionCheckResult {
    public let isNewVersionAvailable: Bool
    public let newRevision: Int?
    public let serverRevision: Int
    public let syncState: SyncStateResult
}

/// Result of vault upload
public struct VaultUploadResult {
    public let success: Bool
    public let status: Int
    public let newRevisionNumber: Int
    public let mutationSeqAtStart: Int
    public let error: String?

    public init(success: Bool, status: Int, newRevisionNumber: Int, mutationSeqAtStart: Int, error: String? = nil) {
        self.success = success
        self.status = status
        self.newRevisionNumber = newRevisionNumber
        self.mutationSeqAtStart = mutationSeqAtStart
        self.error = error
    }
}

/// Action taken during sync
public enum SyncAction: String {
    case uploaded = "uploaded"
    case downloaded = "downloaded"
    case merged = "merged"
    case alreadyInSync = "already_in_sync"
    case error = "error"
}

/// Result of syncVaultWithServer operation
public struct VaultSyncResult {
    public let success: Bool
    public let action: SyncAction
    public let newRevision: Int
    public let wasOffline: Bool
    public let error: String?

    public init(success: Bool, action: SyncAction, newRevision: Int, wasOffline: Bool, error: String? = nil) {
        self.success = success
        self.action = action
        self.newRevision = newRevision
        self.wasOffline = wasOffline
        self.error = error
    }
}

/// Extension for the VaultStore class to handle vault sync operations
extension VaultStore {
    // MARK: - Vault Sync

    /// Check if a new vault version is available on the server
    /// Returns the new revision number if available, nil if vault is up to date
    public func isNewVaultVersionAvailable(using webApiService: WebApiService) async throws -> Int? {
        let status = try await fetchAndValidateStatus(using: webApiService)
        setOfflineMode(false)

        let currentRevision = getCurrentVaultRevisionNumber()
        if status.vaultRevision > currentRevision {
            return status.vaultRevision
        }

        return nil
    }

    /// Check if a new vault version is available, including sync state for merge decision
    /// This enhanced version returns sync state so the caller can decide whether to merge
    public func checkVaultVersion(using webApiService: WebApiService) async throws -> VaultVersionCheckResult {
        let status = try await fetchAndValidateStatus(using: webApiService)
        setOfflineMode(false)

        let syncState = getSyncState()
        let isNewVersionAvailable = status.vaultRevision > syncState.serverRevision

        return VaultVersionCheckResult(
            isNewVersionAvailable: isNewVersionAvailable,
            newRevision: isNewVersionAvailable ? status.vaultRevision : nil,
            serverRevision: status.vaultRevision,
            syncState: syncState
        )
    }

    /// Fetch the server vault (encrypted blob)
    /// Use this for merge operations where you need both local and server vaults
    public func fetchServerVault(using webApiService: WebApiService) async throws -> VaultResponse {
        let vaultResponse: WebApiResponse
        do {
            vaultResponse = try await webApiService.executeRequest(
                method: "GET",
                endpoint: "Vault",
                body: nil,
                headers: [:],
                requiresAuth: true
            )
        } catch {
            throw AppError.networkError(underlyingError: error)
        }

        guard vaultResponse.statusCode == 200 else {
            if vaultResponse.statusCode == 401 {
                throw AppError.sessionExpired
            }
            throw AppError.serverUnavailable(statusCode: vaultResponse.statusCode)
        }

        return try parseVaultResponse(vaultResponse.body)
    }

    /// Download and store the vault from the server
    /// This method assumes a version check has already been performed
    /// Use this after calling isNewVaultVersionAvailable() to download the vault
    public func downloadVault(using webApiService: WebApiService, newRevision: Int) async throws {
        try await downloadAndStoreVault(using: webApiService, newRevision: newRevision)
        setOfflineMode(false)
    }

    /// Unified vault sync method that handles all sync scenarios:
    /// 1. Server has newer vault → download (or merge if local changes exist)
    /// 2. Local has changes at same revision → upload
    /// 3. Both have changes → merge using LWW strategy, then upload
    /// 4. Already in sync → no action needed
    ///
    /// This method handles race detection and retries automatically.
    /// The merge logic uses the Rust core library for LWW merge.
    public func syncVaultWithServer(using webApiService: WebApiService, retryCount: Int = 0) async -> VaultSyncResult {
        let maxRetries = 3

        // Prevent infinite recursion
        guard retryCount < maxRetries else {
            return VaultSyncResult(
                success: false,
                action: .error,
                newRevision: getCurrentVaultRevisionNumber(),
                wasOffline: getOfflineMode(),
                error: "Max sync retries reached"
            )
        }

        // Mark as syncing
        setIsSyncing(true)

        do {
            // Step 1: Check vault version and get sync state
            let versionCheck = try await checkVaultVersion(using: webApiService)
            let serverRevision = versionCheck.serverRevision
            let syncState = versionCheck.syncState
            let mutationSeqAtStart = syncState.mutationSequence
            let isDirty = syncState.isDirty

            // Step 2: Determine sync action needed
            if serverRevision > syncState.serverRevision {
                // Server has newer vault
                if isDirty {
                    // MERGE: Local changes + server changes
                    return await performMergeSync(
                        using: webApiService,
                        serverRevision: serverRevision,
                        mutationSeqAtStart: mutationSeqAtStart,
                        retryCount: retryCount
                    )
                } else {
                    // DOWNLOAD: No local changes, safe to overwrite
                    return await performDownloadSync(
                        using: webApiService,
                        serverRevision: serverRevision,
                        mutationSeqAtStart: mutationSeqAtStart,
                        retryCount: retryCount
                    )
                }
            } else if serverRevision == syncState.serverRevision && isDirty {
                // UPLOAD: Local changes at same revision
                return await performUploadSync(
                    using: webApiService,
                    mutationSeqAtStart: mutationSeqAtStart,
                    retryCount: retryCount
                )
            } else if serverRevision < syncState.serverRevision {
                // Server revision DECREASED - server data loss/rollback detected.
                // Client has more advanced revision - upload to recover server state.
                //
                // This will create a revision gap in server history (e.g., 95 → 101),
                // which serves as an audit trail of the recovery event.
                print("[VaultSync] Server data loss detected! Server at rev \(serverRevision), " +
                      "client at rev \(syncState.serverRevision). Uploading to recover server state.")
                return await performUploadSync(
                    using: webApiService,
                    mutationSeqAtStart: mutationSeqAtStart,
                    retryCount: retryCount
                )
            } else {
                // Already in sync
                setIsSyncing(false)
                return VaultSyncResult(
                    success: true,
                    action: .alreadyInSync,
                    newRevision: syncState.serverRevision,
                    wasOffline: false,
                    error: nil
                )
            }
        } catch let error as AppError {
            setIsSyncing(false)
            return handleSyncError(error)
        } catch {
            setIsSyncing(false)
            return VaultSyncResult(
                success: false,
                action: .error,
                newRevision: getCurrentVaultRevisionNumber(),
                wasOffline: getOfflineMode(),
                error: error.localizedDescription
            )
        }
    }

    // MARK: - Sync Helpers

    /// Perform download-only sync (no local changes)
    private func performDownloadSync(
        using webApiService: WebApiService,
        serverRevision: Int,
        mutationSeqAtStart: Int,
        retryCount: Int
    ) async -> VaultSyncResult {
        do {
            let serverVault = try await fetchServerVault(using: webApiService)

            // Store with race detection
            let storeResult = try storeEncryptedVaultWithSyncState(
                encryptedVault: serverVault.vault.blob,
                markDirty: false,
                serverRevision: serverRevision,
                expectedMutationSeq: mutationSeqAtStart
            )

            if !storeResult.success {
                // Race detected - retry
                print("[VaultSync] Race detected during download, retrying")
                setIsSyncing(false)
                return await syncVaultWithServer(using: webApiService, retryCount: retryCount + 1)
            }

            // Store vault metadata
            let metadata = VaultMetadata(
                publicEmailDomains: serverVault.vault.publicEmailDomainList,
                privateEmailDomains: serverVault.vault.privateEmailDomainList,
                hiddenPrivateEmailDomains: serverVault.vault.hiddenPrivateEmailDomainList,
                vaultRevisionNumber: serverRevision
            )
            try storeVaultMetadata(metadata)

            // Clear dirty flag - we just downloaded fresh from server, no local changes
            setIsDirty(false)


            setIsSyncing(false)
            return VaultSyncResult(
                success: true,
                action: .downloaded,
                newRevision: serverRevision,
                wasOffline: false,
                error: nil
            )
        } catch let error as AppError {
            setIsSyncing(false)
            return handleSyncError(error)
        } catch {
            setIsSyncing(false)
            return VaultSyncResult(
                success: false,
                action: .error,
                newRevision: getCurrentVaultRevisionNumber(),
                wasOffline: getOfflineMode(),
                error: error.localizedDescription
            )
        }
    }

    /// Perform upload-only sync (local changes, no server changes)
    private func performUploadSync(
        using webApiService: WebApiService,
        mutationSeqAtStart: Int,
        retryCount: Int
    ) async -> VaultSyncResult {
        do {
            let uploadResult = try await uploadVault(using: webApiService)

            if uploadResult.success {
                // Mark clean if no new mutations during upload
                _ = markVaultClean(mutationSeqAtStart: mutationSeqAtStart, newServerRevision: uploadResult.newRevisionNumber)
                setIsSyncing(false)
                return VaultSyncResult(
                    success: true,
                    action: .uploaded,
                    newRevision: uploadResult.newRevisionNumber,
                    wasOffline: false,
                    error: nil
                )
            } else if uploadResult.status == 2 {
                // Vault outdated - server moved forward, retry to merge
                print("[VaultSync] Vault outdated during upload, retrying")
                setIsSyncing(false)
                return await syncVaultWithServer(using: webApiService, retryCount: retryCount + 1)
            } else {
                setIsSyncing(false)
                return VaultSyncResult(
                    success: false,
                    action: .error,
                    newRevision: getCurrentVaultRevisionNumber(),
                    wasOffline: false,
                    error: uploadResult.error ?? "Upload failed"
                )
            }
        } catch {
            setIsSyncing(false)
            return VaultSyncResult(
                success: false,
                action: .error,
                newRevision: getCurrentVaultRevisionNumber(),
                wasOffline: getOfflineMode(),
                error: error.localizedDescription
            )
        }
    }

    /// Perform merge sync (both local and server have changes)
    private func performMergeSync(
        using webApiService: WebApiService,
        serverRevision: Int,
        mutationSeqAtStart: Int,
        retryCount: Int
    ) async -> VaultSyncResult {
        do {
            let serverVault = try await fetchServerVault(using: webApiService)

            guard let localVault = getEncryptedDatabase() else {
                setIsSyncing(false)
                return VaultSyncResult(
                    success: false,
                    action: .error,
                    newRevision: getCurrentVaultRevisionNumber(),
                    wasOffline: false,
                    error: "No local vault available for merge"
                )
            }

            // Perform LWW merge using Rust core library via VaultMergeService
            let mergedVault = try performLWWMerge(localVault: localVault, serverVault: serverVault.vault.blob)

            // Store merged vault with race detection
            // Set serverRevision to the server's revision so prepareVault() sends correct revision when uploading
            let storeResult = try storeEncryptedVaultWithSyncState(
                encryptedVault: mergedVault,
                markDirty: false,
                serverRevision: serverVault.vault.currentRevisionNumber,
                expectedMutationSeq: mutationSeqAtStart
            )

            if !storeResult.success {
                // Race detected - retry
                print("[VaultSync] Race detected during merge, retrying")
                setIsSyncing(false)
                return await syncVaultWithServer(using: webApiService, retryCount: retryCount + 1)
            }

            // Re-unlock immediately after merge to load merged vault into memory
            // This ensures prepareVault() gets correct item counts and the UI shows merged data
            if isVaultUnlocked {
                try unlockVault()
            }

            // Upload merged vault
            let uploadResult = try await uploadVault(using: webApiService)

            if uploadResult.success {
                _ = markVaultClean(mutationSeqAtStart: mutationSeqAtStart, newServerRevision: uploadResult.newRevisionNumber)

                setIsSyncing(false)
                return VaultSyncResult(
                    success: true,
                    action: .merged,
                    newRevision: uploadResult.newRevisionNumber,
                    wasOffline: false,
                    error: nil
                )
            } else if uploadResult.status == 2 {
                // Vault outdated again - retry
                print("[VaultSync] Vault outdated after merge, retrying")
                setIsSyncing(false)
                return await syncVaultWithServer(using: webApiService, retryCount: retryCount + 1)
            } else {
                setIsSyncing(false)
                return VaultSyncResult(
                    success: false,
                    action: .error,
                    newRevision: getCurrentVaultRevisionNumber(),
                    wasOffline: false,
                    error: uploadResult.error ?? "Upload after merge failed"
                )
            }
        } catch let error as AppError {
            setIsSyncing(false)
            return handleSyncError(error)
        } catch {
            setIsSyncing(false)
            return VaultSyncResult(
                success: false,
                action: .error,
                newRevision: getCurrentVaultRevisionNumber(),
                wasOffline: getOfflineMode(),
                error: error.localizedDescription
            )
        }
    }

    /// Perform Last-Write-Wins merge between local and server vaults using Rust core library.
    ///
    /// This method delegates to VaultMergeService which handles:
    /// 1. Decrypting both vaults
    /// 2. Reading all syncable tables as JSON
    /// 3. Calling Rust core's LWW merge function
    /// 4. Applying resulting SQL statements
    /// 5. Re-encrypting the merged result
    ///
    /// - Parameters:
    ///   - localVault: Base64-encoded encrypted local vault blob
    ///   - serverVault: Base64-encoded encrypted server vault blob
    /// - Returns: Base64-encoded encrypted merged vault blob
    /// - Throws: AppError if merge fails
    private func performLWWMerge(localVault: String, serverVault: String) throws -> String {
        guard let encryptionKey = self.encryptionKey else {
            throw AppError.unknownError(message: "Encryption key not available for merge")
        }

        do {
            let mergedVault = try VaultMergeService.shared.mergeVaults(
                localVaultBase64: localVault,
                serverVaultBase64: serverVault,
                encryptionKey: encryptionKey
            )
            print("[VaultSync] LWW merge completed successfully via Rust core")
            return mergedVault
        } catch let error as VaultMergeService.VaultMergeError {
            print("[VaultSync] Merge error: \(error.localizedDescription)")
            throw AppError.unknownError(message: "Merge failed: \(error.localizedDescription)")
        } catch {
            print("[VaultSync] Unexpected merge error: \(error)")
            throw AppError.unknownError(message: "Merge failed: \(error.localizedDescription)")
        }
    }

    /// Handle sync errors and return appropriate result
    private func handleSyncError(_ error: AppError) -> VaultSyncResult {
        switch error {
        case .networkError, .serverUnavailable, .timeout:
            setOfflineMode(true)
            return VaultSyncResult(
                success: false,
                action: .error,
                newRevision: getCurrentVaultRevisionNumber(),
                wasOffline: true,
                error: error.message
            )
        case .sessionExpired, .authenticationFailed, .passwordChanged,
             .clientVersionNotSupported, .serverVersionNotSupported:
            return VaultSyncResult(
                success: false,
                action: .error,
                newRevision: getCurrentVaultRevisionNumber(),
                wasOffline: false,
                error: error.code
            )
        default:
            return VaultSyncResult(
                success: false,
                action: .error,
                newRevision: getCurrentVaultRevisionNumber(),
                wasOffline: getOfflineMode(),
                error: error.message
            )
        }
    }

    // MARK: - Private Helpers

    /// Fetch and validate server status
    private func fetchAndValidateStatus(using webApiService: WebApiService) async throws -> StatusResponse {
        let statusResponse: WebApiResponse
        do {
            statusResponse = try await webApiService.executeRequest(
                method: "GET",
                endpoint: "Auth/status",
                body: nil,
                headers: [:],
                requiresAuth: true
            )
        } catch {
            // Network error - convert to AppError
            throw AppError.networkError(underlyingError: error)
        }

        // Check response status
        // Note: WebApiService already handles 401 with automatic token refresh and retry
        // If we still get a 401 here, it means the refresh failed and we should logout
        guard statusResponse.statusCode == 200 else {
            if statusResponse.statusCode == 401 {
                // Authentication failed even after token refresh attempt
                print("VaultStore: Authentication failed (401) - token refresh also failed")
                throw AppError.sessionExpired
            }

            // Other error (5xx, network, etc.) - go offline
            setOfflineMode(true)
            throw AppError.serverUnavailable(statusCode: statusResponse.statusCode)
        }

        guard let statusData = statusResponse.body.data(using: .utf8) else {
            print("VaultStore: Failed to convert status response to data")
            print("VaultStore: Response body: '\(statusResponse.body)'")
            throw AppError.parseError(message: "Failed to convert status response to data")
        }

        let decoder = JSONDecoder()
        let status: StatusResponse
        do {
            status = try decoder.decode(StatusResponse.self, from: statusData)
        } catch {
            print("VaultStore: Failed to decode status response: \(error)")
            print("VaultStore: Response body: '\(statusResponse.body)'")
            throw AppError.parseError(message: "Failed to decode status response: \(error.localizedDescription)")
        }

        guard status.clientVersionSupported else {
            throw AppError.clientVersionNotSupported
        }

        // Validate server version meets minimum requirement
        guard VersionComparison.isServerVersionSupported(status.serverVersion) else {
            print("VaultStore: Server version \(status.serverVersion) does not meet minimum requirement \(AppInfo.minServerVersion)")
            throw AppError.serverVersionNotSupported
        }

        // Store server version in metadata
        setServerVersion(status.serverVersion)

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
            throw AppError.passwordChanged
        }
    }

    /// Download vault from server and store it locally
    private func downloadAndStoreVault(using webApiService: WebApiService, newRevision: Int) async throws {
        let vaultResponse: WebApiResponse
        do {
            vaultResponse = try await webApiService.executeRequest(
                method: "GET",
                endpoint: "Vault",
                body: nil,
                headers: [:],
                requiresAuth: true
            )
        } catch {
            throw AppError.networkError(underlyingError: error)
        }

        guard vaultResponse.statusCode == 200 else {
            if vaultResponse.statusCode == 401 {
                throw AppError.sessionExpired
            }
            throw AppError.serverUnavailable(statusCode: vaultResponse.statusCode)
        }

        let vault = try parseVaultResponse(vaultResponse.body)
        try validateVaultStatus(vault.status)
        try storeEncryptedDatabase(vault.vault.blob)
        setCurrentVaultRevisionNumber(newRevision)

        // Store vault metadata (public/private email domains)
        let metadata = VaultMetadata(
            publicEmailDomains: vault.vault.publicEmailDomainList,
            privateEmailDomains: vault.vault.privateEmailDomainList,
            hiddenPrivateEmailDomains: vault.vault.hiddenPrivateEmailDomainList,
            vaultRevisionNumber: newRevision
        )
        try storeVaultMetadata(metadata)

        if isVaultUnlocked {
            try unlockVault()
        }
    }

    /// Store vault metadata
    private func storeVaultMetadata(_ metadata: VaultMetadata) throws {
        let encoder = JSONEncoder()
        guard let metadataData = try? encoder.encode(metadata),
              let metadataJson = String(data: metadataData, encoding: .utf8) else {
            throw AppError.parseError(message: "Failed to encode vault metadata")
        }

        try storeMetadata(metadataJson)
    }

    /// Parse vault response from JSON
    private func parseVaultResponse(_ body: String) throws -> VaultResponse {
        guard let vaultData = body.data(using: .utf8) else {
            throw AppError.parseError(message: "Failed to convert vault response to data")
        }

        do {
            return try JSONDecoder().decode(VaultResponse.self, from: vaultData)
        } catch {
            print("VaultStore: Failed to decode vault response: \(error)")
            print("VaultStore: Response body: \(body)")
            throw AppError.parseError(message: "Failed to decode vault response: \(error.localizedDescription)")
        }
    }

    /// Validate vault response status
    private func validateVaultStatus(_ status: Int) throws {
        switch status {
        case 0:
            return
        case 1:
            throw AppError.vaultMergeRequired
        case 2:
            throw AppError.vaultOutdated
        default:
            throw AppError.unknownError(message: "Unknown vault status: \(status)")
        }
    }
}
