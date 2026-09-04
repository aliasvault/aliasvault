//-----------------------------------------------------------------------
// <copyright file="FaviconExtractorNetworkTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

/// <summary>
/// Favicon extraction tests that fetch real websites. They are kept out of CI (which filters on
/// Category!=NetworkTests) because they depend on third-party sites being reachable and unchanged.
/// These tests are meant to be run by hand instead after changing network related logic. Run with:
/// <code>
/// dotnet test apps/server/Tests/AliasVault.UnitTests --filter "Category=NetworkTests"
/// </code>
/// </summary>
[Category("NetworkTests")]
public class FaviconExtractorNetworkTests
{
    /// <summary>
    /// Various websites where extracting a favicon should work for which have had issues in the past.
    /// </summary>
    private static readonly string[] Sites =
    [
        "https://adsense.google.com/start/", // Baseline case.
        "https://kunde.comdirect.de", // Icon served without a Content-Type header.
        "https://gmail.com", // Redirects to another host; icon path resolves against the final URL.
        "https://www.edreams.es", // Page behind a CDN that blocks the page request itself.
        "https://www.infojobs.net", // Page declaring a charset .NET cannot construct.
        "https://mudblazor.com/getting-started/installation", // Blazor app: page under a sub-path with <base href="/"> and a relative icon href.
        "https://www.instagram.com/accounts/login/", // Heavy page (600KB+) whose preferred icon is WebP.
        "https://www.epicgames.com/id/login", // Cloudflare-fronted; admits HTTP/1.1 but challenges HTTP/2 requests.
    ];

    /// <summary>
    /// Test that a favicon can be extracted for every site in the list.
    /// </summary>
    /// <param name="url">The URL to extract the favicon for.</param>
    /// <returns>Task.</returns>
    [TestCaseSource(nameof(Sites))]
    public async Task ExtractFaviconFromSite(string url)
    {
        var faviconBytes = await FaviconExtractor.FaviconExtractor.GetFaviconAsync(url);
        Assert.That(faviconBytes, Is.Not.Null, $"Should extract a favicon from {url}");
    }
}
