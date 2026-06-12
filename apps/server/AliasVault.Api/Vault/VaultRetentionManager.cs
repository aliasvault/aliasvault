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
/// History manager for vaults that keeps track of vault history and applies retention rules to
/// determine how many vaults to keep as backups and automatically deletes vaults that do not
/// match the applied retention policies.
/// </summary>
public static class VaultRetentionManager
{
    /// <summary>
    /// Applies retention policies to a list of existing vaults and a new vault.
    /// </summary>
    /// <param name="retentionPolicy">List of retention policies to apply.</param>
    /// <param name="existingVaults">List of existing vaults for a certain user.</param>
    /// <param name="now">DateTime which represents current time.</param>
    /// <param name="newVault">New encrypted vault to be added that is also taken into account for calculating retention policy.</param>
    /// <returns>List of vaults to delete according to the retention policies.</returns>
    public static List<VaultManifest> ApplyRetention(RetentionPolicy retentionPolicy, List<VaultManifest> existingVaults, DateTime now, VaultManifest? newVault = null)
    {
        // Add the new vault to the list of existing vaults if provided
        if (newVault is not null)
        {
            existingVaults = new List<VaultManifest>(existingVaults) { newVault };
        }

        // Sort vaults by UpdatedAt in descending order
        existingVaults = existingVaults.OrderByDescending(v => v.UpdatedAt).ToList();

        var vaultsToKeep = new HashSet<VaultManifest>();

        // Process retention rules
        foreach (var rule in retentionPolicy.Rules)
        {
            var keptVaults = rule.ApplyRule(existingVaults, now);
            foreach (var vault in keptVaults)
            {
                vaultsToKeep.Add(vault);
            }
        }

        // Always keep the most recent vault
        if (existingVaults.Count > 0)
        {
            vaultsToKeep.Add(existingVaults[0]);
        }

        // Determine vaults to delete
        var vaultsToDelete = existingVaults.Except(vaultsToKeep).ToList();

        // Return the vaults to delete
        return vaultsToDelete;
    }
}
