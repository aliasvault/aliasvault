//-----------------------------------------------------------------------
// <copyright file="ErrorResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2;

using System.Text.Json.Serialization;
using AliasVault.Shared.Models.Enums;

/// <summary>
/// The body of every V2 error response.
/// </summary>
public sealed class ErrorResponse
{
    /// <summary>
    /// Gets the error code, the name of an <see cref="ApiErrorCode"/> member.
    /// </summary>
    [JsonPropertyName("code")]
    public required string Code { get; init; }

    /// <summary>
    /// Gets the HTTP status code of the response.
    /// </summary>
    [JsonPropertyName("statusCode")]
    public required int StatusCode { get; init; }

    /// <summary>
    /// Gets optional structured context for the error, omitted when there is none.
    /// </summary>
    [JsonPropertyName("details")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public object? Details { get; init; }

    /// <summary>
    /// Creates an error response.
    /// </summary>
    /// <param name="code">The error code.</param>
    /// <param name="statusCode">The HTTP status code.</param>
    /// <param name="details">Optional structured context.</param>
    /// <returns>The error response.</returns>
    public static ErrorResponse Create(ApiErrorCode code, int statusCode, object? details = null) => new() { Code = code.ToString(), StatusCode = statusCode, Details = details };
}
