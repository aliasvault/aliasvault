//-----------------------------------------------------------------------
// <copyright file="DbVersionRetentionRule.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Vault.RetentionRules;

using AliasServerDb;

/// <summary>
/// Version retention rule that keeps the latest X unique db versions of the vault. Only applies to manifest
/// revisions (other revision types carry no db version); it keeps nothing extra for other types.
/// </summary>
public class DbVersionRetentionRule : IRetentionRule
{
    /// <summary>
    /// Gets the amount of db versions to keep the vault.
    /// </summary>
    public int VersionsToKeep { get; init; }

   /// <inheritdoc cref="IRetentionRule.ApplyRule"/>
    public IEnumerable<IVaultRevision> ApplyRule(List<IVaultRevision> revisions, DateTime now)
    {
        // For the specified amount of versions, take last vault per version.
        return revisions
            .OfType<VaultManifestBase>()
            .GroupBy(x => x.Version)
            .Select(g => g.OrderByDescending(x => x.UpdatedAt).First())
            .OrderByDescending(x => x.UpdatedAt)
            .Take(VersionsToKeep);
    }
}
