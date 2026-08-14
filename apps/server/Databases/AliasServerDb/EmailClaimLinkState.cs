//-----------------------------------------------------------------------
// <copyright file="EmailClaimLinkState.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// What a manifest's link to an email claim says about the alias right now.
/// <para>
/// The claim link row itself is permanent: it is the record of which manifests have ever held the address, which is what
/// lets a manifest reclaim an alias it dropped and what stops another account from taking the address over.
/// </para>
/// </summary>
public enum EmailClaimLinkState
{
    /// <summary>
    /// The manifest carries the alias and wants its mail: incoming mail is wrapped for this manifest's delivery key.
    /// </summary>
    Active = 0,

    /// <summary>
    /// The manifest carries the alias but the user switched it off. Mail already received stays readable.
    /// New mail is not wrapped for this manifest. Re-enabling is possible by setting the state to 'Active'.
    /// </summary>
    Paused = 1,

    /// <summary>
    /// The manifest no longer carries the alias: the item holding it is gone from that vault, or a revoke severed the
    /// tie. No mail is wrapped for it, so the row survives purely as the ownership record.
    /// </summary>
    Removed = 2,
}
