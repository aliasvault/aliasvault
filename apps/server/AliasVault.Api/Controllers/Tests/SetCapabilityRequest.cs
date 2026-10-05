//-----------------------------------------------------------------------
// <copyright file="SetCapabilityRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.Tests;

#if DEBUG

/// <summary>
/// Request to set a capability for one account from the E2E TestController.
/// </summary>
public class SetCapabilityRequest
{
    /// <summary>
    /// Gets the capability key (e.g. "vault-sharing").
    /// </summary>
    public required string Key { get; init; }

    /// <summary>
    /// Gets the value the capability resolves to for the account.
    /// </summary>
    public string Value { get; init; } = "true";
}
#endif
