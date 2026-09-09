//-----------------------------------------------------------------------
// <copyright file="ApiRoutes.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasVault.Client;

/// <summary>
/// Builds the relative request paths for the AliasVault API that all requests go through.
/// </summary>
public static class ApiRoutes
{
    /// <summary>
    /// The API version every call from this client goes through.
    /// </summary>
    private const string VersionPrefix = "v2";

    /// <summary>
    /// Returns the relative path for an API endpoint.
    /// </summary>
    /// <param name="path">Endpoint path without version prefix, e.g. "Auth/login".</param>
    /// <returns>Relative request path, e.g. "v2/Auth/login".</returns>
    public static string ApiRoute(string path) => $"{VersionPrefix}/{path}";
}
