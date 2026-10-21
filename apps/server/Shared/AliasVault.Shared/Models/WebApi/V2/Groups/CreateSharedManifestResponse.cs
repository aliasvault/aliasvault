//-----------------------------------------------------------------------
// <copyright file="CreateSharedManifestResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Response for POST /v2/Groups/manifests. Identifies the newly created shared manifest and the group it is shared in.
/// </summary>
public class CreateSharedManifestResponse
{
    /// <summary>Gets or sets the id of the group created for the shared manifest.</summary>
    public required Guid GroupId { get; set; }

    /// <summary>Gets or sets the id of the created manifest (used to grant/revoke access and to sync it).</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the manifest's initial revision number.</summary>
    public required long RevisionNumber { get; set; }
}
