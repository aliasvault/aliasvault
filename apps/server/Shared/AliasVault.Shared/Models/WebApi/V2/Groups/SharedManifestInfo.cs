//-----------------------------------------------------------------------
// <copyright file="SharedManifestInfo.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// One shared manifest owned by a group. A group holds any number of these, each with its own key and its own set of
/// members that were given access to it.
/// </summary>
public class SharedManifestInfo
{
    /// <summary>Gets or sets the manifest id.</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the members holding a grant on this manifest, i.e. the ones who can open it.</summary>
    public List<string> MemberUserIds { get; set; } = [];

    /// <summary>Gets or sets the offers of access to this manifest still awaiting an answer (filled for admins only).</summary>
    public List<SentManifestInvitation> PendingInvitations { get; set; } = [];
}
