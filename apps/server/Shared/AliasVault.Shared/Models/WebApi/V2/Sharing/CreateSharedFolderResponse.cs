//-----------------------------------------------------------------------
// <copyright file="CreateSharedFolderResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// Response for POST /v2/Sharing/folders. Identifies the newly created shared folder manifest.
/// </summary>
public class CreateSharedFolderResponse
{
    /// <summary>Gets or sets the id of the created manifest (used to grant/revoke access and to sync the folder).</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the manifest's initial revision number.</summary>
    public required long RevisionNumber { get; set; }
}
