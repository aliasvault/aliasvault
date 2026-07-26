//-----------------------------------------------------------------------
// <copyright file="VaultDataBucket.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations.Schema;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// The current revision of a small, independently-syncable user-scoped data bucket. Each bucket holds one kind of
/// data that we deliberately keep out of the main vault content manifest so it can sync separately and faster.
/// </summary>
public class VaultDataBucket : VaultDataBucketBase
{
    /// <summary>
    /// Gets or sets the user ID foreign key. Part of the composite primary key (OwnerUserId, Category).
    /// </summary>
    public string OwnerUserId { get; set; } = null!;

    /// <summary>
    /// Gets or sets the navigation property to the user.
    /// </summary>
    [ForeignKey("OwnerUserId")]
    public virtual AliasVaultUser User { get; set; } = null!;

    /// <summary>
    /// Gets or sets the bucket category/kind (e.g. Settings). Part of the composite primary key.
    /// </summary>
    public required VaultDataBucketCategory Category { get; set; }
}
