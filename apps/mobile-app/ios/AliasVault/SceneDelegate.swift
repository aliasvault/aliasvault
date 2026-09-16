import UIKit
import React

/// UIKit requires the UIScene lifecycle for apps linked against the iOS 27 SDK, otherwise the app will crash on boot with iOS 27+ while it still works with iOS 26.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else {
      fatalError("SceneDelegate: React Native factory is not initialized")
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    // Under the scene lifecycle, URLs and user activities that launched the app arrive here
    // instead of in didFinishLaunchingWithOptions. Forward them so Linking.getInitialURL() works.
    var launchOptions = appDelegate.launchOptions ?? [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    if let activity = connectionOptions.userActivities.first {
      launchOptions[.userActivityDictionary] = ["UIApplicationLaunchOptionsUserActivityKey": activity]
    }

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions
    )
  }

  // MARK: - Linking API

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace
      ]
      if let sourceApplication = context.options.sourceApplication {
        options[.sourceApplication] = sourceApplication
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }
      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  // MARK: - Universal Links

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(UIApplication.shared, continue: userActivity) { _ in }
  }
}
