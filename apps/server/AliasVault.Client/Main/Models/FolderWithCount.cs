//-----------------------------------------------------------------------
// <copyright file="FolderWithCount.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

using System;

/// <summary>
/// Folder model with item count for display in lists.
/// </summary>
public sealed class FolderWithCount
{
    /// <summary>
    /// Gets or sets the folder ID.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the folder name.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the parent folder ID (null for root folders).
    /// </summary>
    public Guid? ParentFolderId { get; set; }

    /// <summary>
    /// Gets or sets the folder weight for sorting.
    /// </summary>
    public int Weight { get; set; }

    /// <summary>
    /// Gets or sets the number of items in this folder (including subfolders recursively).
    /// </summary>
    public int ItemCount { get; set; }
}
