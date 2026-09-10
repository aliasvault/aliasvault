//-----------------------------------------------------------------------
// <copyright file="PullResult.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

using Microsoft.Data.Sqlite;

/// <summary>
/// Result of a pull.
/// </summary>
public sealed class PullResult
{
    /// <summary>
    /// Gets what the pull produced.
    /// </summary>
    public required PullKind Kind { get; init; }

    /// <summary>
    /// Gets the materialized in-memory database. Set only for <see cref="PullKind.Materialized"/>; the caller owns it.
    /// </summary>
    public SqliteConnection? Database { get; init; }

    /// <summary>
    /// Gets the legacy encrypted SQLite blob. Set only for <see cref="PullKind.LegacySqliteBlob"/>.
    /// </summary>
    public string? LegacyVaultBlob { get; init; }

    /// <summary>
    /// Gets the legacy data-model version string. Set only for <see cref="PullKind.LegacySqliteBlob"/>.
    /// </summary>
    public string? LegacyVersion { get; init; }
}
