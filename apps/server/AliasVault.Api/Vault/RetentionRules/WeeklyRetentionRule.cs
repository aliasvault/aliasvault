//-----------------------------------------------------------------------
// <copyright file="WeeklyRetentionRule.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Vault.RetentionRules;

using AliasServerDb;

/// <summary>
/// Weekly retention rule that keeps the latest vault for each week.
/// </summary>
public class WeeklyRetentionRule : IRetentionRule
{
    /// <summary>
    /// Gets the amount of weeks to keep vault.
    /// </summary>
    public int WeeksToKeep { get; init; }

    /// <inheritdoc cref="IRetentionRule.ApplyRule"/>
    public IEnumerable<VaultManifestBase> ApplyRule(List<VaultManifestBase> vaults, DateTime now)
    {
        // Helper function to get the start of the week with Monday as the first day of the week.
        DateTime GetStartOfWeek(DateTime date)
        {
            int diff = (7 + (date.DayOfWeek - DayOfWeek.Monday)) % 7;
            return date.Date.AddDays(-1 * diff).Date;
        }

        return vaults
            .GroupBy(x => GetStartOfWeek(x.UpdatedAt))
            .Select(g => g.OrderByDescending(x => x.UpdatedAt).First())
            .OrderByDescending(x => x.UpdatedAt)
            .Take(WeeksToKeep);
    }
}
