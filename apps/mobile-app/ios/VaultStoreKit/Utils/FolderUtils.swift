import Foundation

/// The folder path of an item, built from the flat folder list of one manifest.
/// Other platform implementations: FolderUtils.ts (core/client), FolderUtils.kt (Android).
public enum FolderUtils {
    /// Maximum allowed folder nesting depth (root is 0, folders at depth 4 cannot have subfolders).
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
}
