//-----------------------------------------------------------------------
// <copyright file="ClientHeaderInfo.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Headers;

/// <summary>
/// Parsed components of the X-AliasVault-Client request header.
///
/// Header format is "{client}-{version}", e.g. "chrome-0.29.0", "ios-0.29.0", "android-0.29.0".
/// Any additional dash-separated segments are tolerated for backwards compatibility but ignored.
/// </summary>
/// <param name="ClientName">Lowercased client/platform identifier (e.g. "chrome", "android"). "unknown" when the header is missing or empty.</param>
/// <param name="ClientVersion">Client version string (e.g. "0.29.0"), or null when not present.</param>
public sealed record ClientHeaderInfo(string ClientName, string? ClientVersion)
{
    /// <summary>
    /// Header name used by AliasVault clients to identify themselves.
    /// </summary>
    public const string HeaderName = "X-AliasVault-Client";

    /// <summary>
    /// Parse a raw X-AliasVault-Client header value into its components.
    /// </summary>
    /// <param name="headerValue">Raw header value, may be null or empty.</param>
    /// <returns>Parsed ClientHeaderInfo. Missing version is returned as null.</returns>
    public static ClientHeaderInfo Parse(string? headerValue)
    {
        if (string.IsNullOrEmpty(headerValue))
        {
            return new ClientHeaderInfo("unknown", null);
        }

        var parts = headerValue.Split('-');
        var clientName = parts[0].ToLowerInvariant();
        var clientVersion = parts.Length > 1 ? parts[1] : null;

        return new ClientHeaderInfo(clientName, clientVersion);
    }
}
