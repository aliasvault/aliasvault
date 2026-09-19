//-----------------------------------------------------------------------
// <copyright file="UpdateSharedManifestRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Request for POST /v2/Groups/{groupId}/manifests/{manifestId}: change the details of one of the group's shared
/// manifests. A detail that is left out stays as it is.
/// </summary>
public class UpdateSharedManifestRequest
{
    /// <summary>Gets or sets the new name of the manifest, encrypted with the manifest's own key (base64).</summary>
    [StringLength(2000, MinimumLength = 1)]
    public string? EncryptedName { get; set; }
}
