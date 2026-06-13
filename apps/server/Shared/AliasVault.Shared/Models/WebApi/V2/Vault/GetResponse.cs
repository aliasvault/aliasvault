//-----------------------------------------------------------------------
// <copyright file="GetResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using AliasVault.Shared.Models.Enums;

/// <summary>
/// Atomic snapshot returned by GET /v2/Vault.
/// </summary>
public class GetResponse
{
    /// <summary>Gets or sets the operation status.</summary>
    public required VaultStatus Status { get; set; }

    /// <summary>
    /// Gets or sets the storage format of the returned vault.
    /// </summary>
    public StorageFormat StorageFormat { get; set; } = StorageFormat.Manifest;

    /// <summary>Gets or sets the legacy encrypted SQLite blob (base64). Set only when StorageFormat = SqliteBlob.</summary>
    public string? LegacyVaultBlob { get; set; }

    /// <summary>Gets or sets the data-model version string of the returned vault (legacy version for sqlite-blob).</summary>
    public string? Version { get; set; }

    /// <summary>Gets or sets the encrypted manifest blob (base64 of AES-GCM ciphertext) — null on empty vault.</summary>
    public string? ManifestBlob { get; set; }

    /// <summary>Gets or sets the SHA-256 (hex) of the manifest ciphertext for client-side storage-integrity check.</summary>
    public string? ManifestCiphertextHash { get; set; }

    /// <summary>Gets or sets the manifest revision number.</summary>
    public long? ManifestRevision { get; set; }

    /// <summary>Gets or sets the data buckets (e.g. settings) for this user — each with its own kind + revision.</summary>
    public List<Bucket> Buckets { get; set; } = [];

    /// <summary>Gets or sets the list of blob references the manifest needs (so the client can detect cache misses).</summary>
    public List<BlobReference> BlobReferences { get; set; } = [];

    /// <summary>Gets or sets the plaintext email routing data (private/public domains + claimed addresses).</summary>
    public EmailRouting EmailRouting { get; set; } = new();
}
