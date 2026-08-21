//-----------------------------------------------------------------------
// <copyright file="CapabilityRuleKind.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// What a <see cref="CapabilityRule"/> rule is for. Only used for documentation purposes.
/// </summary>
public enum CapabilityRuleKind
{
    /// <summary>
    /// What an account is allowed to have based on their current plan, or on the general environment.
    /// </summary>
    Entitlement = 0,

    /// <summary>
    /// Whether a code path is live yet, used for temporary rollouts of new capabilities.
    /// </summary>
    Rollout = 1,
}
