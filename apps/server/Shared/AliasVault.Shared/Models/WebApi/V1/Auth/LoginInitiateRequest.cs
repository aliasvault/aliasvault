//-----------------------------------------------------------------------
// <copyright file="LoginInitiateRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Auth;

/// <summary>
/// Represents a login request.
/// </summary>
public class LoginInitiateRequest
{
    /// <summary>
    /// Initializes a new instance of the <see cref="LoginInitiateRequest"/> class.
    /// </summary>
    /// <param name="username">Username.</param>
    public LoginInitiateRequest(string username)
    {
        Username = username.ToLowerInvariant().Trim();
    }

    /// <summary>
    /// Gets the username.
    /// </summary>
    public string Username { get; }
}
