import Foundation
import SQLite
import LocalAuthentication
import VaultStoreKit
import VaultModels

/**
 * This class is used as a bridge to allow React Native to interact with the VaultStoreKit class.
 * The VaultStore class is implemented in Swift and used by both React Native and the native iOS
 * Autofill extension.
 */
@objc(VaultManager)
public class VaultManager: NSObject {
    private let vaultStore = VaultStore.shared
    private var backgroundTaskIdentifier: UIBackgroundTaskIdentifier = .invalid
    private var clipboardClearTimer: DispatchSourceTimer?

    override init() {
        super.init()
    }

    @objc
    func storeDatabase(_ base64EncryptedDb: String,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            try vaultStore.storeEncryptedDatabase(base64EncryptedDb)
            resolve(nil)
        } catch {
            reject("DB_ERROR", "Failed to store database: \(error.localizedDescription)", error)
        }
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
            let bindingParams = params.map { param -> Binding? in
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
            let bindingParams = params.map { param -> Binding? in
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
    func getCurrentVaultRevisionNumber(_ resolve: @escaping RCTPromiseResolveBlock,
                                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        let revisionNumber = vaultStore.getCurrentVaultRevisionNumber()
        resolve(revisionNumber)
    }

    @objc
    func setCurrentVaultRevisionNumber(_ revisionNumber: Int,
                                     resolver resolve: @escaping RCTPromiseResolveBlock,
                                     rejecter reject: @escaping RCTPromiseRejectBlock) {
        vaultStore.setCurrentVaultRevisionNumber(revisionNumber)
        resolve(nil)
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
        } catch {
            // Check if the error is related to Face ID or decryption
            if let nsError = error as NSError? {
                if nsError.domain == "VaultStore" {
                    // These are our known error codes for initialization failures
                    if nsError.code == 1 || nsError.code == 2 || nsError.code == 8 || nsError.code == 10 {
                        resolve(false)
                        return
                    }
                }
            }
            reject("INIT_ERROR", "Failed to unlock vault: \(error.localizedDescription)", error)
        }
    }

    @objc
    func clearClipboardAfterDelay(_ delayInSeconds: Double,
                                 resolver resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
        NSLog("VaultManager: Scheduling clipboard clear after %.0f seconds", delayInSeconds)

        if delayInSeconds <= 0 {
            NSLog("VaultManager: Delay is 0 or negative, not scheduling clipboard clear")
            resolve(nil)
            return
        }

        // Cancel any existing clipboard clear operations
        cancelClipboardClear()

        // Start background task to keep app alive during clipboard clear
        backgroundTaskIdentifier = UIApplication.shared.beginBackgroundTask(withName: "ClipboardClear") { [weak self] in
            NSLog("VaultManager: Background task expired, cleaning up")
            self?.endBackgroundTask()
        }

        clipboardClearTimer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
        clipboardClearTimer?.schedule(deadline: .now() + delayInSeconds)
        clipboardClearTimer?.setEventHandler { [weak self] in
            NSLog("VaultManager: Clearing clipboard after %.0f seconds delay", delayInSeconds)
            UIPasteboard.general.string = ""
            NSLog("VaultManager: Clipboard cleared successfully")
            self?.endBackgroundTask()
            self?.clipboardClearTimer?.cancel()
            self?.clipboardClearTimer = nil
        }
        clipboardClearTimer?.resume()

        resolve(nil)
    }

    private func cancelClipboardClear() {
        clipboardClearTimer?.cancel()
        clipboardClearTimer = nil
        endBackgroundTask()
    }

    private func endBackgroundTask() {
        if backgroundTaskIdentifier != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTaskIdentifier)
            backgroundTaskIdentifier = .invalid
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
        if let settingsUrl = URL(string: "App-Prefs:root") {
            DispatchQueue.main.async {
                UIApplication.shared.open(settingsUrl)
                resolve(nil)
            }
        } else {
            reject("SETTINGS_ERROR", "Cannot open settings", nil)
        }
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
    func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc
    static func moduleName() -> String! {
        return "VaultManager"
    }
}
