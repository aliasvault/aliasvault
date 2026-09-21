//-----------------------------------------------------------------------
// <copyright file="Blob.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Single encrypted blob payload.
/// </summary>
public class Blob
{
    /// <summary>Gets or sets the per-manifest salted SHA-256 hex of the plaintext.</summary>
    public required string Hash { get; set; }

    /// <summary>Gets or sets the blob category ("favicon" or "attachment").</summary>
    public required string Category { get; set; }

    /// <summary>Gets or sets the bytes encrypted with the blob's own key, base64-encoded for transport.</summary>
    public required string EncryptedDataBase64 { get; set; }

    /// <summary>Gets or sets the blob's own key, encrypted with the manifest's VEK.</summary>
    [StringLength(255, MinimumLength = 1)]
    public required string EncryptedBlobKey { get; set; }
}
