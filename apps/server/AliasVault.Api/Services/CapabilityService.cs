//-----------------------------------------------------------------------
// <copyright file="CapabilityService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services;

using AliasServerDb;
using AliasVault.Api.Headers;
using AliasVault.Shared.Providers.Time;
using AliasVault.Shared.Server.Capabilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

/// <summary>
/// Answers which capabilities a caller may use. Rules are read from the CapabilityRules table and cached in memory briefly.
/// </summary>
/// <param name="dbContextFactory">IDbContextFactory instance.</param>
/// <param name="cache">IMemoryCache instance used to cache the enabled rules.</param>
/// <param name="timeProvider">ITimeProvider instance.</param>
public class CapabilityService(IAliasServerDbContextFactory dbContextFactory, IMemoryCache cache, ITimeProvider timeProvider)
{
    private const int CacheDurationSeconds = 60;

    private const string EnabledRulesCacheKey = "CapabilityRules_Enabled";

    /// <summary>
    /// Resolves the caller's capabilities, every one this build knows about, on or off.
    /// </summary>
    /// <param name="userId">The calling account.</param>
    /// <param name="clientHeader">The raw client header the call arrived with, used by client-scoped rules.</param>
    /// <returns>Every known capability key and its resolved value.</returns>
    public async Task<Dictionary<string, string>> GetCapabilitiesAsync(string userId, string? clientHeader)
    {
        var rules = await GetEnabledRulesAsync();
        var subject = await BuildSubjectAsync(userId, clientHeader, rules);
        return CapabilityResolver.ResolveAll(rules, subject, timeProvider.UtcNow);
    }

    /// <summary>
    /// Whether the caller may use a capability.
    /// </summary>
    /// <param name="userId">The calling account.</param>
    /// <param name="capabilityKey">The capability key, from <see cref="CapabilityKeys"/>.</param>
    /// <param name="clientHeader">The raw client header the call arrived with, used by client-scoped rules.</param>
    /// <returns>True when the capability is on for this caller.</returns>
    public async Task<bool> IsEnabledAsync(string userId, string capabilityKey, string? clientHeader)
    {
        var rules = await GetEnabledRulesAsync();
        var subject = await BuildSubjectAsync(userId, clientHeader, rules);
        return CapabilityValue.IsEnabled(CapabilityResolver.Resolve(rules, subject, capabilityKey, timeProvider.UtcNow));
    }

    /// <summary>
    /// Gathers what the caller can be targeted by.
    /// </summary>
    private async Task<CapabilitySubject> BuildSubjectAsync(string userId, string? clientHeader, List<CapabilityRule> rules)
    {
        var groupIds = rules.Exists(r => r.GroupId is not null) ? await GetGroupIdsAsync(userId) : [];
        return new CapabilitySubject(userId, groupIds, AccountTier.Free, ClientHeaderInfo.Parse(clientHeader).ClientName);
    }

    /// <summary>
    /// Every group the account belongs to, its personal group included.
    /// </summary>
    private async Task<List<Guid>> GetGroupIdsAsync(string userId)
    {
        await using var dbContext = await dbContextFactory.CreateDbContextAsync();
        var groupIds = await dbContext.GroupMembers.AsNoTracking().Where(m => m.UserId == userId).Select(m => m.GroupId).ToListAsync();
        var personalGroupId = await dbContext.AliasVaultUsers.AsNoTracking().Where(u => u.Id == userId).Select(u => u.PersonalGroupId).FirstOrDefaultAsync();

        if (personalGroupId != Guid.Empty && !groupIds.Contains(personalGroupId))
        {
            groupIds.Add(personalGroupId);
        }

        return groupIds;
    }

    /// <summary>
    /// Returns the enabled rules from cache.
    /// </summary>
    /// <returns>The list of enabled rules.</returns>
    private async Task<List<CapabilityRule>> GetEnabledRulesAsync()
    {
        if (cache.TryGetValue(EnabledRulesCacheKey, out List<CapabilityRule>? cached) && cached is not null)
        {
            return cached;
        }

        await using var dbContext = await dbContextFactory.CreateDbContextAsync();
        var rules = await dbContext.CapabilityRules
            .AsNoTracking()
            .Where(x => x.Enabled)
            .ToListAsync();

        cache.Set(EnabledRulesCacheKey, rules, TimeSpan.FromSeconds(CacheDurationSeconds));
        return rules;
    }
}
