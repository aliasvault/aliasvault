//-----------------------------------------------------------------------
// <copyright file="Manifest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A single vault manifest as carried in list-based payloads. A user's logical vault is assembled from one or more
/// manifests: exactly one root manifest plus (from R2) any number of non-root manifests the user owns or has been
/// granted access to. Each manifest is independently encrypted and revisioned, and carries its own blob references.
/// </summary>
public class Manifest
{
    /// <summary>Gets or sets the stable identifier of the logical manifest (constant across its revisions).</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this is the user's root manifest: the residual container that holds
    /// everything not carved out into another manifest. Sharing status is not encoded here — it is tracked
    /// separately (R2 access table); a non-root manifest is not necessarily shared.
    /// </summary>
    public required bool IsRoot { get; set; }

    /// <summary>Gets or sets the encrypted manifest blob (base64 of AES-GCM ciphertext) — null on empty vault.</summary>
    public string? Blob { get; set; }

    /// <summary>Gets or sets the SHA-256 (hex) of the manifest ciphertext for client-side storage-integrity check.</summary>
    public string? CiphertextHash { get; set; }

    /// <summary>Gets or sets the manifest revision number.</summary>
    public required long Revision { get; set; }

    /// <summary>Gets or sets the blob references this manifest revision needs (so the client can detect cache misses).</summary>
    public List<BlobReference> BlobReferences { get; set; } = [];

    /// <summary>Gets or sets the plaintext display name of a shared-folder manifest. Null for the root manifest.</summary>
    public string? Name { get; set; }

    /// <summary>Gets or sets the username of the manifest owner. Set only on manifests granted to the caller by another user.</summary>
    public string? OwnerUsername { get; set; }

    /// <summary>
    /// Gets or sets the manifest VEK wrapped with the caller's public key. Set only on manifests granted to the
    /// caller by another user; the caller unwraps it with their private key. Null on manifests the caller owns
    /// (the owner keeps their own copy of the folder VEK inside their root vault).
    /// </summary>
    public string? WrappedVek { get; set; }

    /// <summary>Gets or sets the wrap scheme of <see cref="WrappedVek"/> (e.g. "rsa-oaep"). Null when <see cref="WrappedVek"/> is null.</summary>
    public string? WrapScheme { get; set; }
}
