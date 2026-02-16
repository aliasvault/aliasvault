import Foundation
import SQLite
import LocalAuthentication
import VaultStoreKit
import VaultModels
import SwiftUI
import VaultUI
import AVFoundation
import RustCoreFramework
import AuthenticationServices

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

    /// Store encryption key in memory only (no keychain persistence).
    /// Use this to test if a password-derived key is valid before persisting.
    @objc
    func storeEncryptionKeyInMemory(_ base64EncryptionKey: String,
                                    resolver resolve: @escaping RCTPromiseResolveBlock,
                                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.storeEncryptionKeyInMemory(base64Key: base64EncryptionKey)
            resolve(nil)
        } catch {
            reject("ERR_STORE_KEY_MEMORY", "Failed to store encryption key in memory: \(error.localizedDescription)", error)
        }
    }

    /// Store encryption key in memory AND persist to keychain if Face ID is enabled.
    @objc
    func storeEncryptionKey(_ base64EncryptionKey: String,
                            resolver resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.storeEncryptionKey(base64Key: base64EncryptionKey)
            resolve(nil)
        } catch {
            reject("KEYCHAIN_ERROR", "Failed to store encryption key: \(error.localizedDescription)", error)
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
    func storeEncryptionKeyDerivationParams(_ keyDerivationParams: String,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.storeEncryptionKeyDerivationParams(keyDerivationParams)
            resolve(nil)
        } catch {
            reject("KEYCHAIN_ERROR", "Failed to store encryption key derivation params: \(error.localizedDescription)", error)
        }
    }

    @objc
    func getEncryptionKeyDerivationParams(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        if let params = vaultStore.getEncryptionKeyDerivationParams() {
            resolve(params)
        } else {
            resolve(nil)
        }
    }

    @objc
    func executeQuery(_ query: String,
                      params: [Any],
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            // Parse all params to the correct type
            let bindingParams: [(any SQLite.Binding)?] = params.map { param in
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

            // Execute the query through the vault store
            let results = try vaultStore.executeQuery(query, params: bindingParams)
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
            let bindingParams: [(any SQLite.Binding)?] = params.map { param in
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
    func commitTransaction(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.commitTransaction()
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
    func persistAndMarkDirty(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.persistAndMarkDirty()
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
    func copyToClipboardWithExpiration(_ text: String,
                                      expirationSeconds: Double,
                                      resolver resolve: @escaping RCTPromiseResolveBlock,
                                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        NSLog("VaultManager: Copying to clipboard with expiration of %.0f seconds", expirationSeconds)

        DispatchQueue.main.async {
            if expirationSeconds > 0 {
                // Create expiration date
                let expirationDate = Date().addingTimeInterval(expirationSeconds)

                // Set clipboard with expiration and local-only options
                UIPasteboard.general.setItems(
                    [[UIPasteboard.typeAutomatic: text]],
                    options: [
                        .expirationDate: expirationDate,
                        .localOnly: true  // Prevent sync to Universal Clipboard/iCloud
                    ]
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
    func syncVaultWithServer(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            let result = await vaultStore.syncVaultWithServer(using: webApiService)
            await MainActor.run {
                let response: [String: Any] = [
                    "success": result.success,
                    "action": result.action.rawValue,
                    "newRevision": result.newRevision,
                    "wasOffline": result.wasOffline,
                    "error": result.error as Any
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
                    let encryptionKeyBase64 = try self.vaultStore.unlockWithPin(pin)

                    // Store the encryption key in memory
                    try self.vaultStore.storeEncryptionKey(base64Key: encryptionKeyBase64)

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

    @objc
    func authenticateUser(_ title: String?,
                         subtitle: String?,
                         resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        // Check if PIN is enabled first
        let pinEnabled = vaultStore.isPinEnabled()

        if pinEnabled {
            // PIN is enabled, show PIN unlock UI
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

                let pinView = PinUnlockView(viewModel: viewModel)
                let hostingController = UIHostingController(rootView: pinView)

                // Present modally as full screen
                hostingController.modalPresentationStyle = .fullScreen
                rootVC.present(hostingController, animated: true)
            }
        } else {
            // Use biometric authentication
            let authenticated = vaultStore.issueBiometricAuthentication(title: title)
            resolve(authenticated)
        }
    }

    // MARK: - Sync State Management

    @objc
    func getSyncState(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        let syncState = vaultStore.getSyncState()
        let result: [String: Any] = [
            "isDirty": syncState.isDirty,
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

        resolve(nil)
    }

    // MARK: - SRP (Secure Remote Password) Operations

    /// Generate a cryptographic salt for SRP.
    /// Returns a 32-byte random salt as an uppercase hex string.
    @objc
    func srpGenerateSalt(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        let salt = RustCoreFramework.srpGenerateSalt()
        resolve(salt)
    }

    /// Derive the SRP private key (x) from credentials.
    /// Formula: x = H(salt | H(identity | ":" | password_hash))
    @objc
    func srpDerivePrivateKey(_ salt: String,
                             identity: String,
                             passwordHash: String,
                             resolver resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            let privateKey = try RustCoreFramework.srpDerivePrivateKey(salt: salt, identity: identity, passwordHash: passwordHash)
            resolve(privateKey)
        } catch {
            reject("SRP_ERROR", "Failed to derive SRP private key: \(error.localizedDescription)", error)
        }
    }

    /// Derive the SRP verifier (v) from a private key.
    /// Formula: v = g^x mod N
    @objc
    func srpDeriveVerifier(_ privateKey: String,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            let verifier = try RustCoreFramework.srpDeriveVerifier(privateKey: privateKey)
            resolve(verifier)
        } catch {
            reject("SRP_ERROR", "Failed to derive SRP verifier: \(error.localizedDescription)", error)
        }
    }

    /// Generate a client ephemeral key pair.
    /// Returns a JSON object with public (A) and secret (a) values as uppercase hex strings.
    @objc
    func srpGenerateEphemeral(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        let ephemeral = RustCoreFramework.srpGenerateEphemeral()
        let result: [String: String] = [
            "public": ephemeral.public,
            "secret": ephemeral.secret
        ]
        resolve(result)
    }

    /// Derive the client session from server response.
    /// Returns a JSON object with proof (M1) and key (K) as uppercase hex strings.
    @objc
    func srpDeriveSession(_ clientSecret: String,
                          serverPublic: String,
                          salt: String,
                          identity: String,
                          privateKey: String,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            let session = try RustCoreFramework.srpDeriveSession(
                clientSecret: clientSecret,
                serverPublic: serverPublic,
                salt: salt,
                identity: identity,
                privateKey: privateKey
            )
            let result: [String: String] = [
                "proof": session.proof,
                "key": session.key
            ]
            resolve(result)
        } catch {
            reject("SRP_ERROR", "Failed to derive SRP session: \(error.localizedDescription)", error)
        }
    }

    @objc
    func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    static func moduleName() -> String! {
        return "VaultManager"
    }
}
