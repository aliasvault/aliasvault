//-----------------------------------------------------------------------
// <copyright file="Bucket.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.Text.Json.Serialization;

/// <summary>
/// A single data bucket as carried in list-based payloads.
/// </summary>
public class Bucket
{
    /// <summary>Gets or sets the id of the manifest that owns this bucket.</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the bucket kind discriminator.</summary>
    public required VaultDataBucketCategory Category { get; set; }

    /// <summary>Gets or sets the length of the bucket ciphertext in the binary response body.</summary>
    public int Size { get; set; }

    /// <summary>Gets or sets the bucket ciphertext (AES-GCM). Sent after the JSON header, not inside it.</summary>
    [JsonIgnore]
    public byte[] Data { get; set; } = [];

    /// <summary>Gets or sets the SHA-256 (hex) of the ciphertext for client-side storage-integrity check.</summary>
    public string? CiphertextHash { get; set; }

    /// <summary>Gets or sets the revision number. Server-assigned: populated on GET, ignored on bundled upload.</summary>
    public long Revision { get; set; }
}
