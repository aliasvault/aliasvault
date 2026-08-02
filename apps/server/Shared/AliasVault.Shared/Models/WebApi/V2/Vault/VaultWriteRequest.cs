//-----------------------------------------------------------------------
// <copyright file="VaultWriteRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Unified atomic write for POST /v2/Vault.
/// </summary>
public class VaultWriteRequest
{
    /// <summary>Gets or sets the username.</summary>
    public required string Username { get; set; }

    /// <summary>Gets or sets the manifests to write.</summary>
    public List<ManifestWrite> Manifests { get; set; } = [];

    /// <summary>Gets or sets the data buckets to upsert.</summary>
    public List<BucketWrite> Buckets { get; set; } = [];

    /// <summary>Gets or sets the new blob objects the client is uploading for this write.</summary>
    public List<Blob> NewBlobs { get; set; } = [];

    /// <summary>Gets or sets the email routing data to update server-side.</summary>
    public EmailRouting? EmailRouting { get; set; }

    /// <summary>
    /// Gets or sets the user's public encryption key.
    /// </summary>
    public string? UserEncryptionPublicKey { get; set; }

    /// <summary>
    /// Gets or sets the shared manifests' public encryption keys.
    /// </summary>
    public List<SharedManifestEncryptionPublicKey> SharedManifestEncryptionPublicKeys { get; set; } = [];

    /// <summary>
    /// Gets or sets the encrypted Account Key and KEK derivation parameters for the given unlock method.
    /// </summary>
    public AccountKeysUpload? AccountKeys { get; set; }
}
