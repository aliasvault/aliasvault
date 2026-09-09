//-----------------------------------------------------------------------
// <copyright file="VaultSyncState.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync;

using AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// The client's sync state as adopted from the last pull.
/// </summary>
public sealed class VaultSyncState
{
    /// <summary>
    /// Gets or sets the id of the user's personal manifest, as reported by the server.
    /// </summary>
    public Guid? PersonalManifestId { get; set; }

    /// <summary>
    /// Gets or sets the personal manifest's blob-hashing salt.
    /// </summary>
    public string? PersonalManifestSalt { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the last snapshot was still on the legacy sqlite-blob storage format.
    /// </summary>
    public bool LastSnapshotWasLegacySqliteBlob { get; set; }

    /// <summary>
    /// Gets the last-known server revision per manifest.
    /// </summary>
    public Dictionary<Guid, long> ManifestRevisions { get; } = [];

    /// <summary>
    /// Gets the last-known server revision per data bucket, keyed by <see cref="BucketRevisionKey"/>.
    /// </summary>
    public Dictionary<string, long> BucketRevisions { get; } = new(StringComparer.Ordinal);

    /// <summary>
    /// Gets the content fingerprints of every manifest and bucket as last served or pushed, keyed by
    /// <see cref="ManifestFingerprintKey"/> and <see cref="BucketFingerprintKey"/>.
    /// </summary>
    public Dictionary<string, string> ContentFingerprints { get; } = new(StringComparer.Ordinal);

    /// <summary>
    /// Gets the blob hashes the server is known to hold.
    /// </summary>
    public HashSet<string> ServerBlobHashes { get; } = new(StringComparer.Ordinal);

    /// <summary>
    /// Gets the encrypted blob cache (hash to base64 ciphertext), pruned to the referenced set on every pull.
    /// </summary>
    public Dictionary<string, string> BlobCipherCache { get; } = new(StringComparer.Ordinal);

    /// <summary>
    /// Gets the shared manifests this session holds a grant on, keyed by manifest id.
    /// </summary>
    public Dictionary<Guid, SharedManifestRecord> SharedManifests { get; } = [];

    /// <summary>
    /// Gets the manifest ids the last snapshot carried, recorded before any of them is opened.
    /// </summary>
    public List<Guid> LastServedManifestIds { get; } = [];

    /// <summary>
    /// The key of one data bucket's revision.
    /// </summary>
    /// <param name="manifestId">The manifest that owns the bucket.</param>
    /// <param name="category">The bucket category.</param>
    /// <returns>The record key.</returns>
    public static string BucketRevisionKey(Guid manifestId, string category) => $"{manifestId}:{category}";

    /// <summary>
    /// The fingerprint record key of a manifest.
    /// </summary>
    /// <param name="manifestId">The manifest id.</param>
    /// <returns>The record key.</returns>
    public static string ManifestFingerprintKey(Guid manifestId) => $"manifest:{manifestId}";

    /// <summary>
    /// The fingerprint record key of a data bucket.
    /// </summary>
    /// <param name="manifestId">The manifest that owns the bucket.</param>
    /// <param name="category">The bucket category.</param>
    /// <returns>The record key.</returns>
    public static string BucketFingerprintKey(Guid manifestId, string category) => $"bucket:{manifestId}:{category}";

    /// <summary>
    /// Forgets everything; the next pull rebuilds it.
    /// </summary>
    public void Clear()
    {
        PersonalManifestId = null;
        PersonalManifestSalt = null;
        LastSnapshotWasLegacySqliteBlob = false;
        ManifestRevisions.Clear();
        BucketRevisions.Clear();
        ContentFingerprints.Clear();
        ServerBlobHashes.Clear();
        BlobCipherCache.Clear();
        SharedManifests.Clear();
        LastServedManifestIds.Clear();
    }
}
