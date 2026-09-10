//-----------------------------------------------------------------------
// <copyright file="PullAndMergeResult.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

using Microsoft.Data.Sqlite;

/// <summary>
/// What a pull-and-merge turned out to be.
/// </summary>
public enum PullAndMergeKind
{
    /// <summary>
    /// The local vault was merged onto the server vault; <see cref="PullAndMergeResult.Database"/> holds the result.
    /// </summary>
    Merged,

    /// <summary>
    /// The server holds nothing to merge with (still the legacy sqlite-blob format, or a never-written manifest);
    /// the local vault is pushed over it whole.
    /// </summary>
    NothingToMergeWith,
}

/// <summary>
/// Result of a pull-and-merge.
/// </summary>
public sealed class PullAndMergeResult
{
    /// <summary>
    /// Gets what the pull-and-merge produced.
    /// </summary>
    public required PullAndMergeKind Kind { get; init; }

    /// <summary>
    /// Gets the merged in-memory database. Set only for <see cref="PullAndMergeKind.Merged"/>; the caller owns it.
    /// </summary>
    public SqliteConnection? Database { get; init; }

    /// <summary>
    /// Gets the manifests whose local changes were dropped because the merged result failed validation.
    /// </summary>
    public List<Guid> FallbackManifestIds { get; init; } = [];

    /// <summary>
    /// Gets the local manifests the server no longer serves; their rows are gone from the merged vault.
    /// </summary>
    public List<Guid> DroppedLocalManifestIds { get; init; } = [];
}
