//-----------------------------------------------------------------------
// <copyright file="IpAddressUtility.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth.IpAddress;

using System.Net;
using Microsoft.AspNetCore.Http;

/// <summary>
/// Ip address utility class to extract IP address from HttpContext.
/// </summary>
public static class IpAddressUtility
{
    /// <summary>
    /// Fully anonymized IP address constant used when IP logging is disabled.
    /// </summary>
    public const string AnonymizedIp = "xxx.xxx.xxx.xxx";

    /// <summary>
    /// Extracts the anonymized IP address (IPv4 last octet masked) from the HttpContext for persistence/logging.
    /// </summary>
    /// <param name="httpContext">HttpContext to extract the IP address from.</param>
    /// <param name="ipLoggingEnabled">Whether IP logging is enabled. If false, returns fully anonymized IP.</param>
    /// <returns>Anonymized IP address.</returns>
    public static string GetAnonymizedIpFromContext(HttpContext? httpContext, bool ipLoggingEnabled = true)
    {
        if (!ipLoggingEnabled)
        {
            return AnonymizedIp;
        }

        if (httpContext == null)
        {
            return string.Empty;
        }

        var ipAddress = ExtractRawIpString(httpContext) ?? "0.0.0.0";

        // Anonymize the last octet of the IP address (IPv4 only).
        if (ipAddress.Contains('.'))
        {
            try
            {
                var parts = ipAddress.Split('.');
                ipAddress = parts[0] + "." + parts[1] + "." + parts[2] + ".xxx";
            }
            catch
            {
                // If an exception occurs, continue execution with original IP address.
            }
        }

        return ipAddress;
    }

    /// <summary>
    /// Extracts the raw, non-anonymized IP address from the HttpContext for transient, request-time use only
    /// (e.g. matching against the IP blocklist). The returned value is intentionally NOT anonymized and must
    /// never be persisted. Use GetAnonymizedIpFromContext for persistence/logging instead.
    /// </summary>
    /// <param name="httpContext">HttpContext to extract the IP address from.</param>
    /// <returns>The parsed IP address, or null when it cannot be determined.</returns>
    public static IPAddress? GetRawIpAddressFromContext(HttpContext? httpContext)
    {
        if (httpContext == null)
        {
            return null;
        }

        return IPAddress.TryParse(ExtractRawIpString(httpContext), out var parsed) ? parsed : null;
    }

    /// <summary>
    /// Extracts the raw IP address string from the request, honoring the X-Forwarded-For header (first entry) when
    /// present and otherwise falling back to the connection's remote IP address.
    /// </summary>
    /// <param name="httpContext">HttpContext to extract the IP address from.</param>
    /// <returns>The raw IP address string, or null when it cannot be determined.</returns>
    private static string? ExtractRawIpString(HttpContext httpContext)
    {
        if (httpContext.Request.Headers.TryGetValue("X-Forwarded-For", out var xForwardedFor))
        {
            return xForwardedFor.ToString().Split(',')[0].Trim();
        }

        return httpContext.Connection.RemoteIpAddress?.ToString();
    }
}
