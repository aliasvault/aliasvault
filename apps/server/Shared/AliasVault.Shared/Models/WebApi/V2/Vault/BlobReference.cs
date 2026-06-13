//-----------------------------------------------------------------------
// <copyright file="BlobReference.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A reference to a content-addressed blob held in VaultBlobObjects.
/// </summary>
public class BlobReference
{
    /// <summary>Gets or sets the per-user salted SHA-256 hex of the plaintext.</summary>
    public required string Hash { get; set; }

    /// <summary>Gets or sets the blob category (e.g. "favicon" or "attachment").</summary>
    public required string Category { get; set; }
}
