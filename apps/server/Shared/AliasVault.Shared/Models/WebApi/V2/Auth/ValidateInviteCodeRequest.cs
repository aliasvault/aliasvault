//-----------------------------------------------------------------------
// <copyright file="ValidateInviteCodeRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// A request to check a registration invite code.
/// </summary>
public class ValidateInviteCodeRequest
{
    /// <summary>
    /// Gets the invite code to check.
    /// </summary>
    public required string InviteCode { get; init; } = string.Empty;
}
