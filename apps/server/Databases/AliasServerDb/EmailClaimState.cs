//-----------------------------------------------------------------------
// <copyright file="EmailClaimState.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// What the owning manifest of an email claim says about the alias right now.
/// </summary>
public enum EmailClaimState
{
    /// <summary>
    /// The manifest carries the alias and wants its mail: incoming mail is wrapped for this manifest's delivery key.
    /// </summary>
    Active = 0,

    /// <summary>
    /// The manifest carries the alias but the user switched it off. Mail already received stays readable.
    /// New mail is not accepted. Re-enabling is possible by setting the state to 'Active'.
    /// </summary>
    Paused = 1,

    /// <summary>
    /// The manifest no longer carries the alias. No mail is accepted; the row survives as the ownership record, so only
    /// the owning manifest can claim the address back.
    /// </summary>
    Removed = 2,
}
