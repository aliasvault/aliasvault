//-----------------------------------------------------------------------
// <copyright file="LoginCredentialRetentionRule.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Vault.RetentionRules;

using AliasServerDb;

/// <summary>
/// Credential retention rule that keeps the latest X unique login credentials and vaults associated with it.
/// </summary>
public class LoginCredentialRetentionRule : IRetentionRule
{
    /// <summary>
    /// Gets or sets amount of unique login credentials to keep including the vault.
    /// </summary>
    public int CredentialsToKeep { get; set; }

   /// <inheritdoc cref="IRetentionRule.ApplyRule"/>
    public IEnumerable<VaultManifestBase> ApplyRule(List<VaultManifestBase> vaults, DateTime now)
    {
        // For the specified amount of versions, take last vault per version.
        return vaults
            .GroupBy(x => new { x.Salt, x.Verifier })
            .Select(g => g.OrderByDescending(x => x.UpdatedAt).First())
            .OrderByDescending(x => x.UpdatedAt)
            .Take(CredentialsToKeep);
    }
}
