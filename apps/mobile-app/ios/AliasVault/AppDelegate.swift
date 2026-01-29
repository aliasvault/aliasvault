import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import VaultStoreKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Handle UI test launch arguments
    #if DEBUG
    if ProcessInfo.processInfo.arguments.contains("--reset-state") {
      resetAppState()
    }
    // Disable UIView animations for UI tests to prevent "wait for app to idle" issues
    // React Native apps have continuous JS bridge activity that prevents XCTest idle detection
    if ProcessInfo.processInfo.arguments.contains("--uitest") {
      UIView.setAnimationsEnabled(false)
    }
    #endif

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  // MARK: - Test Support

  #if DEBUG
  /// Reset all app state for UI tests
  private func resetAppState() {
    print("[UITest] Resetting app state...")

    // 1. Clear VaultStore data (Keychain, files, UserDefaults)
    let vaultStore = VaultStore.shared
    do {
      try vaultStore.clearVault()
      print("[UITest] Cleared VaultStore")
    } catch {
      print("[UITest] Failed to clear VaultStore: \(error)")
    }

    // 2. Clear AsyncStorage data (React Native's persistent storage)
    // AsyncStorage uses the app's Documents directory with RCTAsyncLocalStorage
    clearAsyncStorage()

    // 3. Clear any additional UserDefaults that might not be in VaultStore
    clearAdditionalUserDefaults()

    print("[UITest] App state reset complete")
  }

  /// Clear React Native AsyncStorage
  private func clearAsyncStorage() {
    // AsyncStorage stores data in Documents/RCTAsyncLocalStorage_V1
    let fileManager = FileManager.default
    guard let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
      return
    }

    let asyncStoragePath = documentsPath.appendingPathComponent("RCTAsyncLocalStorage_V1")

    if fileManager.fileExists(atPath: asyncStoragePath.path) {
      do {
        try fileManager.removeItem(at: asyncStoragePath)
        print("[UITest] Cleared AsyncStorage directory")
      } catch {
        print("[UITest] Failed to clear AsyncStorage: \(error)")
      }
    }
  }

  /// Clear additional UserDefaults entries
  private func clearAdditionalUserDefaults() {
    let defaults = UserDefaults.standard

    // Clear any React Native related keys
    let keysToRemove = defaults.dictionaryRepresentation().keys.filter { key in
      key.hasPrefix("RCT") || key.hasPrefix("react") || key.hasPrefix("expo")
    }

    for key in keysToRemove {
      defaults.removeObject(forKey: key)
    }

    defaults.synchronize()
    print("[UITest] Cleared additional UserDefaults (\(keysToRemove.count) keys)")
  }
  #endif
  
  // MARK: - Linking API
  
  func application(_ application: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
    return RCTLinkingManager.application(application, open: url, options: options)
  }
  
  // MARK: - Universal Links
  
  func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    return RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
  }
  
  // MARK: - Remote Notifications
  
  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    // Handle device token if needed
  }
  
  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    // Handle registration failure if needed
  }
  
  func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable : Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
    // Handle remote notification if needed
    completionHandler(.noData)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }
  
  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}