import Foundation

private final class VaultStoreKitBundleToken {}

public extension Bundle {
    /// The bundle that contains VaultStoreKit's localized resources.
    static var vaultStoreKit: Bundle {
        return Bundle(for: VaultStoreKitBundleToken.self)
    }
}
