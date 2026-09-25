//-----------------------------------------------------------------------
// <copyright file="IVaultRevision.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

/// <summary>
/// A single revision of a versioned vault storage entity (manifest or data bucket). Exposes the revision metadata
/// that retention rules operate on, so one retention implementation can prune the history of any revisioned table.
/// </summary>
public interface IVaultRevision
{
    /// <summary>
    /// Gets the revision number, incremented on every write.
    /// </summary>
    long RevisionNumber { get; }

    /// <summary>
    /// Gets the timestamp at which this revision was last updated.
    /// </summary>
    DateTime UpdatedAt { get; }
}
