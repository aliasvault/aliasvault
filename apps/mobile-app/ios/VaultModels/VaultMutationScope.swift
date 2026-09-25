import Foundation

/// Scope of a local vault mutation: what actually changed, so the sync engine can push only the data bucket a
/// mutation touched instead of a full manifest. Mirrors VaultMutationScope in core/client.
public struct VaultMutationScope {
    /// A change to the vault content itself, which needs a full manifest push.
    public static let main = "Main"

    /// Every scope the sync engine understands: the manifest scope plus one per data bucket category.
    public static let all = [main] + VaultDataBucketCategory.all

    /// The given scope when the engine knows it, else the manifest scope, which is always safe to push.
    public static func known(_ scope: String?) -> String {
        guard let scope = scope, all.contains(scope) else {
            return main
        }
        return scope
    }
}
