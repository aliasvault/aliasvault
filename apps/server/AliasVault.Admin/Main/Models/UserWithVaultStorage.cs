//-----------------------------------------------------------------------
// <copyright file="UserWithVaultStorage.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

using AliasServerDb;

/// <summary>
/// A user together with the server-side storage their personal vault occupies.
/// </summary>
public sealed class UserWithVaultStorage
{
    /// <summary>
    /// Gets the user.
    /// </summary>
    public AliasVaultUser User { get; init; } = null!;

    /// <summary>
    /// Gets the kilobytes occupied by the user's personal vault: every manifest, bucket and blob revision it owns.
    /// </summary>
    public long VaultStorageKb { get; init; }
}
