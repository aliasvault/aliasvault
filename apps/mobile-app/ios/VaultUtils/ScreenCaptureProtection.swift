import UIKit

/// Screen capture protection: covers the app while its scene is inactive (app switcher snapshot) or while the screen is
/// recorded or mirrored.
///
/// Other platform implementations: ScreenCaptureProtection.kt (Android).
@MainActor
public final class ScreenCaptureProtection {
    /// The instances attached to a connected scene, so a changed preference applies right away.
    private static let attached = NSHashTable<ScreenCaptureProtection>.weakObjects()

    private weak var scene: UIWindowScene?
    private var coverWindow: UIWindow?
    private var isInactive = false

    /// Whether screen capture protection is enabled. Defaults to `true`.
    nonisolated public static var isEnabled: Bool {
        guard let defaults = UserDefaults(suiteName: VaultConstants.userDefaultsSuite),
              defaults.object(forKey: VaultConstants.screenCaptureProtectionKey) != nil else { return true }
        return defaults.bool(forKey: VaultConstants.screenCaptureProtectionKey)
    }

    /// Store the preference and apply it to every connected scene.
    nonisolated public static func setEnabled(_ enabled: Bool) {
        UserDefaults(suiteName: VaultConstants.userDefaultsSuite)?.set(enabled, forKey: VaultConstants.screenCaptureProtectionKey)
        Task { @MainActor in
            attached.allObjects.forEach { $0.update() }
        }
    }

    /// Start protecting the given scene, covering it whenever its screen is captured.
    public init(scene: UIWindowScene) {
        self.scene = scene
        scene.registerForTraitChanges([UITraitSceneCaptureState.self]) { [weak self] (_: UIWindowScene, _: UITraitCollection) in
            self?.update()
        }
        Self.attached.add(self)
        update()
    }

    /// Cover the scene before iOS takes the app switcher snapshot.
    public func sceneWillResignActive() {
        isInactive = true
        update()
    }

    /// Remove the cover once the scene is active again, unless the screen is still captured.
    public func sceneDidBecomeActive() {
        isInactive = false
        update()
    }

    private func update() {
        guard let scene else { return }
        let isCaptured = scene.traitCollection.sceneCaptureState == .active
        if Self.isEnabled && (isInactive || isCaptured) {
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
