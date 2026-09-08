//-----------------------------------------------------------------------
// <copyright file="VaultBlobCategoryUsage.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// Blob object usage of one category (e.g. favicon, attachment) for a single user.
/// </summary>
public sealed class VaultBlobCategoryUsage
{
    /// <summary>
    /// Gets the blob category as the client wrote it.
    /// </summary>
    public string Category { get; init; } = string.Empty;

    /// <summary>
    /// Gets the number of stored blob objects in this category.
    /// </summary>
    public int ObjectCount { get; init; }

    /// <summary>
    /// Gets the total encrypted size of this category in bytes.
    /// </summary>
    public long SizeBytes { get; init; }

    /// <summary>
    /// Gets the number of blob objects in this category that no manifest revision references anymore.
    /// </summary>
    public int UnreferencedCount { get; init; }

    /// <summary>
    /// Gets the total size of the unreferenced blob objects in this category, in bytes.
    /// </summary>
    public long UnreferencedBytes { get; init; }
}
