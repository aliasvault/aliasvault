//-----------------------------------------------------------------------
// <copyright file="FolderTreeNode.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

using AliasClientDb;

/// <summary>
/// Folder tree node with hierarchical structure.
/// </summary>
public class FolderTreeNode
{
    /// <summary>
    /// Gets or sets the folder entity.
    /// </summary>
    public required Folder Folder { get; set; }

    /// <summary>
    /// Gets or sets the child folder nodes.
    /// </summary>
    public List<FolderTreeNode> Children { get; set; } = new();

    /// <summary>
    /// Gets or sets the depth of this folder in the hierarchy (0 = root).
    /// </summary>
    public int Depth { get; set; }

    /// <summary>
    /// Gets or sets the array of folder IDs from root to this folder.
    /// </summary>
    public List<Guid> Path { get; set; } = new();

    /// <summary>
    /// Gets the folder name with indentation based on depth.
    /// </summary>
    public string IndentedName => new string(' ', Depth * 2) + Folder.Name;
}
