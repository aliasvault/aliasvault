//-----------------------------------------------------------------------
// <copyright file="SetServerSettingRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.Tests;

#if DEBUG

/// <summary>
/// Request to set a server setting by key/value from the E2E TestController.
/// </summary>
public class SetServerSettingRequest
{
    /// <summary>
    /// Gets the setting key to update (e.g. "MaxRegistrationsPerIpPer24Hours").
    /// </summary>
    public required string Key { get; init; } = string.Empty;

    /// <summary>
    /// Gets the value to assign to the setting. Null clears the value.
    /// </summary>
    public string? Value { get; init; }
}
#endif
