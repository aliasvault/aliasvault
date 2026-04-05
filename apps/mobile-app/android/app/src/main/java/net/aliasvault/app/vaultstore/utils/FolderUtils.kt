package net.aliasvault.app.vaultstore.utils

import java.util.UUID

/**
 * Utilities for working with folder hierarchies and trees.
 */
object FolderUtils {
    /**
     * Maximum allowed folder nesting depth.
     * Structure: Root (0) > Level 1 (1) > Level 2 (2) > Level 3 (3) > Level 4 (4).
     * Folders at depth 4 cannot have subfolders.
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
     * Get folder depth in the hierarchy.
     * @param folderId The folder ID to check.
     * @param folders Flat array of all folders.
     * @return Depth (0 = root, 1 = one level deep, etc.) or null if folder not found.
     */
    @Suppress("LoopWithTooManyJumpStatements")
    fun getFolderDepth(folderId: UUID, folders: List<Folder>): Int? {
        val folder = folders.find { it.id == folderId } ?: return null

        var depth = 0
        var currentId: UUID? = folderId

        // Traverse up to root, counting levels
        while (currentId != null) {
            val current = folders.find { it.id == currentId } ?: break
            if (current.parentFolderId == null) {
                break
            }
            depth++
            currentId = current.parentFolderId

            // Prevent infinite loops
            if (depth > MAX_FOLDER_DEPTH) {
                break
            }
        }

        return depth
    }

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

    /**
     * Get the full path of folder IDs from root to the specified folder.
     * @param folderId The folder ID.
     * @param folders Flat array of all folders.
     * @return Array of folder IDs from root to current folder, or empty array if not found.
     */
    fun getFolderIdPath(folderId: UUID?, folders: List<Folder>): List<UUID> {
        if (folderId == null) {
            return emptyList()
        }

        val path = mutableListOf<UUID>()
        var currentId: UUID? = folderId
        var iterations = 0

        // Build path by traversing up to root
        while (currentId != null && iterations < MAX_FOLDER_DEPTH + 1) {
            val folder = folders.find { it.id == currentId } ?: break
            path.add(0, folder.id) // Add to beginning of array
            currentId = folder.parentFolderId
            iterations++
        }

        return path
    }

    /**
     * Format folder path for display with separator.
     * @param pathSegments Array of folder names.
     * @param separator Separator string (default: " > ").
     * @return Formatted folder path string.
     */
    fun formatFolderPath(pathSegments: List<String>, separator: String = " > "): String {
        return pathSegments.joinToString(separator)
    }

    /**
     * Check if a folder can have subfolders (not at max depth).
     * @param folderId The folder ID to check.
     * @param folders Flat array of all folders.
     * @return True if folder can have children, false otherwise.
     */
    fun canHaveSubfolders(folderId: UUID, folders: List<Folder>): Boolean {
        val depth = getFolderDepth(folderId, folders)
        return depth != null && depth < MAX_FOLDER_DEPTH
    }

    /**
     * Get all descendant folder IDs (children, grandchildren, etc.).
     * @param folderId The parent folder ID.
     * @param folders Flat array of all folders.
     * @return Array of descendant folder IDs.
     */
    fun getDescendantFolderIds(folderId: UUID, folders: List<Folder>): List<UUID> {
        val descendants = mutableListOf<UUID>()

        fun traverse(parentId: UUID) {
            folders
                .filter { it.parentFolderId == parentId }
                .forEach { child ->
                    descendants.add(child.id)
                    traverse(child.id)
                }
        }

        traverse(folderId)
        return descendants
    }

    /**
     * Get all direct child folder IDs.
     * @param parentFolderId The parent folder ID (null for root).
     * @param folders Flat array of all folders.
     * @return Array of direct child folder IDs.
     */
    fun getDirectChildFolderIds(parentFolderId: UUID?, folders: List<Folder>): List<UUID> {
        return folders
            .filter { it.parentFolderId == parentFolderId }
            .map { it.id }
    }
}
