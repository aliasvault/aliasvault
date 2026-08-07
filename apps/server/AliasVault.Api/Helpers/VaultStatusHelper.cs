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
    /// <summary>
    /// The full manifest-revision list a status endpoint reports: every manifest the user can access.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The id of the user to build manifest revisions for.</param>
    /// <returns>The accessible manifest revision list.</returns>
    public static async Task<List<ManifestRevision>> GetManifestRevisionsAsync(AliasServerDbContext context, string userId)
    {
        return await ManifestAccessHelper.AccessibleManifests(context, userId)
            .Select(x => new ManifestRevision { ManifestId = x.ManifestId, Revision = x.RevisionNumber })
            .ToListAsync();
    }
}
