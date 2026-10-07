//-----------------------------------------------------------------------
// <copyright file="GetResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.Text.Json.Serialization;

/// <summary>
/// Atomic snapshot returned by GET /v2/Vault, as the JSON header of a binary frame (see <see cref="IFrameBody"/>).
/// </summary>
public class GetResponse : IFrameBody
{
    /// <summary>
    /// Gets or sets the storage format of the returned vault.
    /// </summary>
    public StorageFormat StorageFormat { get; set; } = StorageFormat.Manifest;

    /// <summary>Gets or sets the legacy encrypted SQLite blob (base64). Set only when StorageFormat = SqliteBlob.</summary>
    public string? LegacyVaultBlob { get; set; }

    /// <summary>Gets or sets the data-model version string of the returned vault (legacy version for sqlite-blob).</summary>
    public string? Version { get; set; }

    /// <summary>Gets or sets the legacy sqlite-blob revision number. Set only when StorageFormat = SqliteBlob.</summary>
    public long? LegacyRevision { get; set; }

    /// <summary>
    /// Gets or sets the caller's personal manifest id: the single manifest owned by their personal group. Every other
    /// entry in <see cref="Manifests"/> is a shared one. Also set on the legacy sqlite-blob path, where the list is empty.
    /// </summary>
    public Guid? PersonalManifestId { get; set; }

    /// <summary>
    /// Gets or sets the manifests that make up the user's logical vault. Empty for legacy sqlite-blobs.
    /// </summary>
    public List<Manifest> Manifests { get; set; } = [];

    /// <summary>Gets or sets the data buckets (e.g. settings) for this user, each with its own kind + revision.</summary>
    public List<Bucket> Buckets { get; set; } = [];

    /// <inheritdoc/>
    [JsonIgnore]
    public IEnumerable<IFramePart> FrameParts => Manifests.Cast<IFramePart>().Concat(Buckets);
}
