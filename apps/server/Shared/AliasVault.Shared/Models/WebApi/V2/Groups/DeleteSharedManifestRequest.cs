//-----------------------------------------------------------------------
// <copyright file="DeleteSharedManifestRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Request for POST /v2/Groups/{groupId}/manifests/{manifestId}/delete/confirm.
/// </summary>
public class DeleteSharedManifestRequest
{
    /// <summary>Gets or sets the client's public ephemeral of the SRP handshake started by the initiate endpoint.</summary>
    public required string ClientPublicEphemeral { get; set; }

    /// <summary>Gets or sets the client's SRP session proof.</summary>
    public required string ClientSessionProof { get; set; }
}
