//-----------------------------------------------------------------------
// <copyright file="SearchTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.E2ETests.Tests.Client.Shard1;

/// <summary>
/// End-to-end tests for searching.
/// </summary>
[TestFixture]
[Category("ClientTests")]
[Parallelizable(ParallelScope.Self)]
public class SearchTests : ClientPlaywrightTest
{
    /// <summary>
    /// Test if the global search bar works.
    /// </summary>
    /// <returns>Async task.</returns>
    [Test]
    public async Task GlobalSearchBarTest()
    {
        // Create two credentials
        var serviceName1 = "Test Service 1";
        var serviceName2 = "Test Service 2";
        var serviceName3 = "Entirely different name";
        await CreateItemEntry(new Dictionary<string, string>
        {
           { "service-name", serviceName1 },
        });
        await CreateItemEntry(new Dictionary<string, string>
        {
           { "service-name", serviceName2 },
        });
        await CreateItemEntry(new Dictionary<string, string>
        {
            { "service-name", serviceName3 },
        });

        // Focus the "searchWidget" id element if it exists
        var searchWidget = Page.Locator("#searchWidget");
        if (await searchWidget.IsVisibleAsync())
        {
           await searchWidget.FocusAsync();
        }
        else
        {
           Assert.Fail("Search widget not found or not visible");
        }

        // Type in the search bar "Test Service"
        await searchWidget.FillAsync("Test Service");

        // Wait for 0.5 seconds
        await Task.Delay(500);

        // We expect both test services names to appear on the page inside the div with id "searchWidgetContainer"
        var searchResults = Page.Locator("#searchWidgetContainer .search-result");

        // Wait for the search results to appear
        Assert.That(await searchResults.CountAsync(), Is.EqualTo(2));

        // Verify that test service 1 and 2 appear in results, 3 does not.
        var resultTexts = await searchResults.AllInnerTextsAsync();
        Assert.That(resultTexts, Has.Some.Contains(serviceName1));
        Assert.That(resultTexts, Has.Some.Contains(serviceName2));
        Assert.That(resultTexts, Has.Some.Not.Contains(serviceName3));
    }
}
