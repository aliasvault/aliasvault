//-----------------------------------------------------------------------
// <copyright file="CreateSharedManifestRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Request for POST /v2/Groups/{groupId}/manifests: create another shared vault for the group.
/// </summary>
public class CreateSharedManifestRequest
{
    /// <summary>Gets or sets the client-minted id of the new manifest.</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the manifest VEK encrypted with the user's own public key (base64), decryptable only by the user.</summary>
    public required string SelfEncryptedVek { get; set; }

    /// <summary>
    /// Gets or sets the user's own account public key (JWK) the <see cref="SelfEncryptedVek"/> was encrypted with.
    /// </summary>
    public required string SelfPublicKey { get; set; }

    /// <summary>Gets or sets the asymmetric algorithm the caller's own grant was encrypted with.</summary>
    public required string Algorithm { get; set; }
}
