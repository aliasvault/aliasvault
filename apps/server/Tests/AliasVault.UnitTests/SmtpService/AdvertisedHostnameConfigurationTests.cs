//-----------------------------------------------------------------------
// <copyright file="AdvertisedHostnameConfigurationTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.SmtpService;

using AliasVault.SmtpService;
using Microsoft.Extensions.Configuration;

/// <summary>
/// Tests for <see cref="AdvertisedHostnameConfiguration"/>.
/// </summary>
public class AdvertisedHostnameConfigurationTests
{
    /// <summary>
    /// Missing key yields empty string.
    /// </summary>
    [Test]
    public void ReadAdvertisedHostname_MissingKey_ReturnsEmpty()
    {
        var configuration = CreateConfiguration();
        var actual = AdvertisedHostnameConfiguration.ReadAdvertisedHostname(configuration);
        Assert.That(actual, Is.EqualTo(string.Empty));
    }

    /// <summary>
    /// Key present returns stored value (including whitespace; trimming happens in resolver).
    /// </summary>
    [Test]
    public void ReadAdvertisedHostname_ReturnsConfiguredValue()
    {
        var configuration = CreateConfiguration(
            new Dictionary<string, string?>
            {
                [AdvertisedHostnameConfiguration.AdvertisedHostnameConfigurationKey] = "mail.example.com",
            });

        var actual = AdvertisedHostnameConfiguration.ReadAdvertisedHostname(configuration);

        Assert.That(actual, Is.EqualTo("mail.example.com"));
    }

    /// <summary>
    /// Full pipeline uses configuration when environment is unset.
    /// </summary>
    [Test]
    public void ResolveAdvertisedHostname_UsesConfigurationWhenEnvironmentEmpty()
    {
        var configuration = CreateConfiguration(
            new Dictionary<string, string?>
            {
                [AdvertisedHostnameConfiguration.AdvertisedHostnameConfigurationKey] = "from.appsettings",
            });

        var actual = AdvertisedHostnameConfiguration.ResolveAdvertisedHostname(
            configuration,
            null,
            () => "dns-fallback");

        Assert.That(actual, Is.EqualTo("from.appsettings"));
    }

    /// <summary>
    /// Environment overrides configuration.
    /// </summary>
    [Test]
    public void ResolveAdvertisedHostname_EnvironmentOverridesConfiguration()
    {
        var configuration = CreateConfiguration(
            new Dictionary<string, string?>
            {
                [AdvertisedHostnameConfiguration.AdvertisedHostnameConfigurationKey] = "from.appsettings",
            });

        var actual = AdvertisedHostnameConfiguration.ResolveAdvertisedHostname(
            configuration,
            "from.env",
            () => "dns-fallback");

        Assert.That(actual, Is.EqualTo("from.env"));
    }

    /// <summary>
    /// When configuration and environment are empty, DNS fallback is used.
    /// </summary>
    [Test]
    public void ResolveAdvertisedHostname_UsesDnsFallbackWhenConfigAndEnvEmpty()
    {
        var configuration = CreateConfiguration();
        var invoked = false;

        var actual = AdvertisedHostnameConfiguration.ResolveAdvertisedHostname(
            configuration,
            string.Empty,
            () =>
            {
                invoked = true;
                return "container-abc";
            });

        Assert.Multiple(() =>
        {
            Assert.That(invoked, Is.True);
            Assert.That(actual, Is.EqualTo("container-abc"));
        });
    }

    /// <summary>
    /// Configuration key constant matches appsettings and documentation.
    /// </summary>
    [Test]
    public void AdvertisedHostnameConfigurationKey_IsSmtpServiceAdvertisedHostname()
    {
        Assert.That(
            AdvertisedHostnameConfiguration.AdvertisedHostnameConfigurationKey,
            Is.EqualTo("SmtpService:AdvertisedHostname"));
    }

    private static IConfiguration CreateConfiguration(IEnumerable<KeyValuePair<string, string?>>? initialData = null)
    {
        var builder = new ConfigurationBuilder();
        if (initialData != null)
        {
            builder.AddInMemoryCollection(initialData);
        }

        return builder.Build();
    }
}
