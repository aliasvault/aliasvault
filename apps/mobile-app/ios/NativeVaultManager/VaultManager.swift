import Foundation
import LocalAuthentication
import VaultStoreKit
import VaultModels
import SwiftUI
import VaultUI
import VaultUtils
import AVFoundation
import RustCoreFramework
import AuthenticationServices
import StoreKit

/**
 * This class is used as a bridge to allow React Native to interact with the VaultStoreKit class.
 * The VaultStore class is implemented in Swift and used by both React Native and the native iOS
 * Autofill extension.
 */
@objc(VaultManager)
public class VaultManager: NSObject {
    private let vaultStore = VaultStore.shared
    private let webApiService = WebApiService()

    override init() {
        super.init()
    }

    @objc
    func storeMetadata(_ metadata: String,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.storeMetadata(metadata)
            resolve(nil)
        } catch {
            reject("METADATA_ERROR", "Failed to store metadata: \(error.localizedDescription)", error)
        }
    }

    @objc
    func setAuthMethods(_ authMethods: [String],
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            var methods: AuthMethods = []

            for method in authMethods {
                switch method.lowercased() {
                case "faceid":
                    methods.insert(.faceID)
                case "password":
                    methods.insert(.password)
                default:
                    reject("INVALID_AUTH_METHOD", "Invalid authentication method: \(method)", nil)
                    return
                }
            }

            try vaultStore.setAuthMethods(methods)
            resolve(nil)
        } catch {
            reject("AUTH_METHOD_ERROR", "Failed to set authentication methods: \(error.localizedDescription)", error)
        }
    }

    /// Open a session in memory with the unlock key (the password-derived KEK), without keychain persistence.
    /// Use this to test if a password-derived key is valid before persisting.
    @objc
    func storeUnlockKeyInMemory(_ base64UnlockKey: String,
                                    resolver resolve: @escaping RCTPromiseResolveBlock,
                                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.storeUnlockKeyInMemory(base64Key: base64UnlockKey)
            resolve(nil)
        } catch {
            reject("ERR_STORE_KEY_MEMORY", "Failed to store unlock key in memory: \(error.localizedDescription)", error)
        }
    }

    /// Open a session with the unlock key (the password-derived KEK) AND persist it to keychain if Face ID is enabled.
    @objc
    func storeUnlockKey(_ base64UnlockKey: String,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.storeUnlockKey(base64Key: base64UnlockKey)
            resolve(nil)
        } catch {
            reject("KEYCHAIN_ERROR", "Failed to store unlock key: \(error.localizedDescription)", error)
        }
    }

    /// Clear the encryption key from memory.
    /// This forces getEncryptionKey() to fetch from keychain on next biometric access.
    @objc
    func clearEncryptionKeyFromMemory(_ resolve: @escaping RCTPromiseResolveBlock,
                                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        vaultStore.clearEncryptionKeyFromMemory()
        resolve(nil)
    }

    @objc
    func storeUnlockKeyDerivationParams(_ keyDerivationParams: String,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.storeUnlockKeyDerivationParams(keyDerivationParams)
            resolve(nil)
        } catch {
            reject("KEYCHAIN_ERROR", "Failed to store encryption key derivation params: \(error.localizedDescription)", error)
        }
    }

    @objc
    func getUnlockKeyDerivationParams(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        if let params = vaultStore.getUnlockKeyDerivationParams() {
            resolve(params)
        } else {
            resolve(nil)
        }
    }

    @objc
    func storeAccountKeyChain(_ chainJson: String?,
                              resolver resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        vaultStore.storeAccountKeyChain(chainJson)
        resolve(nil)
    }

    @objc
    func getAccountKeyChain(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(vaultStore.getAccountKeyChain())
    }

    /// The id of the user's personal manifest as the last sync recorded it, or nil before the first pull.
    @objc
    func getPersonalManifestId(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(vaultStore.getPersonalManifestId())
    }

    /// Resolve and store the vault key right after login from the password-derived key (see VaultStore.resolveVaultKey).
    @objc
    func resolveVaultKey(_ base64DerivedKey: String,
                         resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let key = try await vaultStore.resolveVaultKey(using: webApiService, derivedKeyBase64: base64DerivedKey)
                await MainActor.run { resolve(key) }
            } catch let vaultError as AppError {
                await MainActor.run { reject(vaultError.code, vaultError.message, vaultError) }
            } catch {
                await MainActor.run { reject("E-001", "Failed to resolve the vault key: \(error.localizedDescription)", error) }
            }
        }
    }

    @objc
    func executeQuery(_ query: String,
                      params: [Any],
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            // Parse all params to the correct type
            let bindingParams: [SqliteBindValue] = params.map { param in
                if param is NSNull {
                    return nil
                } else if let value = param as? String {
                    return value
                } else if let value = param as? NSNumber {
                    return "\(value)"
                } else if let value = param as? Bool {
                    return value ? "1" : "0"
                } else if let value = param as? Data {
                    return value.base64EncodedString()
                } else {
                    return String(describing: param)
                }
            }

            // Execute the query through the vault store; BLOB columns come back tagged so the JS client can decode them to bytes
            let results = try vaultStore.executeQuery(query, params: bindingParams, blobPrefix: "av-blob-base64:")
            resolve(results)
        } catch {
            reject("QUERY_ERROR", "Failed to execute query: \(error.localizedDescription)", error)
        }
    }

    @objc
    func executeUpdate(_ query: String,
                       params: [Any],
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            // Parse all params to the correct type
            let bindingParams: [SqliteBindValue] = params.map { param in
                if param is NSNull {
                    return nil
                } else if let value = param as? String {
                    return value
                } else if let value = param as? NSNumber {
                    return "\(value)"
                } else if let value = param as? Bool {
                    return value ? "1" : "0"
                } else if let value = param as? Data {
                    return value.base64EncodedString()
                } else {
                    return String(describing: param)
                }
            }

            // Execute the update through the vault store
            let changes = try vaultStore.executeUpdate(query, params: bindingParams)
            resolve(changes)
        } catch {
            reject("UPDATE_ERROR", "Failed to execute update: \(error.localizedDescription)", error)
        }
    }

    @objc
    func executeRaw(_ query: String,
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            // Execute the raw query through the vault store
            try vaultStore.executeRaw(query)
            resolve(nil)
        } catch {
            reject("RAW_ERROR", "Failed to execute raw query: \(error.localizedDescription)", error)
        }
    }

    /// Clear session data only (for forced logout).
    /// Preserves vault data on disk for recovery on next login.
    @objc
    func clearSession() {
        vaultStore.clearSession()

        // Reset password unlock failed attempts counter on logout
        UserDefaults.standard.removeObject(forKey: "password_unlock_failed_attempts")
    }

    /// Clear all vault data including from persisted storage.
    /// This is used for user-initiated logout.
    @objc
    func clearVault() {
        do {
            try vaultStore.clearVault()
        } catch {
            print("Failed to clear vault: \(error)")
        }
    }

    @objc
    func getEncryptedDatabase(_ resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        if let encryptedDb = vaultStore.getEncryptedDatabase() {
            resolve(encryptedDb)
        } else {
            reject("DB_ERROR", "Failed to get encrypted database", nil)
        }
    }

    @objc
    func hasEncryptedDatabase(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        let isInitialized = vaultStore.hasEncryptedDatabase
        resolve(isInitialized)
    }

    @objc
    func isVaultUnlocked(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        let isUnlocked = vaultStore.isVaultUnlocked
        resolve(isUnlocked)
    }

    @objc
    func getVaultMetadata(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        let metadata = vaultStore.getVaultMetadata()
        resolve(metadata)
    }

    @objc
    func unlockVault(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.unlockVault()
            resolve(true)
        } catch let vaultError as AppError {
            // Propagate AppError with proper error code
            reject(vaultError.code, vaultError.message, vaultError)
        } catch let error as NSError {
            // Default error handling for non-AppError errors
            reject("E-001", "Failed to unlock vault: \(error.localizedDescription)", error)
        }
    }

    @objc
    func setAutoLockTimeout(_ timeout: Int,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        vaultStore.setAutoLockTimeout(timeout)
        resolve(nil)
    }

    @objc
    func getAutoLockTimeout(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        let timeout = vaultStore.getAutoLockTimeout()
        resolve(timeout)
    }

    @objc
    func getAuthMethods(_ resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        let methods = vaultStore.getAuthMethods()
        var methodStrings: [String] = []

        if methods.contains(.faceID) {
            methodStrings.append("faceid")
        }
        if methods.contains(.password) {
            methodStrings.append("password")
        }

        resolve(methodStrings)
    }

    @objc
    func beginTransaction(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.beginTransaction()
            resolve(nil)
        } catch {
            reject("TRANSACTION_ERROR", "Failed to begin transaction: \(error.localizedDescription)", error)
        }
    }

    @objc
    func commitTransaction(_ scope: String,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.commitTransaction(scope: VaultMutationScope.known(scope))
            resolve(nil)
        } catch {
            reject("TRANSACTION_ERROR", "Failed to commit transaction: \(error.localizedDescription)", error)
        }
    }

    @objc
    func rollbackTransaction(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.rollbackTransaction()
            resolve(nil)
        } catch {
            reject("TRANSACTION_ERROR", "Failed to rollback transaction: \(error.localizedDescription)", error)
        }
    }

    @objc
    func persistAndMarkDirty(_ scope: String,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.persistAndMarkDirty(scope: VaultMutationScope.known(scope))
            resolve(nil)
        } catch {
            reject("PERSIST_ERROR", "Failed to persist and mark dirty: \(error.localizedDescription)", error)
        }
    }

    @objc
    func deriveKeyFromPassword(_ password: String,
                              salt: String,
                              encryptionType: String,
                              encryptionSettings: String,
                              resolver resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            let derivedKey = try vaultStore.deriveKeyFromPassword(password,
                                                                  salt: salt,
                                                                  encryptionType: encryptionType,
                                                                  encryptionSettings: encryptionSettings)
            // Return the derived key as base64 encoded string
            resolve(derivedKey.base64EncodedString())
        } catch {
            reject("ARGON2_ERROR", "Failed to derive key from password: \(error.localizedDescription)", error)
        }
    }

    @objc
    func openAutofillSettingsPage(_ resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            // Open the AutoFill & Passwords settings page directly via ASSettingsHelper.
            ASSettingsHelper.openCredentialProviderAppSettings { error in
                if let error = error {
                    // Fall back to opening the Settings app root.
                    if let settingsUrl = URL(string: "App-prefs:") {
                        UIApplication.shared.open(settingsUrl) { _ in
                            resolve(nil)
                        }
                    } else {
                        reject("SETTINGS_ERROR", "Failed to open settings: \(error.localizedDescription)", error)
                    }
                } else {
                    resolve(nil)
                }
            }
        }
    }

    @objc
    func getAutofillShowSearchText(_ resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        // iOS autofill doesn't have this feature, always return false
        resolve(false)
    }

    @objc
    func setAutofillShowSearchText(_ showSearchText: Bool,
                                   resolver resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        // iOS autofill doesn't have this feature, no-op
        resolve(nil)
    }

    @objc
    func getAutofillCopyTotpOnFill(_ resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(AutofillSettings.shouldCopyTotpOnFill)
    }

    @objc
    func setAutofillCopyTotpOnFill(_ enabled: Bool,
                                   resolver resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        AutofillSettings.shouldCopyTotpOnFill = enabled
        resolve(nil)
    }

    @objc
    func generateTotpCode(_ secret: String,
                          algorithm: String,
                          digits: Double,
                          period: Double,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        // Returns nil for invalid secrets; the JS side treats null as "code unavailable".
        let code = TotpGenerator.generateCode(secret: secret,
                                              period: Int(period),
                                              digits: Int(digits),
                                              algorithm: algorithm)
        resolve(code)
    }

    @objc
    func copyToClipboardWithExpiration(_ text: String,
                                      expirationSeconds: Double,
                                      localOnly: Bool,
                                      resolver resolve: @escaping RCTPromiseResolveBlock,
                                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        NSLog("VaultManager: Copying to clipboard with expiration of %.0f seconds, localOnly: %@", expirationSeconds, localOnly ? "true" : "false")

        DispatchQueue.main.async {
            if expirationSeconds > 0 {
                // Create expiration date
                let expirationDate = Date().addingTimeInterval(expirationSeconds)

                // Set clipboard with expiration and optional local-only restriction
                var options: [UIPasteboard.OptionsKey: Any] = [
                    .expirationDate: expirationDate
                ]
                if localOnly {
                    options[.localOnly] = true  // Prevent sync to Universal Clipboard/iCloud
                }

                UIPasteboard.general.setItems(
                    [[UIPasteboard.typeAutomatic: text]],
                    options: options
                )

                NSLog("VaultManager: Text copied to clipboard with expiration at %@", expirationDate.description)
            } else {
                // No expiration, just copy normally
                UIPasteboard.general.string = text
                NSLog("VaultManager: Text copied to clipboard without expiration")
            }
            resolve(nil)
        }
    }

    @objc
    func registerCredentialIdentities(_ resolve: @escaping RCTPromiseResolveBlock,
                                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                // Get all credentials from the vault
                let credentials = try vaultStore.getAllAutofillCredentials()

                // Register both passwords and passkeys for QuickType and manual selection
                try await CredentialIdentityStore.shared.saveCredentialIdentities(credentials)

                await MainActor.run {
                    resolve(nil)
                }
            } catch {
                print("VaultManager: Failed to register credential identities: \(error)")
                await MainActor.run {
                    reject("CREDENTIAL_REGISTRATION_ERROR", "Failed to register credential identities: \(error.localizedDescription)", error)
                }
            }
        }
    }

    @objc
    func removeCredentialIdentities(_ resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                print("VaultManager: Removing all credential identities from iOS store")
                try await CredentialIdentityStore.shared.removeAllCredentialIdentities()
                await MainActor.run {
                    print("VaultManager: Successfully removed all credential identities")
                    resolve(nil)
                }
            } catch {
                print("VaultManager: Failed to remove credential identities: \(error)")
                await MainActor.run {
                    reject("CREDENTIAL_REMOVAL_ERROR", "Failed to remove credential identities: \(error.localizedDescription)", error)
                }
            }
        }
    }

    // MARK: - WebAPI Configuration

    @objc
    func setApiUrl(_ url: String,
                   resolver resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try webApiService.setApiUrl(url)
            resolve(nil)
        } catch {
            reject("API_URL_ERROR", "Failed to set API URL: \(error.localizedDescription)", error)
        }
    }

    @objc
    func getApiUrl(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        let apiUrl = webApiService.getApiUrl()
        resolve(apiUrl)
    }

    @objc
    func setCustomProxyHeaders(_ headersJson: String,
                               resolver resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        webApiService.setCustomProxyHeaders(headersJson)
        resolve(nil)
    }

    @objc
    func getCustomProxyHeaders(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(webApiService.getCustomProxyHeadersJson())
    }

    // MARK: - WebAPI Token Management

    @objc
    func setAuthTokens(_ accessToken: String,
                      refreshToken: String,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try webApiService.setAuthTokens(accessToken: accessToken, refreshToken: refreshToken)
            resolve(nil)
        } catch {
            reject("AUTH_TOKEN_ERROR", "Failed to set auth tokens: \(error.localizedDescription)", error)
        }
    }

    @objc
    func getAccessToken(_ resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        if let accessToken = webApiService.getAccessToken() {
            resolve(accessToken)
        } else {
            resolve(nil)
        }
    }

    @objc
    func clearAuthTokens(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        webApiService.clearAuthTokens()
        resolve(nil)
    }

    @objc
    func revokeTokens(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                try await webApiService.revokeTokens()
                resolve(nil)
            } catch {
                reject("REVOKE_ERROR", "Failed to revoke tokens: \(error.localizedDescription)", error)
            }
        }
    }

    // MARK: - WebAPI Request Execution

    @objc
    func executeWebApiRequest(_ method: String,
                             endpoint: String,
                             body: String?,
                             headers: String,
                             requiresAuth: Bool,
                             resolver resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                // Parse headers from JSON string
                guard let headersData = headers.data(using: .utf8),
                      let headersDict = try? JSONSerialization.jsonObject(with: headersData) as? [String: String] else {
                    reject("HEADERS_ERROR", "Failed to parse headers", nil)
                    return
                }

                // Execute the request
                let response = try await webApiService.executeRequest(
                    method: method,
                    endpoint: endpoint,
                    body: body,
                    headers: headersDict,
                    requiresAuth: requiresAuth
                )

                // Build response JSON
                let responseDict: [String: Any] = [
                    "statusCode": response.statusCode,
                    "body": response.body,
                    "headers": response.headers
                ]

                guard let responseData = try? JSONSerialization.data(withJSONObject: responseDict),
                      let responseJson = String(data: responseData, encoding: .utf8) else {
                    reject("RESPONSE_ERROR", "Failed to serialize response", nil)
                    return
                }

                await MainActor.run {
                    resolve(responseJson)
                }
            } catch {
                await MainActor.run {
                    reject("WEB_API_ERROR", "Failed to execute WebAPI request: \(error.localizedDescription)", error)
                }
            }
        }
    }

    // MARK: - Username Management

    @objc
    func setUsername(_ username: String,
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        vaultStore.setUsername(username)
        resolve(nil)
    }

    @objc
    func getUsername(_ resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        if let username = vaultStore.getUsername() {
            resolve(username)
        } else {
            resolve(nil)
        }
    }

    @objc
    func clearUsername(_ resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        vaultStore.clearUsername()
        resolve(nil)
    }

    // MARK: - Server Version Management

    @objc
    func isServerVersionGreaterThanOrEqualTo(_ targetVersion: String,
                                            resolver resolve: @escaping RCTPromiseResolveBlock,
                                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        let isGreaterOrEqual = vaultStore.isServerVersionGreaterThanOrEqualTo(targetVersion)
        resolve(isGreaterOrEqual)
    }

    @objc
    func getCapabilities(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(vaultStore.getCapabilities())
    }

    @objc
    func getServerVersion(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(vaultStore.getServerVersion())
    }

    // MARK: - Offline Mode Management

    @objc
    func setOfflineMode(_ isOffline: Bool,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        vaultStore.setOfflineMode(isOffline)
        resolve(nil)
    }

    @objc
    func getOfflineMode(_ resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(vaultStore.getOfflineMode())
    }

    // MARK: - Vault Sync

    @objc
    func checkSyncStatus(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let versionCheck = try await vaultStore.checkVaultVersion(using: webApiService)
                await MainActor.run {
                    let response: [String: Any] = [
                        "success": true,
                        "hasNewerVault": versionCheck.isNewVersionAvailable,
                        "hasDirtyChanges": versionCheck.syncState.isDirty,
                        "isOffline": false,
                        "requiresLogout": false,
                        "errorKey": NSNull()
                    ]
                    resolve(response)
                }
            } catch let error as AppError {
                await MainActor.run {
                    // Check for specific error types that require logout
                    let requiresLogout = error.isAuthenticationError || error.isVersionError
                    let errorKey = error.translationKey

                    // Check if offline
                    let isOffline = error.isNetworkError
                    if isOffline {
                        let syncState = vaultStore.getSyncState()
                        let response: [String: Any] = [
                            "success": true,
                            "hasNewerVault": false,
                            "hasDirtyChanges": syncState.isDirty,
                            "isOffline": true,
                            "requiresLogout": false,
                            "errorKey": NSNull()
                        ]
                        resolve(response)
                    } else {
                        let response: [String: Any] = [
                            "success": !requiresLogout,
                            "hasNewerVault": false,
                            "hasDirtyChanges": false,
                            "isOffline": false,
                            "requiresLogout": requiresLogout,
                            "errorKey": errorKey as Any
                        ]
                        resolve(response)
                    }
                }
            } catch {
                await MainActor.run {
                    let response: [String: Any] = [
                        "success": false,
                        "hasNewerVault": false,
                        "hasDirtyChanges": false,
                        "isOffline": false,
                        "requiresLogout": false,
                        "errorKey": NSNull()
                    ]
                    resolve(response)
                }
            }
        }
    }

    @objc
    func syncVaultWithServer(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        let receivedAt = Date()
        Task {
            let taskStartedAfterMs = Int(Date().timeIntervalSince(receivedAt) * 1000)
            let result = await vaultStore.syncVaultWithServer(using: webApiService)
            await MainActor.run {
                let response: [String: Any] = [
                    "success": result.success,
                    "action": result.action.rawValue,
                    "newRevision": result.newRevision,
                    "wasOffline": result.wasOffline,
                    "error": result.error as Any,
                    "errorMessage": result.errorMessage as Any,
                    "sqliteBlobUpgradeRequired": result.sqliteBlobUpgradeRequired,
                    "manifestMigrationRequired": result.manifestMigrationRequired
                ]
                resolve(response)
            }
        }
    }

    /// The logs of the recent sync engine runs as JSON text, newest first (developer tools).
    @objc
    func getVaultSyncLogs(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(vaultStore.getVaultSyncLogs())
    }

    /// Classify the pending manifest migration (see VaultStore.getVaultMigrationStatus). Rejects with the native error code.
    @objc
    func getVaultMigrationStatus(_ resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                let kind = try await vaultStore.getVaultMigrationStatus(using: webApiService)
                await MainActor.run { resolve(kind) }
            } catch let error as AppError {
                await MainActor.run { reject(error.code, error.message, error) }
            } catch {
                await MainActor.run { reject("VAULT_MIGRATION_STATUS_ERROR", "Failed to classify the pending vault migration: \(error.localizedDescription)", error) }
            }
        }
    }

    /// Run the pending manifest migration and push it (see VaultStore.migrateVaultManifest). Failures resolve with the error code.
    @objc
    func migrateVaultManifest(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let result = await vaultStore.migrateVaultManifest(using: webApiService)
            await MainActor.run {
                let response: [String: Any] = [
                    "success": result.success,
                    "pushed": result.pushed,
                    "error": result.error as Any,
                    "errorMessage": result.errorMessage as Any
                ]
                resolve(response)
            }
        }
    }

    /// Run a sharing operation of the sync engine (see VaultStore.runSharingOperation). Failures resolve with the error code.
    @objc
    func runSharingOperation(_ operation: String,
                             paramsJson: String,
                             resolver resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let data = paramsJson.data(using: .utf8), let params = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            reject("VAULT_SHARING_ERROR", "The sharing operation parameters are not a JSON object", nil)
            return
        }
        Task {
            let result = await vaultStore.runSharingOperation(operation, params: params, using: webApiService)
            await MainActor.run {
                let response: [String: Any] = [
                    "success": result.success,
                    "vaultUpgradeRequired": result.vaultUpgradeRequired,
                    "apiErrorCode": result.apiErrorCode as Any,
                    "error": result.error as Any,
                    "errorMessage": result.errorMessage as Any
                ]
                resolve(response)
            }
        }
    }

    // MARK: - PIN Unlock Methods

    @objc
    func isPinEnabled(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(vaultStore.isPinEnabled())
    }

    @objc
    func isKeystoreAvailable(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(vaultStore.isKeystoreAvailable())
    }

    /// Check if the device has biometrics that can protect the vault key.
    /// Face ID and Touch ID always qualify on iOS, unlike Class 2 biometrics some Android devices offer.
    @objc
    func isBiometricsAvailableOnDevice(_ resolve: @escaping RCTPromiseResolveBlock,
                                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        let context = LAContext()
        var error: NSError?
        let canEvaluate = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)

        // A lockout means biometrics are enrolled but temporarily blocked, so still count as available.
        resolve(canEvaluate || error?.code == LAError.biometryLockout.rawValue)
    }

    /// Check if biometric unlock is actually available (device + key validation).
    /// This checks not only if biometrics are configured in auth methods,
    /// but also validates that the encryption key in Keychain is valid.
    /// Returns false if key has been invalidated (e.g., biometric enrollment changed).
    @objc
    func isBiometricUnlockAvailable(_ resolve: @escaping RCTPromiseResolveBlock,
                                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(vaultStore.isBiometricAuthEnabled())
    }

    @objc
    func getPinFailedAttempts(_ resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(vaultStore.getPinFailedAttempts())
    }

    @objc
    func resetPinFailedAttempts(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
        vaultStore.resetPinFailedAttempts()
        resolve(nil)
    }

    @objc
    func removeAndDisablePin(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.removeAndDisablePin()
            resolve(nil)
        } catch {
            reject("REMOVE_PIN_ERROR", "Failed to remove PIN: \(error.localizedDescription)", error)
        }
    }

    @objc
    func showPinUnlock(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                reject("INTERNAL_ERROR", "VaultManager instance deallocated", nil)
                return
            }

            // Get the root view controller from React Native
            guard let rootVC = RCTPresentedViewController() else {
                reject("NO_VIEW_CONTROLLER", "No view controller available", nil)
                return
            }

            // Create PIN unlock view with ViewModel
            let viewModel = PinUnlockViewModel(
                pinLength: self.vaultStore.getPinLength(),
                unlockHandler: { [weak self] pin in
                    guard let self = self else {
                        throw NSError(domain: "VaultManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "VaultManager instance deallocated"])
                    }

                    // Unlock vault with PIN
                    let unlockKeyBase64 = try self.vaultStore.unlockWithPin(pin)

                    // Open the session with the unlock key
                    try self.vaultStore.storeUnlockKey(base64Key: unlockKeyBase64)

                    // Now unlock the vault with the key in memory
                    try self.vaultStore.unlockVault()

                    // Success - dismiss and resolve
                    await MainActor.run {
                        rootVC.dismiss(animated: true) {
                            resolve(nil)
                        }
                    }
                },
                cancelHandler: {
                    // Dismiss the view
                    // No need to distinguish between user cancel vs PIN disabled
                    // React Native will check isPinEnabled() to update UI state
                    rootVC.dismiss(animated: true) {
                        reject("USER_CANCELLED", "User cancelled PIN unlock", nil)
                    }
                }
            )

            let pinView = PinUnlockView(viewModel: viewModel)
            let hostingController = UIHostingController(rootView: pinView)

            // Present modally as full screen
            hostingController.modalPresentationStyle = .fullScreen
            rootVC.present(hostingController, animated: true)
        }
    }

    @objc
    func showPasswordUnlock(_ title: String?,
                           subtitle: String?,
                           buttonText: String?,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                reject("INTERNAL_ERROR", "VaultManager instance deallocated", nil)
                return
            }

            // Get the root view controller from React Native
            guard let rootVC = RCTPresentedViewController() else {
                reject("NO_VIEW_CONTROLLER", "No view controller available", nil)
                return
            }

            // Create password unlock view with ViewModel
            let customTitle = (title?.isEmpty == false) ? title : nil
            let customSubtitle = (subtitle?.isEmpty == false) ? subtitle : nil
            let customButtonText = (buttonText?.isEmpty == false) ? buttonText : nil
            let viewModel = PasswordUnlockViewModel(
                customTitle: customTitle,
                customSubtitle: customSubtitle,
                customButtonText: customButtonText,
                unlockHandler: { [weak self] password in
                    guard let self = self else {
                        throw NSError(domain: "VaultManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "VaultManager instance deallocated"])
                    }

                    // Verify password and get the unlock key
                    guard let unlockKeyBase64 = self.vaultStore.verifyPassword(password) else {
                        throw NSError(domain: "VaultManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Incorrect password"])
                    }

                    // Open the session in memory only
                    try self.vaultStore.storeUnlockKeyInMemory(base64Key: unlockKeyBase64)

                    // Unlock the vault
                    try self.vaultStore.unlockVault()

                    await MainActor.run {
                        rootVC.dismiss(animated: true) {
                            resolve(true)
                        }
                    }
                },
                cancelHandler: {
                    rootVC.dismiss(animated: true) {
                        resolve(nil)
                    }
                },
                logoutHandler: { [weak self] in
                    // Clear vault on max failed attempts
                    try? self?.vaultStore.clearVault()

                    // Throw error to signal max attempts reached to React Native
                    await MainActor.run {
                        rootVC.dismiss(animated: true) {
                            reject("MAX_ATTEMPTS_REACHED", "Too many failed unlock attempts", nil)
                        }
                    }

                    // Throw to stop further processing in ViewModel
                    throw NSError(domain: "VaultManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Max attempts reached"])
                }
            )

            let passwordView = PasswordUnlockView(viewModel: viewModel)
            let hostingController = UIHostingController(rootView: passwordView)

            // Present modally as full screen
            hostingController.modalPresentationStyle = .fullScreen
            rootVC.present(hostingController, animated: true)
        }
    }

    @objc
    func showPinSetup(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                reject("INTERNAL_ERROR", "VaultManager instance deallocated", nil)
                return
            }

            // Get the root view controller from React Native
            guard let rootVC = RCTPresentedViewController() else {
                reject("NO_VIEW_CONTROLLER", "No view controller available", nil)
                return
            }

            // Create PIN setup view with ViewModel
            let viewModel = PinSetupViewModel(
                setupHandler: { [weak self] pin in
                    guard let self = self else {
                        throw NSError(domain: "VaultManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "VaultManager instance deallocated"])
                    }

                    // Setup PIN (vault must be unlocked - encryption key is retrieved from memory)
                    try self.vaultStore.setupPin(pin)

                    // Success - dismiss and resolve
                    await MainActor.run {
                        rootVC.dismiss(animated: true) {
                            resolve(nil)
                        }
                    }
                },
                cancelHandler: {
                    // Dismiss the view
                    rootVC.dismiss(animated: true) {
                        reject("USER_CANCELLED", "User cancelled PIN setup", nil)
                    }
                }
            )

            let pinSetupView = PinSetupView(viewModel: viewModel)
            let hostingController = UIHostingController(rootView: pinSetupView)

            // Present modally as full screen
            hostingController.modalPresentationStyle = .fullScreen
            rootVC.present(hostingController, animated: true)
        }
    }

    @objc
    func encryptDecryptionKeyForMobileLogin(_ publicKeyJWK: String,
                                           resolver resolve: @escaping RCTPromiseResolveBlock,
                                           rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            // Get the encryption key and encrypt it with the provided public key
            let encryptedData = try vaultStore.encryptDecryptionKeyForMobileLogin(publicKeyJWK: publicKeyJWK)

            // Return the encrypted data as base64 string
            let base64Encrypted = encryptedData.base64EncodedString()
            resolve(base64Encrypted)
        } catch {
            reject("ENCRYPTION_ERROR", "Failed to encrypt decryption key: \(error.localizedDescription)", error)
        }
    }

    @objc
    func scanQRCode(_ prefixes: [String]?,
                    statusText: String?,
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            // Get the root view controller from React Native
            guard let rootVC = RCTPresentedViewController() else {
                reject("NO_VIEW_CONTROLLER", "No view controller available", nil)
                return
            }

            // Create QR scanner view with optional prefix filtering and custom status text
            let scannerView = QRScannerView(
                prefixes: prefixes,
                statusText: statusText,
                onCodeScanned: { code in
                    // Resolve immediately and dismiss without waiting (matches Android behavior)
                    resolve(code)
                    rootVC.dismiss(animated: true)
                },
                onCancel: {
                    // Cancel resolves nil and dismisses
                    resolve(nil)
                    rootVC.dismiss(animated: true)
                }
            )

            let hostingController = UIHostingController(rootView: scannerView)

            // Present modally as full screen
            hostingController.modalPresentationStyle = .fullScreen
            rootVC.present(hostingController, animated: true)
        }
    }

    /**
     * Whether this platform can ask the user for a store review. For iOS this is always true.
     */
    @objc
    func isAppReviewAvailable(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(true)
    }

    /**
     * Show Apple's native rating overlay. Returns whether the OS accepted the request.
     */
    @objc
    func requestAppReview(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }) else {
                resolve(false)
                return
            }

            AppStore.requestReview(in: scene)
            resolve(true)
        }
    }

    /**
     * Get the date this app was installed by looking at the creation date of the app's documents directory.
     */
    @objc
    func getAppInstallDate(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let documentsUrl = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
              let attributes = try? FileManager.default.attributesOfItem(atPath: documentsUrl.path),
              let creationDate = attributes[.creationDate] as? Date else {
            resolve(0)
            return
        }

        resolve(creationDate.timeIntervalSince1970 * 1000)
    }

    @objc
    func authenticateUser(_ title: String?,
                         subtitle: String?,
                         allowedMethods: [String]?,
                         buttonText: String?,
                         recentUnlockGraceSeconds: Double,
                         resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        if vaultStore.wasRecentlyAuthenticated(recentUnlockGraceSeconds) {
            resolve(true)
            return
        }

        // Get enabled authentication methods
        let authMethods = vaultStore.getAuthMethods()
        let pinEnabled = vaultStore.isPinEnabled()

        // Filter by allowed methods if specified
        let allowedMethodsSet: Set<String>? = allowedMethods.map { Set($0) }
        let isBiometricEnabled = authMethods.contains(.faceID) && (allowedMethodsSet == nil || allowedMethodsSet!.contains("biometric"))
        let isPinAllowed = pinEnabled && (allowedMethodsSet == nil || allowedMethodsSet!.contains("pin"))
        let isPasswordAllowed = authMethods.contains(.password) && (allowedMethodsSet == nil || allowedMethodsSet!.contains("password"))

        // If PIN is enabled and allowed, prefer PIN (with biometric first if available)
        if isPinAllowed {
            // Try biometric authentication first if enabled
            if isBiometricEnabled {
                let authenticated = vaultStore.issueBiometricAuthentication(title: title)
                if authenticated {
                    resolve(true)
                    return
                }
                // Biometric failed or cancelled - fall through to PIN fallback
            }

            // Show PIN unlock (either as primary or fallback)
            // Create a semaphore to handle the async PIN unlock result
            let semaphore = DispatchSemaphore(value: 0)
            var pinUnlockSucceeded = false
            var pinWasCancelled = false

            DispatchQueue.main.async { [weak self] in
                guard let self = self else {
                    reject("INTERNAL_ERROR", "VaultManager instance deallocated", nil)
                    semaphore.signal()
                    return
                }

                // Get the root view controller from React Native
                guard let rootVC = RCTPresentedViewController() else {
                    reject("NO_VIEW_CONTROLLER", "No view controller available", nil)
                    semaphore.signal()
                    return
                }

                // Create PIN unlock view with ViewModel
                // Use custom title/subtitle if provided, otherwise use defaults
                let customTitle = (title?.isEmpty == false) ? title : nil
                let customSubtitle = (subtitle?.isEmpty == false) ? subtitle : nil
                let viewModel = PinUnlockViewModel(
                    pinLength: self.vaultStore.getPinLength(),
                    customTitle: customTitle,
                    customSubtitle: customSubtitle,
                    unlockHandler: { [weak self] pin in
                        guard let self = self else {
                            throw NSError(domain: "VaultManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "VaultManager instance deallocated"])
                        }

                        // Unlock vault with PIN (just validates, doesn't store in memory)
                        _ = try self.vaultStore.unlockWithPin(pin)

                        // Success - dismiss and resolve
                        await MainActor.run {
                            rootVC.dismiss(animated: true) {
                                pinUnlockSucceeded = true
                                semaphore.signal()
                                resolve(true)
                            }
                        }
                    },
                    cancelHandler: {
                        // User cancelled PIN - check if password fallback is available
                        rootVC.dismiss(animated: true) {
                            pinWasCancelled = true
                            semaphore.signal()
                        }
                    }
                )

                let pinView = PinUnlockView(viewModel: viewModel)
                let hostingController = UIHostingController(rootView: pinView)

                // Present modally as full screen
                hostingController.modalPresentationStyle = .fullScreen
                rootVC.present(hostingController, animated: true)
            }

            // Wait for PIN unlock to complete or be cancelled
            semaphore.wait()

            // If PIN succeeded, we're done (already resolved above)
            if pinUnlockSucceeded {
                return
            }

            // If PIN was cancelled and password auth is available and allowed, fall back to password
            if pinWasCancelled && isPasswordAllowed {
                // Fall through to password unlock below
            } else {
                // No password fallback available, resolve with false
                resolve(false)
                return
            }
        }

        // No PIN enabled or allowed - check for biometric + password
        if isBiometricEnabled {
            let authenticated = vaultStore.issueBiometricAuthentication(title: title)
            if authenticated {
                resolve(true)
                return
            }
            // Biometric failed or cancelled - fall through to password fallback if available
        }

        // Show password unlock if allowed (either as primary or fallback from biometric)
        if !isPasswordAllowed {
            // Password not allowed and we've exhausted other options
            resolve(false)
            return
        }

        // Show password unlock
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                reject("INTERNAL_ERROR", "VaultManager instance deallocated", nil)
                return
            }

            // Get the root view controller from React Native
            guard let rootVC = RCTPresentedViewController() else {
                reject("NO_VIEW_CONTROLLER", "No view controller available", nil)
                return
            }

            // Create password unlock view with ViewModel
            // Use custom title/subtitle/buttonText if provided, otherwise use defaults
            let customTitle = (title?.isEmpty == false) ? title : nil
            let customSubtitle = (subtitle?.isEmpty == false) ? subtitle : nil
            let customButtonText = (buttonText?.isEmpty == false) ? buttonText : nil
            let viewModel = PasswordUnlockViewModel(
                customTitle: customTitle,
                customSubtitle: customSubtitle,
                customButtonText: customButtonText,
                unlockHandler: { [weak self] password in
                    guard let self = self else {
                        throw NSError(domain: "VaultManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "VaultManager instance deallocated"])
                    }

                    // Verify password and get the unlock key
                    guard let unlockKeyBase64 = try self.vaultStore.verifyPassword(password) else {
                        throw NSError(domain: "VaultManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Incorrect password"])
                    }

                    try self.vaultStore.storeUnlockKeyInMemory(base64Key: unlockKeyBase64)

                    // Success - dismiss and resolve
                    await MainActor.run {
                        rootVC.dismiss(animated: true) {
                            resolve(true)
                        }
                    }
                },
                cancelHandler: {
                    // User cancelled - dismiss and resolve with false
                    rootVC.dismiss(animated: true) {
                        resolve(false)
                    }
                }
            )

            let passwordView = PasswordUnlockView(viewModel: viewModel)
            let hostingController = UIHostingController(rootView: passwordView)

            // Present modally as full screen
            hostingController.modalPresentationStyle = .fullScreen
            rootVC.present(hostingController, animated: true)
        }
    }

    /// Answer a server's SRP challenge with the unlock key of the open session (see VaultStore.deriveSrpProof).
    @objc
    func deriveSrpProof(_ salt: String,
                        srpIdentity: String,
                        serverEphemeral: String,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else {
                reject("INTERNAL_ERROR", "VaultManager instance deallocated", nil)
                return
            }

            do {
                let proof = try self.vaultStore.deriveSrpProof(salt: salt, srpIdentity: srpIdentity, serverEphemeral: serverEphemeral)
                resolve(["clientPublicEphemeral": proof.clientPublicEphemeral, "clientSessionProof": proof.clientSessionProof])
            } catch {
                reject("SRP_PROOF_ERROR", "Failed to derive the SRP proof: \(error.localizedDescription)", error)
            }
        }
    }

    // MARK: - Sync State Management

    @objc
    func getSyncState(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        let syncState = vaultStore.getSyncState()
        let result: [String: Any] = [
            "isDirty": syncState.isDirty,
            "dirtyScopes": syncState.dirtyScopes,
            "mutationSequence": syncState.mutationSequence,
            "serverRevision": syncState.serverRevision,
            "isSyncing": syncState.isSyncing
        ]
        resolve(result)
    }

    @objc
    func markVaultClean(_ mutationSeqAtStart: Int,
                       newServerRevision: Int,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        let cleared = vaultStore.markVaultClean(mutationSeqAtStart: mutationSeqAtStart, newServerRevision: newServerRevision)
        resolve(cleared)
    }

    @objc
    func clearEncryptedVaultForFreshDownload(_ resolve: @escaping RCTPromiseResolveBlock,
                                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.removeEncryptedDatabase()
            print("Deleted corrupted encrypted database for fresh download")
        } catch {
            print("Could not delete encrypted database (may not exist): \(error)")
        }

        // Close in-memory database connection if open
        vaultStore.clearCache()

        // Reset sync state - set isDirty=false and revision=0 so sync sees server as newer
        vaultStore.setIsDirty(false)
        vaultStore.setCurrentVaultRevisionNumber(0)
        vaultStore.clearSyncEngineState()

        resolve(nil)
    }

    @objc
    func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    static func moduleName() -> String! {
        return "VaultManager"
    }

    // MARK: - Client core bridge

    /// Call one Rust core function by name with JSON-encoded positional arguments. The client core's Rust
    /// binding (platform/NativeRustCore.ts) routes every call through here; see RustCoreDispatcher below.
    @objc
    func rustCall(_ name: String,
                  argsJson: String,
                  resolver resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                resolve(try RustCoreDispatcher.call(name: name, argsJson: argsJson))
            } catch {
                reject("RUST_CORE_ERROR", "Rust core call '\(name)' failed: \(error.localizedDescription)", error)
            }
        }
    }

    /// Store the encrypted vault blob the app produced, so the native store and the autofill extension read it.
    @objc
    func storeEncryptedDatabase(_ base64EncryptedDb: String,
                                resolver resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.storeEncryptedDatabase(base64EncryptedDb)
            resolve(nil)
        } catch {
            reject("DB_ERROR", "Failed to store encrypted database: \(error.localizedDescription)", error)
        }
    }
}

/// Routes `rustCall` invocations onto the Rust core Uniffi bindings.
private enum RustCoreDispatcher {
    enum DispatchError: LocalizedError {
        case unknownFunction(String)
        case badArgument(Int)
        case encoding

        var errorDescription: String? {
            switch self {
            case .unknownFunction(let name): return "Unknown Rust core function '\(name)'"
            case .badArgument(let index): return "Bad argument at index \(index)"
            case .encoding: return "Could not encode the result"
            }
        }
    }

    /// The positional arguments of one call.
    private struct Args {
        let values: [Any]

        func string(_ index: Int) throws -> String {
            guard index < values.count, let value = values[index] as? String else { throw DispatchError.badArgument(index) }
            return value
        }

        func optionalString(_ index: Int) -> String? {
            return index < values.count ? values[index] as? String : nil
        }

        func uint32(_ index: Int) throws -> UInt32 {
            guard index < values.count, let value = values[index] as? NSNumber else { throw DispatchError.badArgument(index) }
            return value.uint32Value
        }

        func strings(_ index: Int) throws -> [String] {
            guard index < values.count, let value = values[index] as? [String] else { throw DispatchError.badArgument(index) }
            return value
        }

        func data(_ index: Int) throws -> Data {
            guard let value = Data(base64Encoded: try string(index)) else { throw DispatchError.badArgument(index) }
            return value
        }

        func optionalData(_ index: Int) throws -> Data? {
            guard let encoded = optionalString(index) else { return nil }
            guard let value = Data(base64Encoded: encoded) else { throw DispatchError.badArgument(index) }
            return value
        }
    }

    static func call(name: String, argsJson: String) throws -> String {
        let parsed = try JSONSerialization.jsonObject(with: Data(argsJson.utf8), options: [.fragmentsAllowed])
        let args = Args(values: parsed as? [Any] ?? [])

        switch name {
        case "extractDomain": return try json(RustCoreFramework.extractDomain(url: try args.string(0)))
        case "extractRootDomain": return try json(RustCoreFramework.extractRootDomain(domain: try args.string(0)))
        case "selectFaviconTarget":
            guard let target = RustCoreFramework.selectFaviconTarget(urls: try args.strings(0)) else { return "null" }
            return try json(["url": target.url, "source": target.source])
        case "filterCredentialsJson": return try RustCoreFramework.filterCredentialsJson(inputJson: try args.string(0))

        case "generatePassword": return try json(try RustCoreFramework.generatePassword(settingsJson: try args.string(0)))
        case "getDicewareLanguages": return try json(RustCoreFramework.getDicewareLanguages())
        case "generateIdentity": return try json(try RustCoreFramework.generateIdentity(requestJson: try args.string(0)))
        case "generateIdentityUsername": return try json(try RustCoreFramework.generateIdentityUsername(inputJson: try args.string(0)))
        case "generateIdentityEmailPrefix": return try json(try RustCoreFramework.generateIdentityEmailPrefix(inputJson: try args.string(0)))
        case "generateRandomEmailPrefix": return try json(RustCoreFramework.generateRandomEmailPrefix(length: try args.uint32(0)))
        case "getIdentityLanguages": return try json(RustCoreFramework.getIdentityLanguages())
        case "getIdentityAgeRanges": return try json(RustCoreFramework.getIdentityAgeRanges())

        case "parseEmailSource": return try RustCoreFramework.parseEmailSource(source: try args.data(0))
        case "decodeEmailSource": return try json(bytes: try RustCoreFramework.decodeEmailSource(source: try args.data(0)))
        case "extractEmailAttachment":
            return try json(bytes: try RustCoreFramework.extractEmailAttachment(source: try args.data(0), index: try args.uint32(1), detachedBody: try args.optionalData(2)))

        case "argon2DeriveKey":
            return try json(bytes: try RustCoreFramework.argon2DeriveKey(password: try args.string(0), salt: try args.string(1), encryptionSettings: try args.string(2)))

        case "srpGenerateSalt": return try json(RustCoreFramework.srpGenerateSalt())
        case "srpDerivePrivateKey":
            return try json(try RustCoreFramework.srpDerivePrivateKey(salt: try args.string(0), identity: try args.string(1), passwordHash: try args.string(2)))
        case "srpDeriveVerifier": return try json(try RustCoreFramework.srpDeriveVerifier(privateKey: try args.string(0)))
        case "srpGenerateEphemeral":
            let ephemeral = RustCoreFramework.srpGenerateEphemeral()
            return try json(["public": ephemeral.public, "secret": ephemeral.secret])
        case "srpDeriveSession":
            let session = try RustCoreFramework.srpDeriveSession(clientSecret: try args.string(0), serverPublic: try args.string(1), salt: try args.string(2), identity: try args.string(3), privateKey: try args.string(4))
            return try json(["proof": session.proof, "key": session.key])

        case "getSyncableTableNames": return try json(RustCoreFramework.getSyncableTableNames())
        case "pruneVaultJson": return try RustCoreFramework.pruneVaultJson(inputJson: try args.string(0))

        case "vaultCodecCanonicalizeFromSqlite": return try RustCoreFramework.vaultCodecCanonicalizeFromSqlite(inputJson: try args.string(0))
        case "vaultCodecGenerateManifestSalt": return try json(RustCoreFramework.vaultCodecGenerateManifestSalt())
        case "vaultCodecLogoIdFor": return try json(RustCoreFramework.vaultCodecLogoIdFor(manifestId: try args.string(0), kind: try args.string(1), source: try args.string(2)))
        case "vaultCodecLogoContentHash": return try json(RustCoreFramework.vaultCodecLogoContentHash(bytes: try args.data(0)))
        case "vaultCodecPackPayload": return try json(bytes: try RustCoreFramework.vaultCodecPackPayload(payloadJson: try args.string(0)))
        case "vaultCodecUnpackPayload": return try json(try RustCoreFramework.vaultCodecUnpackPayload(plainBytes: try args.data(0)))

        default: throw DispatchError.unknownFunction(name)
        }
    }

    /// JSON-encode a plain value (string, array or dictionary).
    private static func json(_ value: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        guard let text = String(data: data, encoding: .utf8) else { throw DispatchError.encoding }
        return text
    }

    /// JSON-encode raw bytes as a base64 string.
    private static func json(bytes: Data) throws -> String {
        return try json(bytes.base64EncodedString())
    }
}
