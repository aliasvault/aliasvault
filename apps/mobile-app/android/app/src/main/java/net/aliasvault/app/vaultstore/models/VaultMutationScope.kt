package net.aliasvault.app.vaultstore.models

/**
 * Scope of a local vault mutation: what actually changed, so the sync engine can push only the data bucket a
 * mutation touched instead of a full manifest. Mirrors VaultMutationScope in core/client.
 */
object VaultMutationScope {
    /**
     * A change to the vault content itself, which needs a full manifest push.
     */
    const val MAIN = "Main"

    /**
     * Every scope the sync engine understands: the manifest scope plus one per data bucket category.
     */
    val all = listOf(MAIN) + VaultDataBucketCategory.all

    /**
     * The given scope when the engine knows it, else the manifest scope, which is always safe to push.
     */
    fun known(scope: String?): String = if (scope != null && all.contains(scope)) scope else MAIN
}
