//-----------------------------------------------------------------------
// <copyright file="CreateSharedFolderRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// Request for POST /v2/Sharing/folders. Creates a new non-root (shareable) manifest owned by the caller. The
/// folder's VEK is generated client-side and wrapped for the caller's *own* public key, persisted as a
/// <c>shared</c> grant in the same call.
/// </summary>
public class CreateSharedFolderRequest
{
    /// <summary>Gets or sets the plaintext display name of the folder (server-visible for the sharing UI).</summary>
    public required string Name { get; set; }

    /// <summary>Gets or sets the encrypted folder manifest blob (AES-GCM ciphertext under the folder VEK, base64).</summary>
    public required string ManifestBlob { get; set; }

    /// <summary>Gets or sets the SHA-256 (hex) of the manifest ciphertext, for storage-layer integrity verification.</summary>
    public string? ManifestCiphertextHash { get; set; }

    /// <summary>Gets or sets the vault data model version string.</summary>
    public required string Version { get; set; }

    /// <summary>Gets or sets the folder VEK wrapped with the caller's own public key (base64), decryptable only by the caller.</summary>
    public required string SelfWrappedVek { get; set; }

    /// <summary>Gets or sets the id of the caller's own public key used to wrap (from GET /v2/Sharing/recipient for their own username).</summary>
    public required Guid SelfPublicKeyId { get; set; }

    /// <summary>Gets or sets the asymmetric wrap scheme used, e.g. "rsa-oaep".</summary>
    public required string WrapScheme { get; set; }
}
