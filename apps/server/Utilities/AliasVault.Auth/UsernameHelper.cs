//-----------------------------------------------------------------------
// <copyright file="UsernameHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth;

/// <summary>
/// Helper for normalizing usernames consistently across the server.
/// </summary>
public static class UsernameHelper
{
    /// <summary>
    /// Normalizes a username by lowercasing and trimming it. 
    /// Used by all code paths that store a username.
    /// </summary>
    /// <param name="username">The username to normalize.</param>
    /// <returns>The normalized username.</returns>
    public static string NormalizeUsername(string username)
    {
        return username.ToLowerInvariant().Trim();
    }
}
