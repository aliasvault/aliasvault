//-----------------------------------------------------------------------
// <copyright file="VaultRetentionManager.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Vault;

using System;
using System.Collections.Generic;
using System.Linq;
using AliasServerDb;

/// <summary>
/// History manager for revisioned vault storage entities (manifests, data buckets) that applies retention rules to
/// determine how many superseded revisions to keep as backups and returns the history revisions that should be deleted.
/// </summary>
public static class VaultRetentionManager
{
    /// <summary>
    /// Applies retention policies to the superseded (history) revisions of a revisioned entity. The current revision
    /// can be passed in so the rules see the full revision timeline, but it is never eligible for deletion — only
    /// history revisions are returned.
    /// </summary>
    /// <typeparam name="THistory">The history row type of the entity (e.g. <see cref="VaultManifestsHistory"/> or <see cref="VaultDataBucketsHistory"/>).</typeparam>
    /// <param name="retentionPolicy">List of retention policies to apply.</param>
    /// <param name="historyRevisions">Superseded revisions of the entity (including the one just archived).</param>
    /// <param name="now">DateTime which represents current time.</param>
    /// <param name="currentRevision">The current revision of the entity, taken into account by the rules but always kept.</param>
    /// <returns>List of history revisions to delete according to the retention policies.</returns>
    public static List<THistory> ApplyRetention<THistory>(RetentionPolicy retentionPolicy, List<THistory> historyRevisions, DateTime now, IVaultRevision? currentRevision = null)
        where THistory : class, IVaultRevision
    {
        var allRevisions = new List<IVaultRevision>(historyRevisions);
        if (currentRevision is not null)
        {
            allRevisions.Add(currentRevision);
        }

        // Sort revisions by UpdatedAt in descending order.
        allRevisions = allRevisions.OrderByDescending(v => v.UpdatedAt).ToList();

        var revisionsToKeep = new HashSet<IVaultRevision>();

        // Process retention rules.
        foreach (var rule in retentionPolicy.Rules)
        {
            foreach (var revision in rule.ApplyRule(allRevisions, now))
            {
                revisionsToKeep.Add(revision);
            }
        }

        // Always keep the most recent revision.
        if (allRevisions.Count > 0)
        {
            revisionsToKeep.Add(allRevisions[0]);
        }

        // Only history revisions are deletable; the current revision is always kept implicitly.
        return allRevisions.Except(revisionsToKeep).OfType<THistory>().ToList();
    }
}
