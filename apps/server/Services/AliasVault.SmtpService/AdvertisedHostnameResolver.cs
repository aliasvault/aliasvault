//-----------------------------------------------------------------------
// <copyright file="AdvertisedHostnameResolver.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.SmtpService;

/// <summary>
/// Resolves the SMTP server name advertised in the banner and EHLO (should align with PTR / FCrDNS in production).
/// </summary>
public static class AdvertisedHostnameResolver
{
    /// <summary>
    /// Resolves the advertised hostname. Priority: non-empty environment value, then non-empty configuration value,
    /// then <paramref name="dnsHostNameFallback"/> (typically <see cref="System.Net.Dns.GetHostName"/>).
    /// </summary>
    /// <param name="environmentValue">Value from SMTP_ADVERTISED_HOSTNAME (may be null or whitespace).</param>
    /// <param name="configurationValue">Value from configuration (may be null or whitespace).</param>
    /// <param name="dnsHostNameFallback">Invoked when both inputs are empty or whitespace after trim.</param>
    /// <returns>The non-empty hostname to pass to SmtpServer ServerName.</returns>
    public static string Resolve(
        string? environmentValue,
        string? configurationValue,
        Func<string> dnsHostNameFallback)
    {
        var fromEnv = TrimOrNull(environmentValue);
        if (fromEnv != null)
        {
            return fromEnv;
        }

        var fromConfig = TrimOrNull(configurationValue);
        if (fromConfig != null)
        {
            return fromConfig;
        }

        return dnsHostNameFallback();
    }

    private static string? TrimOrNull(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }
}
