package net.aliasvault.app.vaultstore.interfaces

import net.aliasvault.app.vaultstore.models.Item

/**
 * Interface for operations that need callbacks for items.
 */
interface ItemOperationCallback {
    /**
     * Called when the operation is successful.
     * @param result The result of the operation
     */
    fun onSuccess(result: List<Item>)

    /**
     * Called when the operation fails.
     * @param e The exception that occurred
     */
    fun onError(e: Exception)
}
