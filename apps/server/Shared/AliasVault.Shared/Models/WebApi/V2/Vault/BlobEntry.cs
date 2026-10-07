//-----------------------------------------------------------------------
// <copyright file="BlobEntry.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

/// <summary>
/// A single encrypted blob of a blob upload or download.
/// </summary>
public class BlobEntry : IFramePart
{
    /// <summary>Gets or sets the per-manifest salted SHA-256 hex of the plaintext.</summary>
    [RegularExpression(VaultWriteLimits.HashPattern)]
    public required string Hash { get; set; }

    /// <summary>Gets or sets the blob category ("favicon" or "attachment").</summary>
    [StringLength(VaultWriteLimits.MaxCategoryLength, MinimumLength = 1)]
    public required string Category { get; set; }

    /// <summary>Gets or sets the blob's own key, encrypted with the manifest's VEK.</summary>
    [StringLength(255, MinimumLength = 1)]
    public required string EncryptedBlobKey { get; set; }

    /// <inheritdoc/>
    public int Offset { get; set; }

    /// <inheritdoc/>
    public int Size { get; set; }

    /// <summary>Gets or sets the bytes encrypted with the blob's own key. Sent after the JSON header, not inside it.</summary>
    [JsonIgnore]
    public byte[] Data { get; set; } = [];
}
