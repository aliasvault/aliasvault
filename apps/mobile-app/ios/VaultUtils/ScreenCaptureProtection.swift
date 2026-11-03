import UIKit

/// Screen capture protection: covers the app while its scene is in the background, so the app switcher snapshot shows the launch screen.
///
/// Other platform implementations: ScreenCaptureProtection.kt (Android).
@MainActor
public final class ScreenCaptureProtection {
    private weak var scene: UIWindowScene?
    private var coverWindow: UIWindow?
    private var isInBackground = false

    /// Whether screen capture protection is enabled. Defaults to `true`.
    nonisolated public static var isEnabled: Bool {
        guard let defaults = UserDefaults(suiteName: VaultConstants.userDefaultsSuite),
              defaults.object(forKey: VaultConstants.screenCaptureProtectionKey) != nil else { return true }
        return defaults.bool(forKey: VaultConstants.screenCaptureProtectionKey)
    }

    /// Store the preference, which applies the next time the scene enters the background.
    nonisolated public static func setEnabled(_ enabled: Bool) {
        UserDefaults(suiteName: VaultConstants.userDefaultsSuite)?.set(enabled, forKey: VaultConstants.screenCaptureProtectionKey)
    }

    /// Start protecting the given scene.
    public init(scene: UIWindowScene) {
        self.scene = scene
    }

    /// Cover the scene before iOS takes the app switcher snapshot.
    public func sceneDidEnterBackground() {
        isInBackground = true
        update()
    }

    /// Remove the cover as the scene returns to the foreground.
    public func sceneWillEnterForeground() {
        isInBackground = false
        update()
    }

    private func update() {
        guard let scene else { return }
        if Self.isEnabled && isInBackground {
            showCover(in: scene)
        } else {
            coverWindow?.isHidden = true
            coverWindow = nil
        }
    }

    private func showCover(in scene: UIWindowScene) {
        guard coverWindow == nil else { return }
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        window.rootViewController = Self.makeCoverViewController()
        window.isHidden = false
        coverWindow = window
    }

    /// The app's launch screen when the bundle has one, else a plain background.
    private static func makeCoverViewController() -> UIViewController {
        if Bundle.main.path(forResource: "SplashScreen", ofType: "storyboardc") != nil,
           let controller = UIStoryboard(name: "SplashScreen", bundle: .main).instantiateInitialViewController() {
            return controller
        }
        let controller = UIViewController()
        controller.view.backgroundColor = .systemBackground
        return controller
    }
}
