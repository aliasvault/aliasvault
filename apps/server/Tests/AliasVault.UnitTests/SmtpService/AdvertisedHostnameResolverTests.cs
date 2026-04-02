//-----------------------------------------------------------------------
// <copyright file="AdvertisedHostnameResolverTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.SmtpService;

using AliasVault.SmtpService;

/// <summary>
/// Tests for <see cref="AdvertisedHostnameResolver"/>.
/// </summary>
public class AdvertisedHostnameResolverTests
{
    /// <summary>
    /// Environment value wins over configuration when both are non-empty.
    /// </summary>
    [Test]
    public void Resolve_EnvironmentWinsOverConfiguration()
    {
        var actual = AdvertisedHostnameResolver.Resolve(
            "mail.env.example",
            "mail.config.example",
            () => "fallback.invalid");

        Assert.That(actual, Is.EqualTo("mail.env.example"));
    }

    /// <summary>
    /// Configuration is used when environment is empty.
    /// </summary>
    [Test]
    public void Resolve_UsesConfigurationWhenEnvironmentEmpty()
    {
        var actual = AdvertisedHostnameResolver.Resolve(
            null,
            "mail.config.example",
            () => "fallback.invalid");

        Assert.That(actual, Is.EqualTo("mail.config.example"));
    }

    /// <summary>
    /// Whitespace-only environment defers to configuration.
    /// </summary>
    [Test]
    public void Resolve_WhitespaceEnvironmentDefersToConfiguration()
    {
        var actual = AdvertisedHostnameResolver.Resolve(
            "   ",
            "mail.config.example",
            () => "fallback.invalid");

        Assert.That(actual, Is.EqualTo("mail.config.example"));
    }

    /// <summary>
    /// Fallback is used when environment and configuration are empty.
    /// </summary>
    [Test]
    public void Resolve_UsesFallbackWhenBothEmpty()
    {
        var invoked = false;
        var actual = AdvertisedHostnameResolver.Resolve(
            string.Empty,
            string.Empty,
            () =>
            {
                invoked = true;
                return "dns-host";
            });

        Assert.Multiple(() =>
        {
            Assert.That(invoked, Is.True);
            Assert.That(actual, Is.EqualTo("dns-host"));
        });
    }

    /// <summary>
    /// Trims leading and trailing whitespace from chosen value.
    /// </summary>
    [Test]
    public void Resolve_TrimsEnvironmentValue()
    {
        var actual = AdvertisedHostnameResolver.Resolve(
            "  mail.example.com  ",
            "other",
            () => "fallback");

        Assert.That(actual, Is.EqualTo("mail.example.com"));
    }

    /// <summary>
    /// Explicit non-empty values do not invoke DNS fallback.
    /// </summary>
    [Test]
    public void Resolve_DoesNotInvokeFallbackWhenEnvironmentSet()
    {
        var invoked = false;
        AdvertisedHostnameResolver.Resolve(
            "explicit",
            string.Empty,
            () =>
            {
                invoked = true;
                return "dns";
            });

        Assert.That(invoked, Is.False);
    }
}
