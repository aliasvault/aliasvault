//-----------------------------------------------------------------------
// <copyright file="ClientActionType.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// The kinds of work a <see cref="ClientAction"/> can ask a client to carry out.
/// </summary>
public enum ClientActionType
{
    /// <summary>
    /// The delivery keypair of a shared manifest has to be replaced, because a user who previously had access to
    /// its private half was removed from the owning group. Note: this is different from access to mail, as a user that
    /// is not part of a group anymore won't be able to fetch mail of the group's owned email aliases.
    /// </summary>
    RotateManifestDeliveryKey = 0,
}
