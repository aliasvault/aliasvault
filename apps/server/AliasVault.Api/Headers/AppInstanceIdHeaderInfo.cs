//-----------------------------------------------------------------------
// <copyright file="AppInstanceIdHeaderInfo.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Headers;

/// <summary>
/// Parsed value of the optional X-AliasVault-AppInstanceId request header.
///
/// This header is sent by clients that need to scope sessions per app instance, in addition to
/// the user/device combo. Currently used by the Android app to support multiple Android User
/// Profiles on the same physical device — each profile generates a unique UUID (without dashes)
/// on first launch that persists for the lifetime of that installation.
/// </summary>
/// <param name="AppInstanceId">Per-install app instance identifier, or null when the header is absent or empty.</param>
public sealed record AppInstanceIdHeaderInfo(string? AppInstanceId)
{
    /// <summary>
    /// Name of the optional header used by clients to scope sessions per app instance.
    /// </summary>
    public const string HeaderName = "X-AliasVault-AppInstanceId";

    /// <summary>
    /// Parse a raw X-AliasVault-AppInstanceId header value.
    /// </summary>
    /// <param name="headerValue">Raw header value, may be null or empty.</param>
    /// <returns>Parsed AppInstanceIdHeaderInfo. AppInstanceId is null when the header is missing or empty.</returns>
    public static AppInstanceIdHeaderInfo Parse(string? headerValue)
    {
        return new AppInstanceIdHeaderInfo(string.IsNullOrEmpty(headerValue) ? null : headerValue);
    }
}
