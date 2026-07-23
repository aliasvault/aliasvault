//-----------------------------------------------------------------------
// <copyright file="UpdateSharedFolderResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

using AliasVault.Shared.Models.Enums;

/// <summary>
/// Response for POST /v2/Sharing/folders/{manifestId}.
/// </summary>
public class UpdateSharedFolderResponse
{
    /// <summary>Gets or sets the outcome: Ok when stored, Outdated when the client's revision is stale (re-pull and merge).</summary>
    public required VaultStatus Status { get; set; }

    /// <summary>Gets or sets the manifest's current server revision after this call.</summary>
    public required long NewRevisionNumber { get; set; }
}
