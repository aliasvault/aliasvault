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
}
