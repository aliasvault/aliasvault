//-----------------------------------------------------------------------
// <copyright file="BlobCategoryStatistics.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Count and encrypted size of the blobs in one category.
/// </summary>
public class BlobCategoryStatistics
{
    /// <summary>Gets or sets the blob category (e.g. "favicon" or "attachment").</summary>
    public required string Category { get; set; }

    /// <summary>Gets or sets the number of blobs.</summary>
    public int Count { get; set; }

    /// <summary>Gets or sets the total encrypted size in bytes.</summary>
    public long Bytes { get; set; }
}
