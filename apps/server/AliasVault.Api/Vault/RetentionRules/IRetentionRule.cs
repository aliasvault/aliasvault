//-----------------------------------------------------------------------
// <copyright file="IRetentionRule.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Vault.RetentionRules;

using AliasServerDb;

/// <summary>
/// Retention rule interface that specify the contract for all retention rules.
/// </summary>
public interface IRetentionRule
{
    /// <summary>
    /// Apply retention rule.
    /// </summary>
    /// <param name="revisions">List of existing revisions to apply the retention rule to.</param>
    /// <param name="now">Current DateTime.</param>
    /// <returns>Revisions that should be kept according to the retention rule.</returns>
    IEnumerable<IVaultRevision> ApplyRule(List<IVaultRevision> revisions, DateTime now);
}
