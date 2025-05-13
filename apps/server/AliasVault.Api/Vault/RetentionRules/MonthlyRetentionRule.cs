//-----------------------------------------------------------------------
// <copyright file="MonthlyRetentionRule.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Vault.RetentionRules;

using AliasServerDb;

/// <summary>
/// Monthly retention rule that keeps the latest vault for each month.
/// </summary>
public class MonthlyRetentionRule : IRetentionRule
{
    /// <summary>
    /// Gets the amount of months to keep vault.
    /// </summary>
    public int MonthsToKeep { get; init; }

    /// <inheritdoc cref="IRetentionRule.ApplyRule"/>
    public IEnumerable<Vault> ApplyRule(List<Vault> vaults, DateTime now)
    {
        return vaults
            .GroupBy(x => x.UpdatedAt.Month)
            .Select(g => g.OrderByDescending(x => x.UpdatedAt).First())
            .OrderByDescending(x => x.UpdatedAt)
            .Take(MonthsToKeep);
    }
}
