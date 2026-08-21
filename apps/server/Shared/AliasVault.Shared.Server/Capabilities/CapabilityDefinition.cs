//-----------------------------------------------------------------------
// <copyright file="CapabilityDefinition.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Server.Capabilities;

using AliasServerDb;

/// <summary>
/// One capability this server build knows about.
/// </summary>
/// <param name="Key">The key clients gate on, from <see cref="CapabilityKeys"/>.</param>
/// <param name="Kind">Whether the capability is a durable entitlement or a temporary rollout switch.</param>
/// <param name="DefaultValue">What the capability resolves to when no rule matches.</param>
/// <param name="Description">What the capability covers, shown to the operator in the admin portal.</param>
public sealed record CapabilityDefinition(string Key, CapabilityRuleKind Kind, string DefaultValue, string Description)
{
    /// <summary>
    /// Gets a value indicating whether the capability is disabled unless a rule says otherwise.
    /// </summary>
    public bool IsDefaultOff => !CapabilityValue.IsEnabled(DefaultValue);
}
