//-----------------------------------------------------------------------
// <copyright file="FaviconExtractorTests.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the MIT license. See LICENSE.md file in the project root for full license information.
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
}
