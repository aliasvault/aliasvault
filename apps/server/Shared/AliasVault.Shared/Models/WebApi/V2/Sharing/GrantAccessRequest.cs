//-----------------------------------------------------------------------
// <copyright file="GrantAccessRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// Request for POST /v2/Sharing/grant. Grants a recipient access to a shared folder manifest the caller owns, by
/// persisting the folder's VEK encrypted with the recipient's public key. The server never sees the plaintext VEK.
/// </summary>
public class GrantAccessRequest
{
    /// <summary>Gets or sets the shared folder manifest to grant access to (must be owned by the caller).</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the recipient user id (from GET /v2/Sharing/recipient).</summary>
    public required string RecipientUserId { get; set; }

    /// <summary>Gets or sets the folder VEK encrypted with the recipient's public key (base64), decryptable only by the recipient.</summary>
    public required string EncryptedVek { get; set; }

    /// <summary>Gets or sets the id of the recipient public key used to encrypt (from GET /v2/Sharing/recipient).</summary>
    public required Guid RecipientPublicKeyId { get; set; }

    /// <summary>Gets or sets the assymetric algorithm used..</summary>
    public required string Algorithm { get; set; }
}
