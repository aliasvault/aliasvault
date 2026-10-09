package net.aliasvault.app.vaultstore.utils

import java.util.UUID

/**
 * The folder path of an item, built from the flat folder list of one manifest.
 * Other platform implementations: FolderUtils.ts (core/client), FolderUtils.swift (iOS).
 */
object FolderUtils {
    /**
     * Maximum allowed folder nesting depth (root is 0, folders at depth 4 cannot have subfolders).
     */
    const val MAX_FOLDER_DEPTH = 4

    /**
     * Folder model matching database structure.
     *
     * @property id The unique identifier of the folder.
     * @property name The name of the folder.
     * @property parentFolderId The ID of the parent folder (null for root folders).
     */
    data class Folder(
        val id: UUID,
        val name: String,
        val parentFolderId: UUID?,
    )

    /**
     * Get the full path of folder names from root to the specified folder.
     * @param folderId The folder ID.
     * @param folders Flat array of all folders.
     * @return Array of folder names from root to current folder, or empty array if not found.
     */
    fun getFolderPath(folderId: UUID?, folders: List<Folder>): List<String> {
        if (folderId == null) {
            return emptyList()
        }

        val path = mutableListOf<String>()
        var currentId: UUID? = folderId
        var iterations = 0

        // Build path by traversing up to root
        while (currentId != null && iterations < MAX_FOLDER_DEPTH + 1) {
            val folder = folders.find { it.id == currentId } ?: break
            path.add(0, folder.name) // Add to beginning of array
            currentId = folder.parentFolderId
            iterations++
        }

        return path
    }
}
