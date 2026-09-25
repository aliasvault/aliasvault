//-----------------------------------------------------------------------
// <copyright file="RevisionRetentionRule.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Vault.RetentionRules;

using AliasServerDb;

/// <summary>
/// Revision retention rule that keeps the latest X unique revisions.
/// </summary>
public class RevisionRetentionRule : IRetentionRule
{
    /// <summary>
    /// Gets the amount of revisions to keep.
    /// </summary>
    public int RevisionsToKeep { get; init; }

   /// <inheritdoc cref="IRetentionRule.ApplyRule"/>
    public IEnumerable<IVaultRevision> ApplyRule(List<IVaultRevision> revisions, DateTime now)
    {
        // For the specified amount of revisions, take the last one per revision number.
        return revisions
            .GroupBy(x => x.RevisionNumber)
            .Select(g => g.OrderByDescending(x => x.UpdatedAt).First())
            .OrderByDescending(x => x.UpdatedAt)
            .Take(RevisionsToKeep);
    }
}
