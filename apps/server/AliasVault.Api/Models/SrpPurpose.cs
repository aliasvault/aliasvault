//-----------------------------------------------------------------------
// <copyright file="SrpPurpose.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Models;

/// <summary>
/// The flow an SRP exchange belongs to; each flow keeps its own server ephemeral so one cannot overwrite another.
/// </summary>
public enum SrpPurpose
{
    /// <summary>
    /// Login, including the 2FA and recovery code steps that re-check the same proof.
    /// </summary>
    Login,

    /// <summary>
    /// Password change.
    /// </summary>
    PasswordChange,

    /// <summary>
    /// Account deletion.
    /// </summary>
    AccountDeletion,

    /// <summary>
    /// Deletion of a shared manifest.
    /// </summary>
    SharedManifestDeletion,

    /// <summary>
    /// Password change that also rotates the account's encryption keys.
    /// </summary>
    KeyRotation,

    /// <summary>
    /// An admin taking a member's access to a shared manifest away.
    /// </summary>
    SharedManifestAccessRevocation,

    /// <summary>
    /// An admin removing a member from a shared group.
    /// </summary>
    GroupMemberRemoval,

    /// <summary>
    /// A member giving up their own access to a shared manifest.
    /// </summary>
    SharedManifestLeave,

    /// <summary>
    /// A member leaving a shared group.
    /// </summary>
    GroupLeave,

    /// <summary>
    /// Raising the key derivation settings of the password to the current defaults, which happens automatically during login (if applicable).
    /// </summary>
    KeyDerivationUpgrade,
}
