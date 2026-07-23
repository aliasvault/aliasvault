//-----------------------------------------------------------------------
// <copyright file="VaultStatusHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using AliasVault.Shared.Models.WebApi.V2.Vault;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Helpers for building the manifest-revision payload shared between the <c>Status</c> endpoints.
/// </summary>
public static class VaultStatusHelper
{
    private const string ManifestFormat = "manifest-v1";

    /// <summary>
    /// The full manifest-revision list a status endpoint reports: the user's own manifests (all storage formats)
    /// plus every manifest shared with them.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The id of the user to build manifest revisions for.</param>
    /// <returns>The combined owned + shared-with-me manifest revision list.</returns>
    public static async Task<List<ManifestRevision>> GetManifestRevisionsAsync(AliasServerDbContext context, string userId)
    {
        var revisions = await GetOwnedManifestRevisionsAsync(context, userId);
        revisions.AddRange(await GetGrantedManifestRevisionsAsync(context, userId));
        return revisions;
    }

    /// <summary>
    /// Whether the user has migrated to the manifest-v1 storage format.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The id of the user to check migration status for.</param>
    /// <returns>True when the user's own root manifest is in the manifest-v1 format.</returns>
    public static async Task<bool> IsUserMigratedAsync(AliasServerDbContext context, string userId)
    {
        return await context.VaultManifests.AnyAsync(x => x.OwnerUserId == userId && x.IsRoot && x.StorageFormat == ManifestFormat);
    }

    /// <summary>
    /// The revision entries for every manifest owned by <paramref name="userId"/>, across all storage formats.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The id of the user to build owned manifest revisions for.</param>
    /// <returns>The list of owned manifest revisions.</returns>
    private static async Task<List<ManifestRevision>> GetOwnedManifestRevisionsAsync(AliasServerDbContext context, string userId)
    {
        return await context.VaultManifests
            .Where(x => x.OwnerUserId == userId)
            .Select(x => new ManifestRevision { ManifestId = x.ManifestId, IsRoot = x.IsRoot, Revision = x.RevisionNumber })
            .ToListAsync();
    }

    /// <summary>
    /// The revision entries for every manifest another user has shared with <paramref name="userId"/>.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The id of the user to build granted manifest revisions for.</param>
    /// <returns>The list of shared-with-me manifest revisions (empty when the user has no grants).</returns>
    private static async Task<List<ManifestRevision>> GetGrantedManifestRevisionsAsync(AliasServerDbContext context, string userId)
    {
        var grantedManifestIds = await GetGrantedManifestIdsAsync(context, userId);
        if (grantedManifestIds.Count == 0)
        {
            return [];
        }

        return await context.VaultManifests
            .Where(m => grantedManifestIds.Contains(m.ManifestId) && m.StorageFormat == ManifestFormat)
            .Select(m => new ManifestRevision { ManifestId = m.ManifestId, IsRoot = false, Revision = m.RevisionNumber })
            .ToListAsync();
    }

    /// <summary>
    /// The ids of manifests <b>other</b> users have granted to <paramref name="userId"/>.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The id of the user to resolve granted manifest ids for.</param>
    /// <returns>The list of granted manifest ids.</returns>
    private static async Task<List<Guid>> GetGrantedManifestIdsAsync(AliasServerDbContext context, string userId)
    {
        return await context.VaultKeys
            .Where(k => k.UserId == userId && k.KeyType == AuthHelper.VaultKeyTypeShared && k.VaultManifestId != null
                && context.VaultManifests.Any(m => m.ManifestId == k.VaultManifestId && m.OwnerUserId != userId))
            .Select(k => k.VaultManifestId!.Value)
            .ToListAsync();
    }
}
