//-----------------------------------------------------------------------
// <copyright file="BucketWrite.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.Text.Json.Serialization;

/// <summary>
/// A single data bucket to write within a <see cref="VaultWriteRequest"/> batch. Carries the client's believed-current
/// revision so the bucket participates in the same optimistic all-or-nothing gate as the manifests.
/// </summary>
public class BucketWrite : IFramePart
{
    /// <summary>Gets or sets the id of the manifest that owns this bucket. The caller must have write access to it.</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the bucket kind discriminator.</summary>
    public required VaultDataBucketCategory Category { get; set; }

    /// <summary>Gets or sets the length of the bucket ciphertext in the frame.</summary>
    public int Size { get; set; }

    /// <summary>Gets or sets the bucket ciphertext (AES-GCM). Sent after the JSON header, not inside it.</summary>
    [JsonIgnore]
    public byte[] Data { get; set; } = [];

    /// <summary>Gets or sets the SHA-256 (hex) of the bucket ciphertext.</summary>
    public required string CiphertextHash { get; set; }

    /// <summary>Gets or sets the revision the client believes is current for this bucket kind; the new revision must be exactly one above it.</summary>
    public required long CurrentRevision { get; set; }
}
