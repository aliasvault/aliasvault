//-----------------------------------------------------------------------
// <copyright file="RevokeAccessRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// Request for POST /v2/Sharing/revoke. Removes a recipient's access to a shared folder manifest the caller owns.
/// </summary>
public class RevokeAccessRequest
{
    /// <summary>Gets or sets the shared folder manifest to revoke access from (must be owned by the caller).</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the recipient user id whose grant is removed.</summary>
    public required string RecipientUserId { get; set; }
}
