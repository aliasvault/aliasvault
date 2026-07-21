//-----------------------------------------------------------------------
// <copyright file="DbVersionRetentionRule.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Vault.RetentionRules;

using AliasServerDb;

/// <summary>
/// Version retention rule that keeps the latest X unique db versions of the vault.
/// </summary>
public class DbVersionRetentionRule : IRetentionRule
{
    /// <summary>
    /// Gets the amount of db versions to keep the vault.
    /// </summary>
    public int VersionsToKeep { get; init; }

   /// <inheritdoc cref="IRetentionRule.ApplyRule"/>
    public IEnumerable<VaultManifestBase> ApplyRule(List<VaultManifestBase> vaults, DateTime now)
    {
        // For the specified amount of versions, take last vault per version.
        return vaults
            .GroupBy(x => x.Version)
            .Select(g => g.OrderByDescending(x => x.UpdatedAt).First())
            .OrderByDescending(x => x.UpdatedAt)
            .Take(VersionsToKeep);
    }
}
