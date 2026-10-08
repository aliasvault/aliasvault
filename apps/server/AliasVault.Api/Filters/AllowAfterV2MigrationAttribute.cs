//-----------------------------------------------------------------------
// <copyright file="AllowAfterV2MigrationAttribute.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Filters;

/// <summary>
/// Exempts a v1 action from <see cref="LegacyApiGuardFilter"/>, so it stays reachable for users who migrated to v2.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class AllowAfterV2MigrationAttribute : Attribute
{
}
