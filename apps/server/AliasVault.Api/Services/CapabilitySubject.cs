//-----------------------------------------------------------------------
// <copyright file="CapabilitySubject.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services;

using System.Collections.Generic;
using AliasServerDb;

/// <summary>
/// Who a capability is being resolved for.
/// </summary>
/// <param name="UserId">The account.</param>
/// <param name="GroupIds">Every group the account belongs to, its personal group included.</param>
/// <param name="Tier">The account's plan.</param>
/// <param name="ClientName">The client making the call, from the client header. Null when it did not say.</param>
public sealed record CapabilitySubject(string UserId, IReadOnlyCollection<Guid> GroupIds, AccountTier Tier, string? ClientName);
