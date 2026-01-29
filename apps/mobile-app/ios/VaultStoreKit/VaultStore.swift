import Foundation
import SQLite
import LocalAuthentication
import CryptoKit
import CommonCrypto
import Security
import VaultModels

/// This class is used to store and retrieve the encrypted AliasVault database and encryption key.
/// It also handles executing queries against the SQLite database and biometric authentication.
///
/// This class is used by both the iOS Autofill extension and the React Native app and is the lowest
/// level where all important data is stored and retrieved from.
public class VaultStore {
    /// A shared instance of the VaultStore class that can be used to access the vault which does
    /// require re-authentication every time the vault is accessed.
    public static let shared = VaultStore()

    /// The user defaults using the shared container which is accessible by both the React Native
    /// app and the iOS Autofill extension.
    internal let userDefaults = UserDefaults(suiteName: VaultConstants.userDefaultsSuite)!

    /// The enabled authentication methods for the vault.
    internal var enabledAuthMethods: AuthMethods = []

    /// The auto-lock timeout for the vault.
    internal var autoLockTimeout: Int = VaultConstants.defaultAutoLockTimeout

    /// The database connection for the decrypted in-memory vault.
    internal var dbConnection: Connection?

    /// The encryption key for the vault.
    internal var encryptionKey: Data?

    /// The key derivation parameters used to derive the encryption key from the password.
    internal var keyDerivationParams: String?

    /// The timer for the auto-lock timeout.
    private var clearCacheTimer: Timer?

    /// Initialize the VaultStore
    public init() {
        excludeSharedContainerFromBackup()
        loadSavedSettings()
        setupNotificationObservers()
    }

    /// Deinitialize the VaultStore
    deinit {
        NotificationCenter.default.removeObserver(self)
        self.clearCacheTimer?.invalidate()
    }

    /// Whether the vault is currently unlocked
    public var isVaultUnlocked: Bool {
        return encryptionKey != nil
    }

    /// Exclude the entire shared app group container from iCloud and iTunes backups.
    /// All app data (encrypted vault database, UserDefaults plist with auth tokens and key
    /// derivation parameters) is security-sensitive and device-bound. Note: actual encryption keys
    /// are stored separately in the Keychain with ThisDeviceOnly accessibility.
    private func excludeSharedContainerFromBackup() {
        guard var containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: VaultConstants.userDefaultsSuite
        ) else {
            return
        }

        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try? containerURL.setResourceValues(resourceValues)
    }

    private func loadSavedSettings() {
        if userDefaults.object(forKey: VaultConstants.authMethodsKey) != nil {
            let savedRawValue = userDefaults.integer(forKey: VaultConstants.authMethodsKey)
            self.enabledAuthMethods = AuthMethods(rawValue: savedRawValue)
        }

        if userDefaults.object(forKey: VaultConstants.autoLockTimeoutKey) != nil {
            self.autoLockTimeout = userDefaults.integer(forKey: VaultConstants.autoLockTimeoutKey)
        }

        if let savedParams = userDefaults.string(forKey: VaultConstants.encryptionKeyDerivationParamsKey) {
            self.keyDerivationParams = savedParams
        }
    }

    private func setupNotificationObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    // MARK: - Background/Foreground Handling
    @objc private func appDidEnterBackground() {
        print("App entered background, starting auto-lock timer with \(autoLockTimeout) seconds")
        if self.autoLockTimeout > 0 {
            self.clearCacheTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(self.autoLockTimeout), repeats: false) { [weak self] _ in
                print("Auto-lock timer fired, clearing cache")
                self?.clearCache()
            }
        }
    }

    @objc private func appWillEnterForeground() {
        print("App will enter foreground, canceling clear cache timer")

        if let timer = self.clearCacheTimer, timer.fireDate < Date() {
            print("Timer has elapsed, cache should have been cleared already when app was in background, but clearing it again to be sure")
            clearCache()
        }

        self.clearCacheTimer?.invalidate()
        self.clearCacheTimer = nil
    }
}
