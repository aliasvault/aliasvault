//-----------------------------------------------------------------------
// <copyright file="PullKind.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// What a pull turned out to be.
/// </summary>
public enum PullKind
{
    /// <summary>
    /// A manifest-v1 snapshot, materialized into a local SQLite database.
    /// </summary>
    Materialized,

    /// <summary>
    /// The personal manifest exists but was never written; the client creates the vault.
    /// </summary>
    Empty,

    /// <summary>
    /// The account is still on the legacy sqlite-blob storage format; the encrypted blob is passed through.
    /// </summary>
    LegacySqliteBlob,
}
