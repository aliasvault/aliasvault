//-----------------------------------------------------------------------
// <copyright file="Bucket.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A single data bucket as carried in list-based payloads.
/// </summary>
public class Bucket
{
    /// <summary>Gets or sets the bucket kind discriminator.</summary>
    public required VaultDataBucketCategory Category { get; set; }

    /// <summary>Gets or sets the encrypted bucket blob (base64 of AES-GCM ciphertext).</summary>
    public required string Blob { get; set; }

    /// <summary>Gets or sets the SHA-256 (hex) of the ciphertext for client-side storage-integrity check.</summary>
    public string? CiphertextHash { get; set; }

    /// <summary>Gets or sets the revision number. Server-assigned: populated on GET, ignored on bundled upload.</summary>
    public long Revision { get; set; }
}
