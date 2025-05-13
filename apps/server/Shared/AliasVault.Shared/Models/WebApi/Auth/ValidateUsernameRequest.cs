//-----------------------------------------------------------------------
// <copyright file="ValidateUsernameRequest.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.Auth;

/// <summary>
/// A request to validate a username.
/// </summary>
public class ValidateUsernameRequest
{
    /// <summary>
    /// Gets the username to validate.
    /// </summary>
    public required string Username { get; init; } = string.Empty;
}
