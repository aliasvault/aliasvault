//-----------------------------------------------------------------------
// <copyright file="FolderTreeUtilities.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Utilities;

using AliasClientDb;
using AliasVault.Client.Main.Models;

/// <summary>
/// Utilities for working with folder hierarchies and trees.
/// </summary>
public static class FolderTreeUtilities
{
    /// <summary>
    /// Maximum allowed folder nesting depth.
    /// Structure: Root (0) > Level 1 (1) > Level 2 (2) > Level 3 (3) > Level 4 (4).
    /// Folders at depth 4 cannot have subfolders.
    /// </summary>
    public const int MaxFolderDepth = 4;

    /// <summary>
    /// Build a hierarchical tree from a flat array of folders.
    /// </summary>
    /// <param name="folders">Flat array of folders.</param>
    /// <returns>Array of root-level folder tree nodes.</returns>
    public static List<FolderTreeNode> BuildFolderTree(IEnumerable<Folder> folders)
    {
        var folderList = folders.ToList();

        // Create a map for quick lookup
        var folderMap = new Dictionary<Guid, FolderTreeNode>();

        // Initialize all folders as tree nodes
        foreach (var folder in folderList)
        {
            folderMap[folder.Id] = new FolderTreeNode
            {
                Folder = folder,
                Children = new List<FolderTreeNode>(),
                Depth = 0,
                Path = new List<Guid>(),
            };
        }

        // Build the tree structure
        var rootFolders = new List<FolderTreeNode>();

        foreach (var folder in folderList)
        {
            var node = folderMap[folder.Id];

            if (folder.ParentFolderId == null)
            {
                // Root folder
                node.Depth = 0;
                node.Path = new List<Guid> { folder.Id };
                rootFolders.Add(node);
            }
            else
            {
                // Child folder
                if (folderMap.TryGetValue(folder.ParentFolderId.Value, out var parent))
                {
                    node.Depth = parent.Depth + 1;
                    node.Path = new List<Guid>(parent.Path) { folder.Id };
                    parent.Children.Add(node);
                }
                else
                {
                    // Parent not found or deleted - treat as root
                    node.Depth = 0;
                    node.Path = new List<Guid> { folder.Id };
                    rootFolders.Add(node);
                }
            }
        }

        // Sort children recursively
        SortChildren(rootFolders);

        return rootFolders;
    }

    /// <summary>
    /// Get folder depth in the hierarchy.
    /// </summary>
    /// <param name="folderId">The folder ID to check.</param>
    /// <param name="folders">Flat array of all folders.</param>
    /// <returns>Depth (0 = root, 1 = one level deep, etc.) or null if folder not found.</returns>
    public static int? GetFolderDepth(Guid folderId, IEnumerable<Folder> folders)
    {
        var folderList = folders.ToList();
        var folder = folderList.FirstOrDefault(f => f.Id == folderId);
        if (folder == null)
        {
            return null;
        }

        int depth = 0;
        Guid? currentId = folderId;

        // Traverse up to root, counting levels
        while (currentId.HasValue)
        {
            var current = folderList.FirstOrDefault(f => f.Id == currentId.Value);
            if (current == null || current.ParentFolderId == null)
            {
                break;
            }

            depth++;
            currentId = current.ParentFolderId;

            // Prevent infinite loops
            if (depth > MaxFolderDepth)
            {
                break;
            }
        }

        return depth;
    }

    /// <summary>
    /// Get the full path of folder names from root to the specified folder.
    /// </summary>
    /// <param name="folderId">The folder ID.</param>
    /// <param name="folders">Flat array of all folders.</param>
    /// <returns>Array of folder names from root to current folder, or empty array if not found.</returns>
    public static List<string> GetFolderPath(Guid? folderId, IEnumerable<Folder> folders)
    {
        if (!folderId.HasValue)
        {
            return new List<string>();
        }

        var path = new List<string>();
        var folderList = folders.ToList();
        Guid? currentId = folderId;
        int iterations = 0;

        // Build path by traversing up to root
        while (currentId.HasValue && iterations < MaxFolderDepth + 1)
        {
            var folder = folderList.FirstOrDefault(f => f.Id == currentId.Value);
            if (folder == null)
            {
                break;
            }

            path.Insert(0, folder.Name); // Add to beginning of array
            currentId = folder.ParentFolderId;
            iterations++;
        }

        return path;
    }

    /// <summary>
    /// Get the full path of folder IDs from root to the specified folder.
    /// </summary>
    /// <param name="folderId">The folder ID.</param>
    /// <param name="folders">Flat array of all folders.</param>
    /// <returns>Array of folder IDs from root to current folder, or empty array if not found.</returns>
    public static List<Guid> GetFolderIdPath(Guid? folderId, IEnumerable<Folder> folders)
    {
        if (!folderId.HasValue)
        {
            return new List<Guid>();
        }

        var path = new List<Guid>();
        var folderList = folders.ToList();
        Guid? currentId = folderId;
        int iterations = 0;

        // Build path by traversing up to root
        while (currentId.HasValue && iterations < MaxFolderDepth + 1)
        {
            var folder = folderList.FirstOrDefault(f => f.Id == currentId.Value);
            if (folder == null)
            {
                break;
            }

            path.Insert(0, folder.Id); // Add to beginning of array
            currentId = folder.ParentFolderId;
            iterations++;
        }

        return path;
    }

    /// <summary>
    /// Format folder path for display with separator.
    /// </summary>
    /// <param name="pathSegments">Array of folder names.</param>
    /// <param name="separator">Separator string (default: " > ").</param>
    /// <returns>Formatted folder path string.</returns>
    public static string FormatFolderPath(List<string> pathSegments, string separator = " > ")
    {
        return string.Join(separator, pathSegments);
    }

    /// <summary>
    /// Flatten a folder tree into a sorted array suitable for dropdowns.
    /// Includes visual indentation in the name.
    /// </summary>
    /// <param name="tree">Root-level folder tree nodes.</param>
    /// <param name="excludeId">Optional folder ID to exclude (useful when moving folders).</param>
    /// <returns>Flat array of tree nodes with indented names.</returns>
    public static List<FolderTreeNode> FlattenFolderTree(
        List<FolderTreeNode> tree,
        Guid? excludeId = null)
    {
        var result = new List<FolderTreeNode>();

        void Traverse(List<FolderTreeNode> nodes)
        {
            foreach (var node in nodes)
            {
                if (excludeId.HasValue && node.Folder.Id == excludeId.Value)
                {
                    continue; // Skip excluded folder and its children
                }

                result.Add(node);
                Traverse(node.Children);
            }
        }

        Traverse(tree);
        return result;
    }

    /// <summary>
    /// Check if a folder can have subfolders (not at max depth).
    /// </summary>
    /// <param name="folderId">The folder ID to check.</param>
    /// <param name="folders">Flat array of all folders.</param>
    /// <returns>True if folder can have children, false otherwise.</returns>
    public static bool CanHaveSubfolders(Guid folderId, IEnumerable<Folder> folders)
    {
        var depth = GetFolderDepth(folderId, folders);
        return depth.HasValue && depth.Value < MaxFolderDepth;
    }

    /// <summary>
    /// Get all descendant folder IDs (children, grandchildren, etc.).
    /// </summary>
    /// <param name="folderId">The parent folder ID.</param>
    /// <param name="folders">Flat array of all folders.</param>
    /// <returns>Array of descendant folder IDs.</returns>
    public static List<Guid> GetDescendantFolderIds(Guid folderId, IEnumerable<Folder> folders)
    {
        var descendants = new List<Guid>();
        var folderList = folders.ToList();

        void Traverse(Guid parentId)
        {
            var children = folderList.Where(f => f.ParentFolderId == parentId).ToList();
            foreach (var child in children)
            {
                descendants.Add(child.Id);
                Traverse(child.Id);
            }
        }

        Traverse(folderId);
        return descendants;
    }

    /// <summary>
    /// Get all direct child folder IDs.
    /// </summary>
    /// <param name="parentFolderId">The parent folder ID (null for root).</param>
    /// <param name="folders">Flat array of all folders.</param>
    /// <returns>Array of direct child folder IDs.</returns>
    public static List<Guid> GetDirectChildFolderIds(Guid? parentFolderId, IEnumerable<Folder> folders)
    {
        return folders
            .Where(f => f.ParentFolderId == parentFolderId)
            .Select(f => f.Id)
            .ToList();
    }

    /// <summary>
    /// Sort children of a folder tree node recursively.
    /// </summary>
    private static void SortChildren(List<FolderTreeNode> nodes)
    {
        nodes.Sort((a, b) =>
        {
            // Sort by weight first, then by name (case-insensitive)
            if (a.Folder.Weight != b.Folder.Weight)
            {
                return a.Folder.Weight.CompareTo(b.Folder.Weight);
            }

            return string.Compare(a.Folder.Name, b.Folder.Name, StringComparison.OrdinalIgnoreCase);
        });

        foreach (var node in nodes)
        {
            SortChildren(node.Children);
        }
    }
}
