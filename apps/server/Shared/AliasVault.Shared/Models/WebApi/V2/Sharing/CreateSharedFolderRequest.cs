//-----------------------------------------------------------------------
// <copyright file="CreateSharedFolderRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// Request for POST /v2/Sharing/folders. Creates a new non-root (shareable) manifest owned by the caller. The
/// folder's VEK is generated and kept client-side (wrapped into the owner's own vault); the server only stores the
/// encrypted folder manifest. Access is granted to other users afterwards via POST /v2/Sharing/grant.
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
}
