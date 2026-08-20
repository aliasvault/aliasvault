//-----------------------------------------------------------------------
// <copyright file="CreateSharedManifestRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// Request for POST /v2/Sharing/manifests. Creates a new shared (non-personal) manifest filed under a group.
/// </summary>
public class CreateSharedManifestRequest
{
    /// <summary>Gets or sets the client-minted id of the new manifest.</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the plaintext display name of the manifest.</summary>
    public required string Name { get; set; }

    /// <summary>
    /// Gets or sets the shared group to file this manifest under.
    /// </summary>
    public required Guid GroupId { get; set; }

    /// <summary>Gets or sets the encrypted manifest blob (AES-GCM ciphertext under the manifest VEK, base64).</summary>
    public required string ManifestBlob { get; set; }

    /// <summary>Gets or sets the SHA-256 (hex) of the manifest ciphertext, for storage-layer integrity verification.</summary>
    public string? ManifestCiphertextHash { get; set; }

    /// <summary>Gets or sets the manifest VEK encrypted with the caller's own public key (base64), decryptable only by the caller.</summary>
    public required string SelfEncryptedVek { get; set; }

    /// <summary>
    /// Gets or sets the caller's own account public key (JWK) the <see cref="SelfEncryptedVek"/> was encrypted with.
    /// </summary>
    public required string SelfPublicKey { get; set; }

    /// <summary>Gets or sets the asymmetric algorithm the caller's own grant was encrypted with.</summary>
    public required string Algorithm { get; set; }
}
