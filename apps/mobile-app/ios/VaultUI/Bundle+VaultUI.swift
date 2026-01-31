import Foundation

private final class VaultUIBundleToken {}

public extension Bundle {
    /// The bundle that contains VaultUI's localized resources
    static var vaultUI: Bundle {
        // If you don’t use a separate .bundle target, this is the framework bundle itself.
        let frameworkBundle = Bundle(for: VaultUIBundleToken.self)
        return frameworkBundle
    }
}
