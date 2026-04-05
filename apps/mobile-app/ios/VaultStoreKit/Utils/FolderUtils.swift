import Foundation

/// Utilities for working with folder hierarchies and trees.
public enum FolderUtils {
    /// Maximum allowed folder nesting depth.
    /// Structure: Root (0) > Level 1 (1) > Level 2 (2) > Level 3 (3) > Level 4 (4).
    /// Folders at depth 4 cannot have subfolders.
    public static let maxFolderDepth = 4

    /// Simplified folder model for utility functions.
    public struct Folder {
        public let id: UUID
        public let name: String
        public let parentFolderId: UUID?

        public init(id: UUID, name: String, parentFolderId: UUID?) {
            self.id = id
            self.name = name
            self.parentFolderId = parentFolderId
        }
    }

    /// Get folder depth in the hierarchy.
    /// - Parameters:
    ///   - folderId: The folder ID to check.
    ///   - folders: Flat array of all folders.
    /// - Returns: Depth (0 = root, 1 = one level deep, etc.) or nil if folder not found.
    public static func getFolderDepth(folderId: UUID, folders: [Folder]) -> Int? {
        guard folders.contains(where: { $0.id == folderId }) else {
            return nil
        }

        var depth = 0
        var currentId: UUID? = folderId

        // Traverse up to root, counting levels
        while let id = currentId {
            guard let current = folders.first(where: { $0.id == id }) else {
                break
            }
            guard let parentId = current.parentFolderId else {
                break
            }
            depth += 1
            currentId = parentId

            // Prevent infinite loops
            if depth > maxFolderDepth {
                break
            }
        }

        return depth
    }

    /// Get the full path of folder names from root to the specified folder.
    /// - Parameters:
    ///   - folderId: The folder ID.
    ///   - folders: Flat array of all folders.
    /// - Returns: Array of folder names from root to current folder, or empty array if not found.
    public static func getFolderPath(folderId: UUID?, folders: [Folder]) -> [String] {
        guard let folderId = folderId else {
            return []
        }

        var path: [String] = []
        var currentId: UUID? = folderId
        var iterations = 0

        // Build path by traversing up to root
        while let id = currentId, iterations < maxFolderDepth + 1 {
            guard let folder = folders.first(where: { $0.id == id }) else {
                break
            }
            path.insert(folder.name, at: 0) // Add to beginning of array
            currentId = folder.parentFolderId
            iterations += 1
        }

        return path
    }

    /// Get the full path of folder IDs from root to the specified folder.
    /// - Parameters:
    ///   - folderId: The folder ID.
    ///   - folders: Flat array of all folders.
    /// - Returns: Array of folder IDs from root to current folder, or empty array if not found.
    public static func getFolderIdPath(folderId: UUID?, folders: [Folder]) -> [UUID] {
        guard let folderId = folderId else {
            return []
        }

        var path: [UUID] = []
        var currentId: UUID? = folderId
        var iterations = 0

        // Build path by traversing up to root
        while let id = currentId, iterations < maxFolderDepth + 1 {
            guard let folder = folders.first(where: { $0.id == id }) else {
                break
            }
            path.insert(folder.id, at: 0) // Add to beginning of array
            currentId = folder.parentFolderId
            iterations += 1
        }

        return path
    }

    /// Format folder path for display with separator.
    /// - Parameters:
    ///   - pathSegments: Array of folder names.
    ///   - separator: Separator string (default: " > ").
    /// - Returns: Formatted folder path string.
    public static func formatFolderPath(pathSegments: [String], separator: String = " > ") -> String {
        return pathSegments.joined(separator: separator)
    }

    /// Check if a folder can have subfolders (not at max depth).
    /// - Parameters:
    ///   - folderId: The folder ID to check.
    ///   - folders: Flat array of all folders.
    /// - Returns: True if folder can have children, false otherwise.
    public static func canHaveSubfolders(folderId: UUID, folders: [Folder]) -> Bool {
        guard let depth = getFolderDepth(folderId: folderId, folders: folders) else {
            return false
        }
        return depth < maxFolderDepth
    }

    /// Get all descendant folder IDs (children, grandchildren, etc.).
    /// - Parameters:
    ///   - folderId: The parent folder ID.
    ///   - folders: Flat array of all folders.
    /// - Returns: Array of descendant folder IDs.
    public static func getDescendantFolderIds(folderId: UUID, folders: [Folder]) -> [UUID] {
        var descendants: [UUID] = []

        func traverse(parentId: UUID) {
            let children = folders.filter { $0.parentFolderId == parentId }
            for child in children {
                descendants.append(child.id)
                traverse(parentId: child.id)
            }
        }

        traverse(parentId: folderId)
        return descendants
    }

    /// Get all direct child folder IDs.
    /// - Parameters:
    ///   - parentFolderId: The parent folder ID (nil for root).
    ///   - folders: Flat array of all folders.
    /// - Returns: Array of direct child folder IDs.
    public static func getDirectChildFolderIds(parentFolderId: UUID?, folders: [Folder]) -> [UUID] {
        return folders
            .filter { $0.parentFolderId == parentFolderId }
            .map { $0.id }
    }
}
