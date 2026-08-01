//-----------------------------------------------------------------------
// <copyright file="ManifestKeyType.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// What encrypts a <see cref="VaultManifestAccessKey"/> row's VEK.
/// </summary>
public enum ManifestKeyType
{
    /// <summary>
    /// The user's own root-manifest VEK, encrypted by their Account Key (see <see cref="UserUnlockKey"/>).
    /// </summary>
    AccountKey = 1,

    /// <summary>
    /// A grant: the VEK is encrypted to the user's grant key (see <see cref="UserGrantKey"/>), so only
    /// its holder's private half can decrypt it.
    /// </summary>
    GrantKey = 2,
}
