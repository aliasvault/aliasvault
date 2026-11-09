import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
internal import Expo
import VaultStoreKit

@main
internal class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  var window: UIWindow?
  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  override func application(
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
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // The window is created and React Native is started by `SceneDelegate` under the
    // scene-based life cycle (required by the iOS 27 SDK).
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // MARK: - Orientation

  /// Caps every screen to the expo-screen-orientation lock (portrait unless a screen unlocks it); iPad keeps all orientations.
  override func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
    if UIDevice.current.userInterfaceIdiom == .pad { return .all }
    let mask = super.application(application, supportedInterfaceOrientationsFor: window)
    return mask.isEmpty ? .portrait : mask
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
}

private class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
