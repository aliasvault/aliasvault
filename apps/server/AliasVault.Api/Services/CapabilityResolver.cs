//-----------------------------------------------------------------------
// <copyright file="CapabilityResolver.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services;

using AliasServerDb;
using AliasVault.Shared.Server.Capabilities;

/// <summary>
/// Resolver logic which determines what a capability resolves to for a given caller.
/// </summary>
public static class CapabilityResolver
{
    /// <summary>
    /// Resolves every capability this build knows about for the given caller. Ones no rule targets fall back to their registry default.
    /// </summary>
    /// <param name="rules">The candidate rules.</param>
    /// <param name="subject">The caller to resolve for.</param>
    /// <param name="now">The current UTC time, used to evaluate effective-from/until windows.</param>
    /// <returns>Every known capability key and its resolved value.</returns>
    public static Dictionary<string, string> ResolveAll(IEnumerable<CapabilityRule> rules, CapabilitySubject subject, DateTime now)
    {
        var byKey = rules.Where(r => Applies(r, subject, now)).GroupBy(r => r.CapabilityKey, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

        var resolved = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var definition in CapabilityRegistry.All)
        {
            var winner = byKey.TryGetValue(definition.Key, out var candidates) ? PickWinner(candidates, subject) : null;
            resolved[definition.Key] = winner?.Value ?? definition.DefaultValue;
        }

        return resolved;
    }

    /// <summary>
    /// Resolves a single capability for the given caller.
    /// </summary>
    /// <param name="rules">The candidate rules.</param>
    /// <param name="subject">The caller to resolve for.</param>
    /// <param name="capabilityKey">The capability key to resolve.</param>
    /// <param name="now">The current UTC time, used to evaluate effective-from/until windows.</param>
    /// <returns>The resolved value, or the registry default when no rule targets the caller.</returns>
    public static string Resolve(IEnumerable<CapabilityRule> rules, CapabilitySubject subject, string capabilityKey, DateTime now)
    {
        var candidates = rules.Where(r => string.Equals(r.CapabilityKey, capabilityKey, StringComparison.OrdinalIgnoreCase) && Applies(r, subject, now)).ToList();
        var winner = PickWinner(candidates, subject);
        if (winner is not null)
        {
            return winner.Value;
        }

        return CapabilityRegistry.Find(capabilityKey)?.DefaultValue ?? string.Empty;
    }

    /// <summary>
    /// Whether a rule is live right now and targets this caller at all.
    /// </summary>
    private static bool Applies(CapabilityRule rule, CapabilitySubject subject, DateTime now)
    {
        if (!rule.Enabled)
        {
            return false;
        }

        if ((rule.EffectiveFrom is not null && rule.EffectiveFrom > now) || (rule.EffectiveUntil is not null && rule.EffectiveUntil < now))
        {
            return false;
        }

        if (rule.ClientName is not null && !string.Equals(rule.ClientName, subject.ClientName, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return ScopeRank(rule, subject) is not null;
    }

    /// <summary>
    /// How specific a rule's scope is for this caller. Null when the rule targets somebody else.
    /// </summary>
    private static int? ScopeRank(CapabilityRule rule, CapabilitySubject subject)
    {
        if (rule.UserId is not null)
        {
            return string.Equals(rule.UserId, subject.UserId, StringComparison.Ordinal) ? 3 : null;
        }

        if (rule.GroupId is not null)
        {
            return subject.GroupIds.Contains(rule.GroupId.Value) ? 2 : null;
        }

        if (rule.Tier is not null)
        {
            return rule.Tier == subject.Tier ? 1 : null;
        }

        return 0;
    }

    /// <summary>
    /// The rule that decides the value.
    /// </summary>
    private static CapabilityRule? PickWinner(List<CapabilityRule> candidates, CapabilitySubject subject)
    {
        CapabilityRule? winner = null;
        var winningRank = -1;

        foreach (var rule in candidates)
        {
            var rank = ScopeRank(rule, subject);
            if (rank is null)
            {
                continue;
            }

            if (rank > winningRank || (rank == winningRank && Supersedes(rule, winner!)))
            {
                winner = rule;
                winningRank = rank.Value;
            }
        }

        return winner;
    }

    /// <summary>
    /// Whether one rule takes precedence over another of the same scope.
    /// </summary>
    private static bool Supersedes(CapabilityRule rule, CapabilityRule current)
    {
        if (rule.UpdatedAt != current.UpdatedAt)
        {
            return rule.UpdatedAt > current.UpdatedAt;
        }

        return rule.Id.CompareTo(current.Id) > 0;
    }
}
