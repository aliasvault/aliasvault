//-----------------------------------------------------------------------
// <copyright file="FaviconExtractorTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

/// <summary>
/// Tests for the AliasVault.FaviconExtractor class.
/// </summary>
public class FaviconExtractorTests
{
    /// <summary>
    /// Test extracting a favicon from a known website.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task ExtractFaviconGoogle()
    {
        var faviconBytes = await FaviconExtractor.FaviconExtractor.GetFaviconAsync("https://adsense.google.com/start/");
        Assert.That(faviconBytes, Is.Not.Null);
    }

    /// <summary>
    /// Test that localhost URLs are blocked (SSRF protection).
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task BlockLocalhostUrls()
    {
        var localhostUrls = new[]
        {
            "http://localhost/favicon.ico",
            "http://127.0.0.1/favicon.ico",
            "http://[::1]/favicon.ico",
            "http://localhost:8080/favicon.ico",
            "https://localhost/favicon.ico",
        };

        foreach (var url in localhostUrls)
        {
            var faviconBytes = await FaviconExtractor.FaviconExtractor.GetFaviconAsync(url);
            Assert.That(faviconBytes, Is.Null, $"Should block localhost URL: {url}");
        }
    }

    /// <summary>
    /// Test that private IP ranges are blocked (SSRF protection).
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task BlockPrivateIpRanges()
    {
        var privateIpUrls = new[]
        {
            "http://10.0.0.1/favicon.ico",
            "http://10.100.0.1/favicon.ico",
            "http://192.168.1.1/favicon.ico",
            "http://172.16.0.1/favicon.ico",
            "http://169.254.169.254/latest/meta-data/", // AWS metadata endpoint
            "http://[fc00::1]/favicon.ico", // IPv6 private
            "http://[fe80::1]/favicon.ico", // IPv6 link-local
        };

        foreach (var url in privateIpUrls)
        {
            var faviconBytes = await FaviconExtractor.FaviconExtractor.GetFaviconAsync(url);
            Assert.That(faviconBytes, Is.Null, $"Should block private IP URL: {url}");
        }
    }

    /// <summary>
    /// Test that non-standard ports are blocked.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task BlockNonStandardPorts()
    {
        var nonStandardPortUrls = new[]
        {
            "http://example.com:8080/favicon.ico",
            "https://example.com:8443/favicon.ico",
            "http://example.com:3000/favicon.ico",
        };

        foreach (var url in nonStandardPortUrls)
        {
            var faviconBytes = await FaviconExtractor.FaviconExtractor.GetFaviconAsync(url);
            Assert.That(faviconBytes, Is.Null, $"Should block non-standard port URL: {url}");
        }
    }
}
