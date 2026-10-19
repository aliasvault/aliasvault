//-----------------------------------------------------------------------
// <copyright file="BlobKeyRewrap.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.KeyRotation;

using System.ComponentModel.DataAnnotations;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// One blob's key, encrypted with the new VEK.
/// </summary>
public class BlobKeyRewrap
{
    /// <summary>
    /// Gets or sets the blob hash.
    /// </summary>
    [RegularExpression(VaultWriteLimits.HashPattern)]
    public required string Hash { get; set; }

    /// <summary>
    /// Gets or sets the blob key encrypted with the new VEK.
    /// </summary>
    [StringLength(255)]
    public required string EncryptedBlobKey { get; set; }
}
