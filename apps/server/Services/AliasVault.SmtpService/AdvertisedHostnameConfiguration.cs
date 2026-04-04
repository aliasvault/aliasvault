//-----------------------------------------------------------------------
// <copyright file="AdvertisedHostnameConfiguration.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.SmtpService;

using Microsoft.Extensions.Configuration;

/// <summary>
/// Reads SMTP advertised hostname from <see cref="IConfiguration"/> and resolves it together with environment and DNS fallback.
/// </summary>
public static class AdvertisedHostnameConfiguration
{
    /// <summary>
    /// Configuration key for the hostname advertised in the SMTP banner (appsettings / env-specific JSON).
    /// </summary>
    public const string AdvertisedHostnameConfigurationKey = "SmtpService:AdvertisedHostname";

    /// <summary>
    /// Reads the configured advertised hostname (may be empty).
    /// </summary>
    /// <param name="configuration">Application configuration.</param>
    /// <returns>Value for <see cref="AdvertisedHostnameConfigurationKey"/>, or empty string when missing.</returns>
    public static string ReadAdvertisedHostname(IConfiguration configuration)
    {
        return configuration[AdvertisedHostnameConfigurationKey] ?? string.Empty;
    }

    /// <summary>
    /// Resolves the effective hostname: environment <c>SMTP_ADVERTISED_HOSTNAME</c> wins, then configuration, then DNS fallback.
    /// </summary>
    /// <param name="configuration">Application configuration.</param>
    /// <param name="smtpAdvertisedHostnameEnvironment">Value of <c>SMTP_ADVERTISED_HOSTNAME</c>.</param>
    /// <param name="dnsHostNameFallback">Typically <see cref="System.Net.Dns.GetHostName"/>.</param>
    /// <returns>Non-empty hostname for the SMTP server <c>ServerName</c> option.</returns>
    public static string ResolveAdvertisedHostname(
        IConfiguration configuration,
        string? smtpAdvertisedHostnameEnvironment,
        Func<string> dnsHostNameFallback)
    {
        return AdvertisedHostnameResolver.Resolve(
            smtpAdvertisedHostnameEnvironment,
            ReadAdvertisedHostname(configuration),
            dnsHostNameFallback);
    }
}
