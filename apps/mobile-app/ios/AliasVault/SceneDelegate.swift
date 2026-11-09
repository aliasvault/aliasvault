import UIKit
internal import Expo
import VaultUtils

/// Scene delegate required by the iOS 27 SDK. The Expo base class creates the window, starts React Native and
/// forwards URL, user activity and life cycle events to the app delegate and its subscribers.
internal class SceneDelegate: ExpoAppSceneDelegate {
  private var screenCaptureProtection: ScreenCaptureProtection?

  override func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)

    if let windowScene = scene as? UIWindowScene {
      screenCaptureProtection = ScreenCaptureProtection(scene: windowScene)
    }
  }

  // MARK: - Screen capture protection

  override func sceneDidEnterBackground(_ scene: UIScene) {
    super.sceneDidEnterBackground(scene)
    screenCaptureProtection?.sceneDidEnterBackground()
  }

  override func sceneWillEnterForeground(_ scene: UIScene) {
    super.sceneWillEnterForeground(scene)
    screenCaptureProtection?.sceneWillEnterForeground()
  }
}
