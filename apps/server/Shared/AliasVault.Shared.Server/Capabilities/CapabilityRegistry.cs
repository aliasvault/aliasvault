//-----------------------------------------------------------------------
// <copyright file="CapabilityRegistry.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Server.Capabilities;

using System.Collections.Generic;
using System.Collections.ObjectModel;
using AliasServerDb;

/// <summary>
/// All known capabilities with their default values and descriptions, used for administration and fall-back purposes.
/// </summary>
public static class CapabilityRegistry
{
    private static readonly ReadOnlyCollection<CapabilityDefinition> Definitions = new List<CapabilityDefinition>
    {
        new(
            CapabilityKeys.VaultSharing,
            CapabilityRuleKind.Entitlement,
            CapabilityValue.Off,
            "Shared vaults: creating a shared vault, giving family members access to it and accepting such access. Currently in beta."),
    }.AsReadOnly();

    private static readonly Dictionary<string, CapabilityDefinition> ByKey = Definitions.ToDictionary(d => d.Key, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Gets every capability this build knows about.
    /// </summary>
    public static IReadOnlyList<CapabilityDefinition> All => Definitions;

    /// <summary>
    /// Looks up a capability by key.
    /// </summary>
    /// <param name="key">The capability key.</param>
    /// <returns>The definition, or null when this build does not know the key.</returns>
    public static CapabilityDefinition? Find(string key) => ByKey.GetValueOrDefault(key);
}
