package net.aliasvault.app.vaultstore.models

/**
 * Result of storing vault with sync state.
 */
data class StoreVaultResult(
    /**
     * Whether the store operation succeeded.
     * Can be false if expectedMutationSeq was provided and didn't match.
     */
    val success: Boolean,

    /**
     * The current mutation sequence after the operation.
     */
    val mutationSequence: Int,
)
