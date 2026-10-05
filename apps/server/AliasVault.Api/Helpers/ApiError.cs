//-----------------------------------------------------------------------
// <copyright file="ApiError.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi.V2;
using Microsoft.AspNetCore.Mvc;

/// <summary>
/// Builds V2 error results, so every V2 error goes out as an <see cref="ErrorResponse"/>.
/// </summary>
public static class ApiError
{
    /// <summary>
    /// An error result with the given code and HTTP status.
    /// </summary>
    /// <param name="code">The error code.</param>
    /// <param name="statusCode">The HTTP status code.</param>
    /// <param name="details">Optional structured context.</param>
    /// <returns>The error result.</returns>
    public static ObjectResult Result(ApiErrorCode code, int statusCode, object? details = null) => new(ErrorResponse.Create(code, statusCode, details)) { StatusCode = statusCode };

    /// <summary>
    /// Whether the request targets the V2 API, whose errors use <see cref="ErrorResponse"/>; V1 keeps its own shapes for older clients.
    /// </summary>
    /// <param name="context">The HTTP context.</param>
    /// <returns>True for a V2 request.</returns>
    public static bool IsV2Request(HttpContext context) => context.Request.Path.StartsWithSegments("/v2", StringComparison.OrdinalIgnoreCase);
}
